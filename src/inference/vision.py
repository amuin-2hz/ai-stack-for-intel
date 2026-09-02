"""
Author: zhenz

VLM Vision — Qwen3-VL-4B-Instruct INT4 (OpenVINO)
Supports image understanding via VLMPipeline.

Usage:
  python vision.py --image test.png              # Describe an image
  python vision.py --port 31001                   # HTTP server mode
  python vision.py --port 31001 --device GPU
"""
import sys
import time
import queue
import threading
import argparse
from pathlib import Path

import numpy as np
import openvino as ov
import openvino_genai as ovg
from PIL import Image

DEFAULT_MODEL_PATH = "models/Qwen3-VL-4B-Instruct-int4_asym-ov"
DEFAULT_DEVICE = "GPU"
MAX_IMAGE_SIZE = (1024, 1024)


def load_pipeline(model_path: str, device: str = DEFAULT_DEVICE) -> ovg.VLMPipeline:
    print(f"Loading {Path(model_path).name} on {device}...")
    t0 = time.time()
    pipe = ovg.VLMPipeline(model_path, device)
    print(f"  ✅ Loaded in {time.time() - t0:.1f}s")
    return pipe


def load_image(image_path: str) -> ov.Tensor:
    img = Image.open(image_path).convert("RGB")
    img.thumbnail(MAX_IMAGE_SIZE, Image.LANCZOS)
    img_array = np.array(img, dtype=np.uint8)
    return ov.Tensor(img_array)


def describe(pipe: ovg.VLMPipeline, image_path: str, prompt: str = "请详细描述这张图片的内容。",
             max_tokens: int = 256) -> dict:
    """Describe an image."""
    t0 = time.time()
    image_tensor = load_image(image_path)
    result = pipe.generate(prompt, image=image_tensor, max_new_tokens=max_tokens)
    elapsed = time.time() - t0
    text = result.texts[0] if hasattr(result, 'texts') else str(result)

    return {
        "text": text,
        "time": elapsed,
        "image_path": image_path
    }


def build_vision_usage(prompt: str, text: str) -> dict:
    """Estimate token usage for vision chat responses."""
    return {
        "prompt_tokens": len(prompt) // 4,
        "completion_tokens": len(text) // 4,
        "total_tokens": (len(prompt) + len(text)) // 4
    }


def iter_text_chunks(text: str, chunk_size: int = 16):
    """Yield small text chunks for degraded streaming fallback."""
    if not text:
        return
    for index in range(0, len(text), chunk_size):
        yield text[index:index + chunk_size]


def create_streaming_vision_events(
    pipe: ovg.VLMPipeline,
    prompt: str,
    image_tensor: ov.Tensor,
    model: str,
    stream_context=None,
    max_tokens: int = 256
):
    """Yield incremental vision text events using OpenVINO streamers when available."""
    event_queue: queue.Queue[dict] = queue.Queue()
    collected_chunks: list[str] = []

    def emit_delta(content: str):
        """Store and publish one incremental text fragment."""
        if not content or is_stream_cancelled(stream_context):
            return
        collected_chunks.append(content)
        event_queue.put({
            "type": "delta",
            "content": content,
            "model": model
        })

    def run_generation():
        """Run VLM generation in a worker thread so SSE can flush promptly."""
        try:
            if hasattr(ovg, "TextStreamer") and hasattr(ovg, "StreamingStatus") and hasattr(pipe, "get_tokenizer"):
                streamer = ovg.TextStreamer(
                    pipe.get_tokenizer(),
                    lambda text: _streamer_callback(text, emit_delta, stream_context)
                )
                try:
                    pipe.generate(prompt, image=image_tensor, max_new_tokens=max_tokens, streamer=streamer)
                except TypeError:
                    _generate_with_chunk_fallback(pipe, prompt, image_tensor, max_tokens, emit_delta, stream_context)
            else:
                _generate_with_chunk_fallback(pipe, prompt, image_tensor, max_tokens, emit_delta, stream_context)

            full_text = "".join(collected_chunks)
            if is_stream_cancelled(stream_context):
                return
            event_queue.put({
                "type": "done",
                "model": model,
                "finish_reason": "stop",
                "text": full_text,
                "usage": build_vision_usage(prompt, full_text)
            })
        except Exception as exc:
            event_queue.put({
                "type": "error",
                "model": model,
                "message": str(exc)
            })

    threading.Thread(target=run_generation, daemon=True).start()

    while True:
        event = event_queue.get()
        yield event
        if event.get("type") in ("done", "error"):
            break


def _streamer_callback(text: str, emit_delta, stream_context=None):
    """Forward one decoded fragment and tell OpenVINO generation to continue."""
    if is_stream_cancelled(stream_context):
        return get_cancel_streaming_status()
    emit_delta(text)
    return ovg.StreamingStatus.RUNNING


def _generate_with_chunk_fallback(
    pipe: ovg.VLMPipeline,
    prompt: str,
    image_tensor: ov.Tensor,
    max_tokens: int,
    emit_delta,
    stream_context=None
):
    """Fall back to post-generation chunk flush when native streaming is unavailable."""
    result = pipe.generate(prompt, image=image_tensor, max_new_tokens=max_tokens)
    text = result.texts[0] if hasattr(result, 'texts') else str(result)
    for chunk in iter_text_chunks(text):
        if is_stream_cancelled(stream_context):
            break
        emit_delta(chunk)


def is_stream_cancelled(stream_context=None) -> bool:
    """Return whether the current streaming response has been cancelled."""
    return bool(stream_context and stream_context.is_cancelled())


def get_cancel_streaming_status():
    """Return the best available OpenVINO streaming status for cancellation."""
    return getattr(ovg.StreamingStatus, "CANCEL", getattr(ovg.StreamingStatus, "STOP", ovg.StreamingStatus.RUNNING))


def interactive(pipe: ovg.VLMPipeline):
    """Interactive vision session."""
    print("\n" + "=" * 60)
    print("🖼️  Qwen3-VL-4B Vision")
    print("   Enter image path to describe. Type 'exit' to quit.")
    print("=" * 60)

    while True:
        try:
            image_path = input("\n📷 Image path: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not image_path:
            continue
        if image_path.lower() == "exit":
            break

        if not Path(image_path).exists():
            print(f"  ❌ File not found: {image_path}")
            continue

        prompt = input("❓ Prompt (default=describe): ").strip() or "请详细描述这张图片的内容。"
        result = describe(pipe, image_path, prompt)
        print(f"\n{result['text']}")
        print(f"  [{result['time']:.1f}s]")


def create_vision_handler(pipe: ovg.VLMPipeline):
    """Create HTTP request handler for vision chat completions."""

    def handle(request: dict) -> dict:
        messages = request.get("messages", [])
        model = request.get("model", "qwen3-vl-4b")
        max_tokens = request.get("max_tokens", 256)
        stream = request.get("stream", False)
        stream_context = request.get("_stream_context")

        # Extract text prompt and image
        prompt = ""
        image_path = None

        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, list):
                for part in content:
                    if part.get("type") == "text":
                        prompt += part.get("text", "") + "\n"
                    elif part.get("type") == "image_url":
                        url = part.get("image_url", {}).get("url", "")
                        if url.startswith("data:"):
                            # Decode base64 data URL
                            import base64, tempfile
                            header, b64data = url.split(",", 1)
                            img_bytes = base64.b64decode(b64data)
                            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                                tmp.write(img_bytes)
                                image_path = tmp.name
                        elif url.startswith("http://") or url.startswith("https://"):
                            # Download remote image to temp file
                            import tempfile, urllib.request
                            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                                urllib.request.urlretrieve(url, tmp.name)
                                image_path = tmp.name
                        elif url.startswith("file://"):
                            image_path = url[7:]
                        elif url.startswith("/") or url.startswith("./"):
                            image_path = url
            elif isinstance(content, str):
                prompt += content

        prompt = prompt.strip() or "请详细描述这张图片的内容。"

        if not image_path:
            return {
                "id": f"vision-{int(time.time())}",
                "object": "chat.completion",
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": "No image provided. Please include an image in your request."},
                    "finish_reason": "stop"
                }]
            }

        image_tensor = load_image(image_path)
        if stream:
            return create_streaming_vision_events(pipe, prompt, image_tensor, model, stream_context, max_tokens)

        result = describe(pipe, image_path, prompt, max_tokens)
        text = result["text"].strip()

        response = {
            "id": f"vision-{int(time.time())}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop"
            }],
            "usage": build_vision_usage(prompt, text)
        }

        return response

    return handle


def main():
    parser = argparse.ArgumentParser(description="Qwen3-VL-4B Vision")
    parser.add_argument("--image", "-i", default=None, help="Image file to describe")
    parser.add_argument("--prompt", "-p", default="请详细描述这张图片的内容。")
    parser.add_argument("--max-tokens", type=int, default=256)
    parser.add_argument("--device", default=DEFAULT_DEVICE, choices=["CPU", "GPU", "NPU"])
    parser.add_argument("--model-path", default=None,
                        help=f"Path to model directory (default: {DEFAULT_MODEL_PATH})")
    parser.add_argument("--port", type=int, default=None,
                        help="HTTP server port (default: interactive mode)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="HTTP server bind address")
    args = parser.parse_args()

    model_path = args.model_path or str(Path(__file__).parent.parent / DEFAULT_MODEL_PATH)
    model_path = Path(model_path)
    if not model_path.exists():
        print(f"Model not found: {model_path}")
        sys.exit(1)

    pipe = load_pipeline(str(model_path), args.device)

    # ── HTTP Server Mode ──
    if args.port:
        from server_utils import start_server
        handler = create_vision_handler(pipe)
        print(f"Starting Vision server on http://{args.host}:{args.port}")
        start_server(
            host=args.host,
            port=args.port,
            engine_name="vision",
            handle_chat=handler,
            version=model_path.name.lower()
        )
        return

    # ── CLI Mode ──
    if args.image:
        result = describe(pipe, args.image, args.prompt, args.max_tokens)
        print(result["text"])
        print(f"\n  [{result['time']:.1f}s]")
    else:
        interactive(pipe)


if __name__ == "__main__":
    main()
