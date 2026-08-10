"""Qwen3-ASR thinker-layout inference using the isolated OpenVINO helper runtime."""

import argparse
import os
import sys
import tempfile
import time
from pathlib import Path

from qwen_3_asr_helper import OVQwen3ASRModel

DEFAULT_MODEL_PATH = "models/qwen3-asr-1.7b-ov-int8"
DEFAULT_DEVICE = "GPU"


def load_model(model_path: str, device: str, max_tokens: int = 256):
    print(f"Loading {Path(model_path).name} on {device}...")
    started = time.time()
    model = OVQwen3ASRModel.from_pretrained(
        model_dir=model_path,
        device=device,
        max_inference_batch_size=1,
        max_new_tokens=max_tokens,
    )
    print(f"  Loaded in {time.time() - started:.1f}s")
    return model


def clean_transcription(text: str) -> str:
    if "<asr_text>" in text:
        text = text.rsplit("<asr_text>", 1)[-1]
    return text.strip()


def transcribe(model, audio_path: str, language: str | None = None, prompt: str = "") -> dict:
    started = time.time()
    result = model.transcribe(
        audio=audio_path,
        context=prompt or "",
        language=language or None,
    )[0]
    return {
        "text": clean_transcription(result.text),
        "language": result.language,
        "total_time": time.time() - started,
    }


def create_ws_handler(model):
    def new_handler():
        audio_chunks: list[bytes] = []

        async def handle(data: dict):
            nonlocal audio_chunks
            raw = data.get("_binary")
            if raw is not None:
                audio_chunks.append(raw)
                return None

            if "audio_path" in data or "file" in data:
                audio_path = data.get("audio_path", data.get("file", ""))
                if not audio_path:
                    return {"type": "error", "message": "No audio file specified"}
                result = transcribe(
                    model,
                    audio_path,
                    language=data.get("language"),
                    prompt=data.get("prompt", ""),
                )
                return {"type": "result", **result}

            if data.get("type") == "end":
                if not audio_chunks:
                    return {"type": "error", "message": "No audio received"}
                payload = b"".join(audio_chunks)
                audio_chunks = []
                suffix = data.get("suffix", ".webm")
                if not isinstance(suffix, str) or not suffix.startswith("."):
                    suffix = ".webm"
                temp_path = None
                try:
                    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as stream:
                        stream.write(payload)
                        temp_path = stream.name
                    result = transcribe(
                        model,
                        temp_path,
                        language=data.get("language"),
                        prompt=data.get("prompt", ""),
                    )
                    return {"type": "result", **result}
                finally:
                    if temp_path:
                        try:
                            os.unlink(temp_path)
                        except OSError:
                            pass

            return {"type": "error", "message": f"Unknown message type: {data.get('type', '')}"}

        return handle

    return new_handler


def main():
    parser = argparse.ArgumentParser(description="Qwen3-ASR thinker-layout OpenVINO inference")
    parser.add_argument("audio", nargs="?", help="Path to an audio file")
    parser.add_argument("--language", "-l", default=None)
    parser.add_argument("--prompt", "-p", default="")
    parser.add_argument("--max-tokens", type=int, default=256)
    parser.add_argument("--device", default=DEFAULT_DEVICE, choices=["CPU", "GPU"])
    parser.add_argument("--model-path", default=DEFAULT_MODEL_PATH)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    model_path = Path(args.model_path)
    if not model_path.exists():
        print(f"Model not found: {model_path}", file=sys.stderr)
        raise SystemExit(1)

    model = load_model(str(model_path), args.device, args.max_tokens)

    if args.port:
        from ws_server import start_ws_server

        start_ws_server(
            host=args.host,
            port=args.port,
            engine_name="asr",
            handle_ws_message=create_ws_handler(model),
            version=model_path.name.lower(),
        )
        import threading
        stop = threading.Event()
        try:
            stop.wait()
        except KeyboardInterrupt:
            pass
        return

    if not args.audio:
        parser.error("audio is required in CLI mode")
    result = transcribe(model, args.audio, args.language, args.prompt)
    print(result["text"])
    print(f"Language: {result['language']} | Time: {result['total_time']:.2f}s")


if __name__ == "__main__":
    main()
