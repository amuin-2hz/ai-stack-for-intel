"""
TTS 语音合成 — Qwen3-TTS-0.6B CustomVoice (GPU)
模型: Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice
框架: qwen-tts (PyTorch) + OpenVINO GPU 推理

性能优化:
  - SDPA attention 替代慢速手动 attention 实现
  - bfloat16 精度减半内存带宽
  - OpenVINO GPU 后端编译 (1.25x vs CPU)
  - 长文本按句子拆分, 逐句生成 (首句延迟 ~20s vs 整段 ~77s)
"""

import sys
import io
import re
import wave
import time
import signal
import argparse
import threading
from pathlib import Path

import numpy as np
import soundfile as sf

MODEL_PATH = "models/Qwen3-TTS-0.6B-CustomVoice"

# Available speakers from the model card
SPEAKERS = {
    "Vivian":    {"lang": "Chinese",  "desc": "明亮年轻女声"},
    "Serena":    {"lang": "Chinese",  "desc": "温暖柔和年轻女声"},
    "Uncle_Fu":  {"lang": "Chinese",  "desc": "资深男声，醇厚音色"},
    "Dylan":     {"lang": "Chinese",  "desc": "年轻北京男声（北京方言）"},
    "Eric":      {"lang": "Chinese",  "desc": "活泼成都男声（四川方言）"},
    "Ryan":      {"lang": "English",  "desc": "动感男声，有节奏感"},
    "Aiden":     {"lang": "English",  "desc": "阳光美式男声"},
    "Ono_Anna":  {"lang": "Japanese", "desc": "俏皮日语女声"},
    "Sohee":     {"lang": "Korean",   "desc": "温暖韩语女声"},
}

LANGUAGES = [
    "Chinese", "English", "Japanese", "Korean", "German",
    "French", "Russian", "Portuguese", "Spanish", "Italian",
]

# Average speaking rates (chars per second) for max_tokens estimation
_CHARS_PER_SECOND = {
    "Chinese": 3.5, "Japanese": 3.5, "Korean": 3.5,
    "English": 12, "German": 12, "French": 12,
    "Russian": 12, "Portuguese": 12, "Spanish": 12, "Italian": 12,
}
_MODEL_HZ = 12.5  # Qwen3-TTS generates at 12.5 audio tokens per second


def estimate_max_tokens(text: str, language: str = "Chinese") -> int:
    """根据文本长度估算 max_new_tokens, 避免生成过长音频.

    不加限制时模型会生成 max_new_tokens (2048) 个音频 token,
    2048 ÷ 12.5 = 164 秒音频, 远超过实际需要的时长.
    108 字中文仅需约 31 秒 ≈ 385 tokens.
    """
    rate = _CHARS_PER_SECOND.get(language, 10)
    est_duration = max(len(text) / rate, 0.5)
    tokens = int(est_duration * _MODEL_HZ)
    return max(50, min(2048, int(tokens * 1.2)))


# CJK punctuation for sentence splitting
_CJK_SENTENCE_RE = re.compile(r'(?<=[。！？；\n])')
_LATIN_SENTENCE_RE = re.compile(r'(?<=[.!?;\n])')


def split_sentences(text: str, language: str = "Chinese") -> list:
    """将长文本按标点拆分为句子, 用于逐句生成音频."""
    is_cjk = language in ("Chinese", "Japanese", "Korean")
    pattern = _CJK_SENTENCE_RE if is_cjk else _LATIN_SENTENCE_RE

    parts = pattern.split(text)
    sentences = [p.strip() for p in parts if p.strip()]

    if not sentences:
        return [text]

    # 合并过短的句子到相邻句 (避免生成音频太短)
    merged = []
    for s in sentences:
        if merged and len(s) < 3:
            merged[-1] += s
        else:
            merged.append(s)

    return merged if merged else [text]


def load_model(model_path: str):
    """加载 Qwen3-TTS 模型.

    优化:
      - SDPA attention (替代 flash-attn 回退的手动 PyTorch attention)
      - bfloat16 dtype (减半内存带宽)
      - OpenVINO GPU 后端编译 (1.25x 加速 vs 纯 CPU)
    """
    import torch
    from qwen_tts import Qwen3TTSModel

    print(f"Loading Qwen3-TTS-0.6B CustomVoice...")
    t0 = time.time()

    model = Qwen3TTSModel.from_pretrained(
        str(model_path),
        device_map="cpu",
        dtype=torch.bfloat16,
        attn_implementation="sdpa",
    )

    print(f"  ✅ Model loaded in {time.time() - t0:.1f}s  |  "
          f"dtype={model.model.dtype}  |  device={model.device}")

    # 尝试 OpenVINO GPU 后端编译 (1.25x 加速, 从 77s → ~62s for 108 字中文)
    print(f"  Compiling with OpenVINO GPU backend...")
    t1 = time.time()
    try:
        model.model = torch.compile(
            model.model,
            backend="openvino",
            options={"device": "GPU", "PERFORMANCE_HINT": "LATENCY"}
        )
        print(f"  ✅ OpenVINO GPU compiled in {time.time() - t1:.1f}s")
    except Exception as e:
        print(f"  ⚠️  OpenVINO GPU failed ({e}), falling back to CPU")
        try:
            model.model = torch.compile(
                model.model,
                backend="openvino",
                options={"device": "CPU", "PERFORMANCE_HINT": "LATENCY"}
            )
            print(f"  ✅ OpenVINO CPU compiled in {time.time() - t1:.1f}s")
        except Exception as e2:
            print(f"  ⚠️  OpenVINO CPU also failed ({e2}), using eager mode")

    # 预热: 用短文本触发 JIT 编译, 避免首次真实请求等待编译
    print(f"  Warming up...")
    t2 = time.time()
    try:
        _, _ = model.generate_custom_voice(
            text="测试", speaker="Vivian", language="Chinese",
            max_new_tokens=10,
        )
        print(f"  ✅ Warm-up done in {time.time() - t2:.1f}s")
    except Exception as e:
        print(f"  ⚠️  Warm-up failed ({e}), continuing anyway")

    return model


def _generate_one(model, text: str, speaker: str, language: str,
                  max_new_tokens: int, instruct: str = None) -> tuple:
    """Generate audio for a single text segment. Returns (audio_np, sample_rate, elapsed_s)."""
    import torch
    t0 = time.time()

    kwargs = dict(
        text=text, language=language, speaker=speaker,
        max_new_tokens=max_new_tokens,
    )
    if instruct:
        kwargs["instruct"] = instruct

    wavs, sr = model.generate_custom_voice(**kwargs)
    audio = np.concatenate(wavs) if len(wavs) > 1 else wavs[0]
    elapsed = time.time() - t0
    return audio, sr, elapsed


def synthesize_sentences(model, text: str, speaker: str = "Vivian",
                         language: str = "Chinese", instruct: str = None,
                         max_new_tokens: int = None) -> dict:
    """按句子拆分文本并逐句合成语音.

    返回完整的拼接音频和逐句耗时统计, 为后续流式传输做准备.
    对于 108 字中文文本, 首句约 20s 即可生成完毕 (vs 整段 77s).
    """
    sentences = split_sentences(text, language)
    total_start = time.time()

    all_audio = []
    sr = 24000  # default, will be overwritten by first segment
    segment_times = []

    print(f"   📝 {len(text)} chars → {len(sentences)} sentences")

    for i, sentence in enumerate(sentences):
        seg_tokens = max_new_tokens or estimate_max_tokens(sentence, language)
        if max_new_tokens and len(sentences) > 1:
            # 按比例分配 token 预算
            seg_tokens = max(50, int(max_new_tokens * len(sentence) / len(text)))

        audio, seg_sr, seg_elapsed = _generate_one(
            model, sentence, speaker, language, seg_tokens, instruct
        )
        sr = seg_sr
        all_audio.append(audio)
        seg_dur = len(audio) / sr

        print(f"   🎵 [{i+1}/{len(sentences)}] {len(sentence)} chars → "
              f"{seg_elapsed:.1f}s, audio {seg_dur:.1f}s (RTF {seg_elapsed/seg_dur:.1f})")
        segment_times.append(seg_elapsed)

    total_elapsed = time.time() - total_start
    combined = np.concatenate(all_audio)
    total_dur = len(combined) / sr

    print(f"   📊 Total: {total_elapsed:.1f}s for {total_dur:.1f}s audio "
          f"({len(sentences)} segments, RTF {total_elapsed/total_dur:.1f})")

    return {
        "audio": combined,
        "sample_rate": sr,
        "time": total_elapsed,
        "duration": total_dur,
        "rtf": total_elapsed / total_dur if total_dur > 0 else 0,
        "num_segments": len(sentences),
        "segment_times": segment_times,
    }


def _encode_wav(audio: np.ndarray, sr: int) -> bytes:
    """Encode float32 audio to WAV bytes (16-bit PCM, mono)."""
    buf = io.BytesIO()
    audio_clipped = np.clip(audio, -1.0, 1.0)
    audio_int16 = (audio_clipped * 32767).astype(np.int16)

    with wave.open(buf, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(audio_int16.tobytes())

    return buf.getvalue()


def create_tts_handler(model_path: str):
    """创建 HTTP 请求处理函数, 兼容 server_utils.start_server(handle_speech=...)."""
    model = load_model(model_path)

    def handle(request: dict):
        text = request.get("input", request.get("text", ""))
        speaker = request.get("voice", "Vivian")
        if speaker not in SPEAKERS:
            speaker = "Vivian"
        language = request.get("language") or SPEAKERS.get(speaker, {}).get("lang", "Chinese")
        instruct = request.get("instruct")
        max_new_tokens = request.get("max_new_tokens") or estimate_max_tokens(text, language)

        if not text:
            return {"error": "No text provided"}

        print(f"   🎤 TTS: {len(text)} chars | speaker={speaker} | lang={language} | "
              f"max_tokens={max_new_tokens}")

        result = synthesize_sentences(
            model, text, speaker=speaker, language=language,
            instruct=instruct, max_new_tokens=max_new_tokens,
        )

        if result["duration"] == 0:
            return {"error": "TTS generation failed — no audio produced"}

        wav_bytes = _encode_wav(result["audio"], result["sample_rate"])
        print(f"   ✅ TTS done: {result['time']:.1f}s total, "
              f"WAV {len(wav_bytes)/1024:.0f} KB")
        return wav_bytes

    return handle


def create_tts_ws_handler(model_path: str):
    """创建 WebSocket 消息处理器 — 逐句流式返回 base64 编码的 WAV (JSON 文本帧).

    使用 JSON 文本帧发送 base64 编码的音频数据，避免二进制帧在代理层丢失的问题。

    Client → Server:  JSON {"input": "...", "voice": "Vivian", ...}
    Server → Client:  TEXT frame {"type": "chunk", "data": "<base64>", "index": 0, "total": N}
    Server → Client:  TEXT frame {"type": "chunk", "data": "<base64>", "index": 1, "total": N}
    ...
    Server → Client:  TEXT frame {"type": "done", "duration": ..., "segments": N}
    """
    import base64

    model = load_model(model_path)

    async def handle(data: dict):
        # Ignore binary-only messages (shouldn't happen for TTS, which is text-in)
        if data.get("_binary"):
            yield {"type": "error", "message": "TTS expects JSON text, not binary"}
            return

        text = data.get("input", data.get("text", ""))
        speaker = data.get("voice", "Vivian")
        if speaker not in SPEAKERS:
            speaker = "Vivian"
        language = data.get("language") or SPEAKERS.get(speaker, {}).get("lang", "Chinese")
        instruct = data.get("instruct")
        max_new_tokens = data.get("max_new_tokens") or estimate_max_tokens(text, language)

        if not text:
            yield {"type": "error", "message": "No text provided"}
            return

        print(f"   🎤 WS-TTS: {len(text)} chars | speaker={speaker} | lang={language} | "
              f"max_tokens={max_new_tokens}")

        sentences = split_sentences(text, language)
        print(f"   📝 {len(sentences)} sentences")

        total_start = time.time()
        all_dur = 0.0

        for i, sentence in enumerate(sentences):
            seg_tokens = max_new_tokens or estimate_max_tokens(sentence, language)
            if max_new_tokens and len(sentences) > 1:
                seg_tokens = max(50, int(max_new_tokens * len(sentence) / max(len(text), 1)))

            audio, sr, seg_elapsed = _generate_one(
                model, sentence, speaker, language, seg_tokens, instruct
            )
            seg_dur = len(audio) / sr
            all_dur += seg_dur

            print(f"   🎵 [{i+1}/{len(sentences)}] {len(sentence)} chars → "
                  f"{seg_elapsed:.1f}s, audio {seg_dur:.1f}s (RTF {seg_elapsed/seg_dur:.1f})")

            # 立即发送当前句子的 WAV (base64 编码在 JSON 文本帧中)
            wav_bytes = _encode_wav(audio, sr)
            b64_data = base64.b64encode(wav_bytes).decode("ascii")
            yield {
                "type": "chunk",
                "data": b64_data,
                "index": i,
                "total": len(sentences),
            }

        total_elapsed = time.time() - total_start
        print(f"   📊 WS-TTS total: {total_elapsed:.1f}s for {all_dur:.1f}s audio "
              f"({len(sentences)} segments, RTF {total_elapsed/all_dur:.1f})")

        # 发送完成消息
        yield {"type": "done", "duration": all_dur, "segments": len(sentences),
               "sample_rate": sr, "elapsed": total_elapsed}

    # Return a FACTORY so ws_server.py can create per-connection handlers.
    # TTS is stateless per-connection, so we return the same handle for all.
    def new_handler():
        return handle

    return new_handler


# ── CLI helpers (kept for standalone usage) ──

def format_time(seconds: float) -> str:
    if seconds < 1:
        return f"{seconds*1000:.0f}ms"
    elif seconds < 60:
        return f"{seconds:.1f}s"
    else:
        m, s = divmod(seconds, 60)
        return f"{int(m)}m{s:.0f}s"


def main():
    parser = argparse.ArgumentParser(
        description="Qwen3-TTS-0.6B CustomVoice — Multilingual TTS",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="\n".join([
            "Speakers:",
            *[f"  {k:12s} — {v['desc']} ({v['lang']})" for k, v in SPEAKERS.items()],
            "",
            "Examples:",
            "  python scripts/tts.py \"你好世界\"",
            "  python scripts/tts.py \"Hello world\" -s Ryan -l English",
            "  python scripts/tts.py \"こんにちは\" -s Ono_Anna -l Japanese",
            "  python scripts/tts.py \"你好\" -i \"用特别愤怒的语气说\"",
        ]),
    )
    parser.add_argument("text", nargs="?", default="你好，这是本地语音合成测试。",
                        help="Text to synthesize")
    parser.add_argument("--speaker", "-s", default="Vivian",
                        choices=list(SPEAKERS.keys()),
                        help="Speaker voice (default: Vivian)")
    parser.add_argument("--language", "-l", default=None,
                        help="Language (auto-detect from speaker if not set)")
    parser.add_argument("--instruct", "-i", default=None,
                        help="Style instruction, e.g. '用开心的语气说'")
    parser.add_argument("--output", "-o", default="data/tts_output.wav",
                        help="Output audio file path")
    parser.add_argument("--port", type=int, default=None,
                        help="HTTP server port (default: CLI mode)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="HTTP server bind address")
    parser.add_argument("--model-path", default=str(Path(__file__).parent.parent / MODEL_PATH),
                        help=f"Model directory path (default: {MODEL_PATH})")
    parser.add_argument("--device", default="CPU", choices=["CPU", "GPU"],
                        help="Device (default: CPU, qwen-tts uses PyTorch)")
    parser.add_argument("--list-speakers", action="store_true",
                        help="List available speakers and exit")
    parser.add_argument("--list-languages", action="store_true",
                        help="List supported languages and exit")
    parser.add_argument("--benchmark", action="store_true",
                        help="Run benchmark with test sentences")
    args = parser.parse_args()

    # ── WebSocket Server Mode ──
    if args.port:
        from ws_server import start_ws_server
        handler = create_tts_ws_handler(args.model_path)
        print(f"Starting Qwen3-TTS WebSocket server on http://{args.host}:{args.port}")
        start_ws_server(
            host=args.host, port=args.port,
            engine_name="tts",
            handle_ws_message=handler,
            version="qwen3-tts-06b"
        )
        # Wait for shutdown signal instead of blocking forever
        stop = threading.Event()
        signal.signal(signal.SIGTERM, lambda s, f: stop.set())
        signal.signal(signal.SIGINT, lambda s, f: stop.set())
        print("  (Ctrl+C to stop)")
        stop.wait()
        print("  Shutting down...")
        return

    if args.list_speakers:
        print("\nAvailable speakers:")
        print(f"{'Name':12s} {'Language':12s} {'Description'}")
        print("-" * 50)
        for name, info in SPEAKERS.items():
            print(f"{name:12s} {info['lang']:12s} {info['desc']}")
        return

    if args.list_languages:
        print("\nSupported languages:")
        for lang in LANGUAGES:
            print(f"  • {lang}")
        return

    # Auto-detect language from speaker
    if args.language is None:
        args.language = SPEAKERS.get(args.speaker, {}).get("lang", "Chinese")

    model_path = Path(args.model_path)
    if not model_path.exists():
        print(f"❌ Model not found: {model_path}")
        print("Download: huggingface-cli download Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice "
              "--local-dir models/Qwen3-TTS-0.6B-CustomVoice")
        sys.exit(1)

    model = load_model(str(model_path))

    if args.benchmark:
        test_cases = [
            ("你好，欢迎使用本地语音合成系统。", "Vivian", "Chinese", None),
            ("今天天气真好，我们出去散步吧！", "Vivian", "Chinese", "用开心的语气说"),
            ("Hello, this is a local text-to-speech system.", "Ryan", "English", None),
            ("人工智能正在改变我们的生活方式。", "Uncle_Fu", "Chinese", None),
        ]

        print(f"\n{'='*60}")
        print("🏃 TTS Benchmark — Qwen3-TTS-0.6B CustomVoice")
        print(f"{'='*60}")

        for text, spk, lang, ins in test_cases:
            print(f"\n  📝 \"{text[:40]}...\" ({spk}, {lang})")
            result = synthesize_sentences(model, text, spk, lang, ins)
            print(f"  ⏱ Total: {format_time(result['time'])} | "
                  f"Audio: {format_time(result['duration'])} | RTF: {result['rtf']:.2f}")
    else:
        print(f"\n  📝 Text: \"{args.text}\"")
        print(f"  🎤 Speaker: {args.speaker} ({SPEAKERS[args.speaker]['desc']})")
        print(f"  🌐 Language: {args.language}")
        if args.instruct:
            print(f"  🎭 Style: {args.instruct}")

        print("\nGenerating speech...")
        result = synthesize_sentences(
            model, args.text, args.speaker, args.language, args.instruct
        )
        audio, sr = result["audio"], result["sample_rate"]

        print(f"\n{'='*60}")
        print(f"✅ Generated in {format_time(result['time'])}")
        print(f"   Audio duration: {format_time(result['duration'])}")
        print(f"   RTF: {result['rtf']:.2f}")

        # Save audio
        output_path = Path(__file__).parent.parent / args.output
        output_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(output_path), audio, sr)
        print(f"   Saved to: {output_path} ({output_path.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
