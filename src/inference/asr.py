"""
ASR Speech Recognition — Qwen3-ASR-0.6B INT8 (OpenVINO)
Pipeline: Audio → Mel → Encoder → Thinker → Decoder → Text

Usage:
  python asr.py audio.wav                     # Transcribe audio file
  python asr.py audio.wav --language en       # Language hint
  python asr.py --port 31002                  # HTTP server mode
"""

import sys
import time
import signal
import argparse
import json
import threading
from pathlib import Path

import numpy as np
import openvino as ov

MODEL_PATH = "models/Qwen3-ASR-0.6B-int8-ov"
DEVICE = "CPU"

# Special token IDs
AUDIO_START = 151669
AUDIO_END = 151670
AUDIO_PAD = 151676
EOS = 151645

SAMPLE_RATE = 16000
HOP_LENGTH = 160
N_FFT = 400
N_MELS = 128
MAX_MEL_FRAMES = 3000  # static NPU model shape: [1, 128, 3000] (~30s audio)


def load_models(model_path: str, device: str = DEVICE):
    """Load the three ASR sub-models and tokenizer.

    Device routing:
    - audio_encoder → `device` (typically NPU, uses static shape [1,128,3000])
    - thinker + decoder → CPU (require dynamic shapes for autoregressive decoding)
    """
    from transformers import AutoTokenizer

    core = ov.Core()
    mp = Path(model_path)

    # Audio encoder: static shape, can run on NPU
    enc_device = device
    # Thinker & decoder: need dynamic shapes for autoregressive loop
    seq_device = "CPU"

    print(f"Loading ASR models (encoder={enc_device}, thinker/decoder={seq_device})...")
    t0 = time.time()

    enc_model = core.read_model(str(mp / "audio_encoder_model.xml"))
    audio_encoder = core.compile_model(enc_model, enc_device)

    thinker_model = core.read_model(str(mp / "thinker_embeddings_model.xml"))
    thinker = core.compile_model(thinker_model, seq_device)

    dec_model = core.read_model(str(mp / "decoder_model.xml"))
    decoder = core.compile_model(dec_model, seq_device)

    tokenizer = AutoTokenizer.from_pretrained(
        model_path, trust_remote_code=True, fix_mistral_regex=True
    )

    print(f"  ✅ Loaded in {time.time() - t0:.1f}s")
    return core, audio_encoder, thinker, decoder, tokenizer


def extract_mel(audio: np.ndarray, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Extract log-mel spectrogram from audio waveform."""
    import librosa

    if sr != SAMPLE_RATE:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLE_RATE)
        sr = SAMPLE_RATE

    if audio.ndim > 1:
        audio = audio.mean(axis=0)

    mel = librosa.feature.melspectrogram(
        y=audio, sr=sr, n_fft=N_FFT,
        hop_length=HOP_LENGTH, n_mels=N_MELS,
        fmin=0, fmax=8000
    )

    log_mel = np.log10(np.maximum(mel, 1e-10))
    log_mel = (log_mel - log_mel.mean()) / max(log_mel.std(), 1e-6)

    T = log_mel.shape[-1]
    if T > MAX_MEL_FRAMES:
        print(f"   ⚠️ Audio too long ({T} mel frames > {MAX_MEL_FRAMES}), truncating")
        log_mel = log_mel[:, :MAX_MEL_FRAMES]
        T = MAX_MEL_FRAMES

    if T < MAX_MEL_FRAMES:
        log_mel = np.pad(log_mel, ((0, 0), (0, MAX_MEL_FRAMES - T)), mode='constant')

    return log_mel.astype(np.float32)[np.newaxis, :, :]


def build_input_ids(n_audio_tokens: int, prompt_text: str,
                    tokenizer, language: str = "zh") -> np.ndarray:
    """Build the input token sequence for the ASR model."""
    system_text = "You are a helpful assistant."
    user_text = prompt_text or "Transcribe the speech to text."

    prompt = (
        f"<|im_start|>system\n{system_text}<|im_end|>\n"
        f"<|im_start|>user\n"
        f"<|audio_start|>" + "<|audio_pad|>" * n_audio_tokens + f"<|audio_end|>"
        f"{user_text}<|im_end|>\n"
        f"<|im_start|>assistant\n"
    )

    encoded = tokenizer.encode(prompt, add_special_tokens=False)
    return np.array([encoded], dtype=np.int64)


def transcribe(audio_path: str, models, language: str = "zh",
               max_tokens: int = 256, prompt: str = None,
               enc_infer=None, thk_infer=None, dec_infer=None) -> dict:
    """Transcribe audio file to text.

    Accepts optional pre-created infer requests to avoid the overhead of
    create_infer_request() on every call (OpenVINO allocates new buffers each time).
    """
    import librosa

    _, audio_encoder, thinker, decoder, tokenizer = models

    t0 = time.time()
    audio, sr = librosa.load(audio_path, sr=SAMPLE_RATE, mono=True)
    audio_duration = len(audio) / sr
    t_load = time.time() - t0

    t1 = time.time()
    mel = extract_mel(audio, sr)
    t_feat = time.time() - t1

    # Reuse or create encoder infer request
    t2 = time.time()
    if enc_infer is None:
        enc_infer = audio_encoder.create_infer_request()
    enc_infer.set_tensor("mel", ov.Tensor(mel))
    enc_infer.infer()
    audio_features = enc_infer.get_output_tensor(0).data
    t_enc = time.time() - t2

    n_audio_tokens = audio_features.shape[1]
    input_ids = build_input_ids(n_audio_tokens, prompt or "", tokenizer, language)

    # Reuse or create thinker infer request
    t3 = time.time()
    if thk_infer is None:
        thk_infer = thinker.create_infer_request()
    thk_infer.set_tensor("input_ids", ov.Tensor(input_ids))
    thk_infer.infer()
    thinker_out = thk_infer.get_output_tensor(0).data
    t_think = time.time() - t3

    audio_pad_mask = (input_ids[0] == AUDIO_PAD)
    n_audio = np.sum(audio_pad_mask)
    if n_audio == audio_features.shape[1]:
        thinker_out[0, audio_pad_mask, :] = audio_features[0, :n_audio, :]
    else:
        min_len = min(n_audio, audio_features.shape[1])
        thinker_out[0, audio_pad_mask][:min_len] = audio_features[0, :min_len, :]

    hidden = thinker_out
    prompt_len = hidden.shape[1]

    # Reuse or create decoder infer request
    if dec_infer is None:
        dec_infer = decoder.create_infer_request()

    generated_ids = []
    current_hidden = hidden
    current_pos = np.arange(hidden.shape[1], dtype=np.int64).reshape(1, -1)

    # Pre-allocate arrays for the decode loop to avoid per-step allocations
    _token_input = np.zeros((1, 1), dtype=np.int64)
    _pos_arr = np.zeros((1, 1), dtype=np.int64)

    t_decode_start = time.time()

    for step in range(max_tokens):
        dec_infer.set_tensor("1001", ov.Tensor(current_hidden))
        dec_infer.set_tensor("position_ids", ov.Tensor(current_pos))
        dec_infer.infer()

        logits = dec_infer.get_output_tensor(0).data
        next_token = int(np.argmax(logits[0, -1, :]))

        if next_token == EOS:
            break

        generated_ids.append(next_token)

        _token_input[0, 0] = next_token
        thk_infer.set_tensor("input_ids", ov.Tensor(_token_input))
        thk_infer.infer()
        current_hidden = thk_infer.get_output_tensor(0).data
        _pos_arr[0, 0] = prompt_len + step
        current_pos = _pos_arr

    t_decode = time.time() - t_decode_start

    t4 = time.time()
    text = tokenizer.decode(generated_ids, skip_special_tokens=True)
    text = text.replace("<asr_text>", "").replace("<asr_language>", "")
    text = text.strip()
    t_detok = time.time() - t4

    total_time = time.time() - t0

    return {
        "text": text,
        "audio_duration": audio_duration,
        "audio_tokens": n_audio_tokens,
        "prompt_tokens": prompt_len,
        "generated_tokens": len(generated_ids),
        "total_time": total_time,
        "rtf": total_time / audio_duration if audio_duration > 0 else 0,
        "timing": {"load": t_load, "feature": t_feat, "encoder": t_enc,
                   "thinker": t_think, "decode": t_decode, "detok": t_detok}
    }


def format_time(s: float) -> str:
    if s < 1: return f"{s*1000:.0f}ms"
    elif s < 60: return f"{s:.1f}s"
    else: return f"{int(s//60)}m{s%60:.0f}s"


def create_asr_handler(models):
    """Create HTTP request handler for /v1/audio/transcriptions.

    Pre-creates OpenVINO infer requests so they are reused across calls,
    avoiding the allocation overhead of create_infer_request() per request.
    """
    _, audio_encoder, thinker, decoder, tokenizer = models

    # Pre-create infer requests once — reused for every transcription
    enc_infer = audio_encoder.create_infer_request()
    thk_infer = thinker.create_infer_request()
    dec_infer = decoder.create_infer_request()

    def handle(request: dict) -> dict:
        audio_path = request.get("audio_path", request.get("file", ""))
        language = request.get("language", "zh")
        max_tokens = request.get("max_tokens", 256)
        prompt = request.get("prompt")

        if not audio_path:
            return {"text": "", "error": "No audio file specified"}

        result = transcribe(audio_path, models, language=language,
                          max_tokens=max_tokens, prompt=prompt,
                          enc_infer=enc_infer, thk_infer=thk_infer,
                          dec_infer=dec_infer)
        return {"text": result["text"]}

    return handle


def create_asr_ws_handler(models):
    """创建 WebSocket 消息处理器工厂 — 每个连接创建独立的 handler.

    每个 handler 拥有自己的 audio_chunks, 避免连接之间共享可变状态
    导致 "第二次录音返回第一次的内容" 的 bug。

    Client → Server:  BINARY frame (audio chunk 1)
    Client → Server:  BINARY frame (audio chunk 2)
    ...
    Client → Server:  TEXT frame {"type": "end"}
    Server → Client:  TEXT frame {"type": "result", "text": "你好"}

    也支持直接发送 JSON {"audio_path": "/tmp/..."} 用于向后兼容.
    """
    import librosa
    import tempfile
    import soundfile as sf

    core, audio_encoder, thinker, decoder, tokenizer = models

    # Global counter for unique handler IDs (across all connections)
    _handler_counter = [0]

    def new_handler():
        """Create a fresh handler for a new WebSocket connection.
        Each connection gets its own audio_chunks, sr, AND infer requests
        to prevent state leakage between transcriptions."""
        import datetime
        import os as _os
        _handler_counter[0] += 1
        handler_id = _handler_counter[0]

        # Per-connection infer requests — prevents state leakage
        enc_infer = audio_encoder.create_infer_request()
        thk_infer = thinker.create_infer_request()
        dec_infer = decoder.create_infer_request()
        msg = f"[ASR #{handler_id}] NEW HANDLER at {datetime.datetime.now()}"
        print(msg)
        with open("/tmp/asr_diag.log", "a") as f:
            f.write(msg + "\n")
            f.flush()

        audio_chunks = []
        audio_sr = None

        async def handle(data: dict):
            nonlocal audio_chunks, audio_sr

            # Binary audio frame → accumulate
            raw = data.get("_binary")
            if raw is not None:
                audio_chunks.append(raw)
                first_bytes = raw[:12].hex() if len(raw) >= 12 else raw.hex()
                msg2 = f"[ASR #{handler_id}] Binary: {len(raw)}B chunks={len(audio_chunks)} first={first_bytes}"
                print(msg2)
                with open("/tmp/asr_diag.log", "a") as f:
                    f.write(msg2 + "\n")
                    f.flush()
                return None

            msg_type = data.get("type", "")

            # JSON with audio_path (backward compat)
            if "audio_path" in data or "file" in data:
                audio_path = data.get("audio_path", data.get("file", ""))
                language = data.get("language", "zh")
                max_tokens = data.get("max_tokens", 256)
                prompt = data.get("prompt")
                if not audio_path:
                    return {"type": "error", "message": "No audio file specified"}
                result = transcribe(audio_path, models, language=language,
                                  max_tokens=max_tokens, prompt=prompt,
                                  enc_infer=enc_infer, thk_infer=thk_infer,
                                  dec_infer=dec_infer)
                return {"type": "result", "text": result["text"]}

            # "end" signal — transcribe accumulated audio
            if msg_type == "end":
                if not audio_chunks:
                    return {"type": "error", "message": "No audio received"}
                # Take ownership and reset
                chunks_to_transcribe = audio_chunks
                audio_chunks = []
                audio_sr = None
                total_bytes = sum(len(c) for c in chunks_to_transcribe)
                msg3 = f"[ASR #{handler_id}] END: {len(chunks_to_transcribe)} chunks {total_bytes}B"
                print(msg3)
                with open("/tmp/asr_diag.log", "a") as f:
                    f.write(msg3 + "\n")
                    f.flush()

                combined = b"".join(chunks_to_transcribe)
                # Save to diagnostics dir for manual inspection
                diag_dir = "/tmp/asr_audio_diag"
                _os.makedirs(diag_dir, exist_ok=True)
                import time as _time
                diag_path = _os.path.join(diag_dir, f"asr_{handler_id}_{int(_time.time()*1000)}.webm")
                with open(diag_path, "wb") as _df:
                    _df.write(combined)
                tmp_path = diag_path
                tmp_size = _os.path.getsize(tmp_path)
                msg_tmp = f"[ASR #{handler_id}] TEMP: {tmp_path} ({tmp_size}B)"
                print(msg_tmp)
                with open("/tmp/asr_diag.log", "a") as f:
                    f.write(msg_tmp + "\n")
                    f.flush()
                try:
                    language = data.get("language", "zh")
                    # Estimate max_tokens from audio duration to prevent repetition.
                    # Chinese ~3-4 chars/s, ~2 tokens/char → ~8 tokens/s of speech.
                    # Use 10x audio duration with min=20, max=256 as a safe range.
                    estimated_max_tokens = 64  # fallback
                    try:
                        import librosa as _librosa
                        _audio, _sr = _librosa.load(tmp_path, sr=16000, mono=True)
                        _dur = len(_audio) / _sr
                        estimated_max_tokens = max(20, min(256, int(_dur * 10)))
                        _rms = float((_audio ** 2).mean() ** 0.5)
                        msg_aud = f"[ASR #{handler_id}] AUDIO: duration={_dur:.2f}s sr={_sr} samples={len(_audio)} rms={_rms:.4f} min={_audio.min():.4f} max={_audio.max():.4f} max_tok={estimated_max_tokens}"
                        print(msg_aud)
                        with open("/tmp/asr_diag.log", "a") as f:
                            f.write(msg_aud + "\n")
                            f.flush()
                    except Exception as _e:
                        msg_aud = f"[ASR #{handler_id}] AUDIO load failed: {_e}"
                        print(msg_aud)
                        with open("/tmp/asr_diag.log", "a") as f:
                            f.write(msg_aud + "\n")
                            f.flush()

                    # Use user-specified max_tokens if provided, otherwise estimate from duration
                    user_max_tokens = data.get("max_tokens")
                    max_tokens = user_max_tokens if user_max_tokens else estimated_max_tokens

                    result = transcribe(tmp_path, models, language=language,
                                      max_tokens=max_tokens,
                                      enc_infer=enc_infer, thk_infer=thk_infer,
                                      dec_infer=dec_infer)
                    text = result["text"]
                    # Also log generated token count
                    msg4 = f"[ASR #{handler_id}] RESULT: text='{text}' rt_f={result.get('rtf',0):.3f} audio_dur={result.get('audio_duration',0):.2f}s tokens={result.get('generated_tokens',0)}"
                    print(msg4)
                    with open("/tmp/asr_diag.log", "a") as f:
                        f.write(msg4 + "\n")
                        f.flush()
                finally:
                    pass  # keep diag file, don't delete
                return {"type": "result", "text": text}

            return {"type": "error", "message": f"Unknown message type: {msg_type}"}

        return handle

    return new_handler  # return the FACTORY, not the handler


def main():
    parser = argparse.ArgumentParser(
        description="Qwen3-ASR-0.6B — Speech Recognition"
    )
    parser.add_argument("audio", nargs="?", help="Path to audio file")
    parser.add_argument("--language", "-l", default="zh")
    parser.add_argument("--prompt", "-p", default=None)
    parser.add_argument("--max-tokens", type=int, default=256)
    parser.add_argument("--device", default=DEVICE, choices=["CPU", "GPU", "NPU"])
    parser.add_argument("--model-path", default=None, help="Model directory path")
    parser.add_argument("--port", type=int, default=None,
                        help="HTTP server port (default: CLI mode)")
    parser.add_argument("--host", default="127.0.0.1", help="HTTP server bind address")
    parser.add_argument("--benchmark", action="store_true")
    args = parser.parse_args()

    model_path = args.model_path or str(Path(__file__).parent.parent / MODEL_PATH)
    model_path = Path(model_path)
    if not model_path.exists():
        print(f"❌ Model not found: {model_path}")
        sys.exit(1)

    models = load_models(str(model_path), args.device)

    # ── WebSocket Server Mode ──
    if args.port:
        from ws_server import start_ws_server
        handler = create_asr_ws_handler(models)
        print(f"Starting ASR WebSocket server on http://{args.host}:{args.port}")
        start_ws_server(
            host=args.host, port=args.port,
            engine_name="asr",
            handle_ws_message=handler,
            version="qwen3-asr-06b"
        )
        # Wait for shutdown signal
        stop = threading.Event()
        signal.signal(signal.SIGTERM, lambda s, f: stop.set())
        signal.signal(signal.SIGINT, lambda s, f: stop.set())
        print("  (Ctrl+C to stop)")
        stop.wait()
        print("  Shutting down...")
        return

    # ── CLI Mode ──
    if not args.audio:
        parser.print_help()
        sys.exit(1)

    audio_path = Path(args.audio)
    if not audio_path.exists():
        print(f"❌ Audio file not found: {args.audio}")
        sys.exit(1)

    result = transcribe(str(audio_path), models, language=args.language,
                       max_tokens=args.max_tokens, prompt=args.prompt)

    print(f"\n{'='*60}")
    print(f"📝 Transcription: {result['text']}")
    print(f"{'='*60}")
    print(f"📊 RTF: {result['rtf']:.3f} | Time: {format_time(result['total_time'])}")
    print(f"   Tokens: {result['generated_tokens']} gen / {result['audio_tokens']} audio")


if __name__ == "__main__":
    main()
