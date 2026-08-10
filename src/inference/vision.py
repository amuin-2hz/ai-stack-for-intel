"""
VLM Vision — Qwen2.5-VL-3B FP16 (OpenVINO)
Supports image understanding via VLMPipeline.

Usage:
  python vision.py --image test.png              # Describe an image
  python vision.py --port 31001                   # HTTP server mode
  python vision.py --port 31001 --device GPU
"""
import sys
import time
import argparse
from pathlib import Path

import numpy as np
import openvino as ov
import openvino_genai as ovg
from PIL import Image

DEFAULT_MODEL_PATH = "models/Qwen2.5-VL-3B-fp16-ov"
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


def interactive(pipe: ovg.VLMPipeline):
    """Interactive vision session."""
    print("\n" + "=" * 60)
    print("🖼️  Qwen2.5-VL-3B Vision")
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
        model = request.get("model", "qwen25-vl-3b")
        max_tokens = request.get("max_tokens", 256)
        stream = request.get("stream", False)

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
            }]
        }

        if stream:
            response["chunks"] = [text[i:i+16] for i in range(0, len(text), 16)] or [text]

        return response

    return handle


def main():
    parser = argparse.ArgumentParser(description="Qwen2.5-VL-3B Vision")
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
