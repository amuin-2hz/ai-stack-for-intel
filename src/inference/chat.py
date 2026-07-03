"""
LLM Chat — Qwen3.5-2B FP16 (GPU / OpenVINO)
模型: Qwen/Qwen3.5-2B (多模态, 纯文本对话模式)

Usage:
  python chat.py                          # Interactive chat
  python chat.py --prompt "Hello"         # Single-shot
  python chat.py --port 31000             # HTTP server mode
  python chat.py --port 31000 --device GPU --model-path models/Qwen3.5-2B-fp16-ov
"""
import sys
import time
import json
import argparse
from pathlib import Path
import openvino_genai as ovg

DEFAULT_MODEL_PATH = "models/Qwen3.5-2B-fp16-ov"
DEFAULT_DEVICE = "GPU"


def load_model(model_path: str, device: str = DEFAULT_DEVICE) -> ovg.VLMPipeline:
    """Load Qwen3.5-2B as VLMPipeline (supports text-only + image input)."""
    print(f"Loading Qwen3.5-2B on {device}...")
    t0 = time.time()
    pipe = ovg.VLMPipeline(str(model_path), device)
    print(f"  ✅ Loaded in {time.time() - t0:.1f}s")
    return pipe


def chat(pipe: ovg.VLMPipeline, prompt: str, max_tokens: int = 256,
         temperature: float = 0.7) -> dict:
    """Single-turn text generation (no image)."""
    config = pipe.get_generation_config()
    config.max_new_tokens = max_tokens
    config.temperature = temperature
    config.do_sample = temperature > 0

    t0 = time.time()
    result = pipe.generate(prompt, generation_config=config)
    elapsed = time.time() - t0

    text = result.texts[0] if hasattr(result, 'texts') else str(result)

    return {
        "text": text,
        "time": elapsed,
        "chars": len(text),
        "chars_per_sec": len(text) / elapsed if elapsed > 0 else 0,
    }


def chat_loop(pipe: ovg.VLMPipeline):
    """Interactive chat session."""
    print("\n" + "=" * 60)
    print("💬 Qwen3.5-2B Chat (FP16 on GPU)")
    print("   Type 'exit' to quit, 'clear' to reset context")
    print("=" * 60)

    history = []

    while True:
        try:
            user_input = input("\n👤 You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not user_input:
            continue
        if user_input.lower() == "exit":
            print("Goodbye!")
            break
        if user_input.lower() == "clear":
            history = []
            print("\033[2J\033[H")
            continue

        if history:
            context = "\n".join(history)
            prompt = f"{context}\n用户: {user_input}\n助手: "
        else:
            prompt = f"<|im_start|>user\n{user_input}<|im_end|>\n<|im_start|>assistant\n"

        print("🤖 Assistant: ", end="", flush=True)
        result = chat(pipe, prompt)
        response = result["text"].strip()
        print(response)
        print(f"  [{result['time']:.1f}s | {result['chars']} chars | "
              f"{result['chars_per_sec']:.0f} chars/s]")

        history.append(f"用户: {user_input}")
        history.append(f"助手: {response}")
        if len(history) > 10:
            history = history[-10:]


def benchmark(pipe: ovg.VLMPipeline, prompts: list, max_tokens: int = 128):
    """Run several test prompts and report speed."""
    print(f"\n{'='*60}")
    print("🏃 Benchmark — Qwen3.5-2B FP16 GPU")
    print(f"{'='*60}")

    total_chars = 0
    total_time = 0

    for i, prompt in enumerate(prompts, 1):
        print(f"\n[{i}/{len(prompts)}] {prompt[:60]}...")
        result = chat(pipe, prompt, max_tokens=max_tokens)
        total_chars += result["chars"]
        total_time += result["time"]
        print(f"  → {result['text'][:120]}...")
        print(f"  ⏱ {result['time']:.1f}s | {result['chars_per_sec']:.0f} chars/s")

    print(f"\n{'='*60}")
    print(f"Summary: {total_chars} chars in {total_time:.1f}s | "
          f"avg {total_chars/total_time:.0f} chars/s")
    print(f"{'='*60}")


def create_chat_handler(pipe: ovg.VLMPipeline):
    """Create an HTTP request handler for /v1/chat/completions."""

    def handle(request: dict) -> dict:
        messages = request.get("messages", [])
        model = request.get("model", "qwen35-2b")
        max_tokens = request.get("max_tokens", 256)
        temperature = request.get("temperature", 0.7)
        stream = request.get("stream", False)

        # Build prompt from messages
        prompt = ""
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if isinstance(content, list):
                # Multi-modal content (text + image) — extract text
                content = " ".join(
                    part.get("text", "") for part in content
                    if part.get("type") == "text"
                )
            if role == "system":
                prompt += f"<|im_start|>system\n{content}<|im_end|>\n"
            elif role == "user":
                prompt += f"<|im_start|>user\n{content}<|im_end|>\n"
            elif role == "assistant":
                prompt += f"<|im_start|>assistant\n{content}<|im_end|>\n"

        prompt += "<|im_start|>assistant\n"

        print(f"  📝 Prompt: {prompt[:100]}...")

        result = chat(pipe, prompt, max_tokens, temperature)
        text = result["text"].strip()

        response = {
            "id": f"chatcmpl-{int(time.time())}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": len(prompt) // 4,
                "completion_tokens": len(text) // 4,
                "total_tokens": (len(prompt) + len(text)) // 4
            }
        }

        if stream:
            response["chunks"] = [text[i:i+16] for i in range(0, len(text), 16)] or [text]

        return response

    return handle


def main():
    parser = argparse.ArgumentParser(description="Qwen3.5-2B Chat on GPU")
    parser.add_argument("--prompt", "-p", default=None,
                        help="Single prompt mode (no interactive chat)")
    parser.add_argument("--max-tokens", type=int, default=256)
    parser.add_argument("--temperature", type=float, default=0.7)
    parser.add_argument("--device", default=DEFAULT_DEVICE, choices=["CPU", "GPU", "NPU"])
    parser.add_argument("--model-path", default=None,
                        help=f"Path to model directory (default: {DEFAULT_MODEL_PATH})")
    parser.add_argument("--port", type=int, default=None,
                        help="HTTP server port (default: interactive mode)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="HTTP server bind address")
    parser.add_argument("--benchmark", action="store_true",
                        help="Run benchmark with test prompts")
    args = parser.parse_args()

    # Resolve model path
    model_path = args.model_path or str(Path(__file__).parent.parent / DEFAULT_MODEL_PATH)
    model_path = Path(model_path)
    if not model_path.exists():
        print(f"Model not found: {model_path}")
        print("Available models:")
        models_dir = Path(__file__).parent.parent / "models"
        if models_dir.exists():
            for d in sorted(models_dir.iterdir()):
                if d.is_dir():
                    print(f"  - {d.name}")
        sys.exit(1)

    pipe = load_model(str(model_path), args.device)

    # ── HTTP Server Mode ──
    if args.port:
        from server_utils import start_server
        handler = create_chat_handler(pipe)
        print(f"Starting Chat server on http://{args.host}:{args.port}")
        start_server(
            host=args.host,
            port=args.port,
            engine_name="chat",
            handle_chat=handler,
            version="qwen35-2b"
        )
        return

    # ── CLI Mode ──
    if args.benchmark:
        test_prompts = [
            "你好，请用一句话介绍你自己。",
            "什么是深度学习？请简要解释。",
            "用Python写一个快速排序算法。",
            "请讲一个关于勇气的小故事。",
        ]
        benchmark(pipe, test_prompts)
    elif args.prompt:
        result = chat(pipe, args.prompt, args.max_tokens, args.temperature)
        print(result["text"])
        print(f"\n{'='*60}")
        print(f"Time: {result['time']:.1f}s | Chars: {result['chars']} | "
              f"Speed: {result['chars_per_sec']:.0f} chars/s")
    else:
        chat_loop(pipe)


if __name__ == "__main__":
    main()
