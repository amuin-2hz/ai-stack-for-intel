"""
Phase 1 性能基准测试
测试 LLM + VLM + TTS + ASR 在 CPU/NPU 上的推理速度和内存占用
"""

import time
import sys
import json
import argparse
import numpy as np
from pathlib import Path

# --- LLM Benchmark ---
def bench_llm(device="CPU"):
    """Benchmark LLM text generation."""
    print("\n" + "=" * 60)
    print("📝 LLM: Qwen2.5-1.5B INT8")
    print("=" * 60)

    import openvino as ov
    import openvino_genai as ovg

    model_path = "models/Qwen2.5-1.5B-int8-ov"
    if not Path(model_path).exists():
        print("  SKIP — model not found")
        return None

    core = ov.Core()
    model = core.read_model(f"{model_path}/openvino_model.xml")
    model.reshape({"input_ids": [1, -1], "attention_mask": [1, -1], "position_ids": [1, -1]})
    compiled = core.compile_model(model, device)
    tokenizer = ovg.Tokenizer(model_path)

    prompts = [
        ("短对话", "你好，请介绍自己。"),
        ("中文理解", "请用一句话解释什么是机器学习。"),
        ("长文本", "写一篇关于人工智能未来发展的短文，不少于100字。"),
    ]

    results = []
    for label, prompt in prompts:
        encoded = tokenizer.encode(prompt)
        input_ids = np.array(encoded.input_ids.data, dtype=np.int64)
        generated = []
        curr_ids = input_ids.copy()
        t0 = time.time()

        for _ in range(128):
            seq_len = curr_ids.shape[1]
            infer = compiled.create_infer_request()
            infer.set_tensor("input_ids", ov.Tensor(curr_ids))
            infer.set_tensor("attention_mask", ov.Tensor(np.ones((1, seq_len), dtype=np.int64)))
            infer.set_tensor("position_ids", ov.Tensor(np.arange(seq_len, dtype=np.int64).reshape(1, -1)))
            infer.infer()
            logits = infer.get_tensor("logits").data
            next_token = int(np.argmax(logits[0, -1, :]))
            generated.append(next_token)
            curr_ids = np.concatenate([curr_ids, np.array([[next_token]], dtype=np.int64)], axis=1)
            if next_token == tokenizer.get_eos_token_id():
                break

        elapsed = time.time() - t0
        tokens = len(generated)
        result = {"task": label, "tokens": tokens, "time": elapsed, "tok_per_s": tokens / elapsed}
        results.append(result)
        print(f"  {label}: {tokens} tokens, {elapsed:.1f}s, {tokens/elapsed:.1f} tok/s")

    avg_speed = sum(r["tok_per_s"] for r in results) / len(results)
    print(f"  Average: {avg_speed:.1f} tok/s")
    return {"model": "Qwen2.5-1.5B INT8", "device": device, "avg_tok_per_s": avg_speed, "details": results}


# --- VLM Benchmark ---
def bench_vlm(device="CPU"):
    """Benchmark VLM image understanding."""
    print("\n" + "=" * 60)
    print("🖼️  VLM: Qwen3-VL-4B INT4")
    print("=" * 60)

    from PIL import Image

    model_path = "models/Qwen3-VL-4B-Instruct-int4_asym-ov"
    if not Path(model_path).exists():
        print("  SKIP — model not found")
        return None

    import openvino_genai as ovg

    # Create test image
    img = Image.new("RGB", (256, 256), color="white")
    data = np.array(img).reshape(1, 256, 256, 3).astype(np.uint8)
    image_tensor = __import__('openvino').Tensor(data)

    t0 = time.time()
    pipe = ovg.VLMPipeline(model_path, device)
    load_time = time.time() - t0

    config = pipe.get_generation_config()
    config.max_new_tokens = 64

    prompts = [
        ("描述", "请描述这张图片。"),
        ("问答", "这张图片的背景色是什么？"),
    ]

    results = []
    for label, prompt in prompts:
        t0 = time.time()
        result = pipe.generate(prompt, image=image_tensor, generation_config=config)
        elapsed = time.time() - t0
        text = result.texts[0] if hasattr(result, 'texts') else str(result)
        results.append({"task": label, "time": elapsed, "chars": len(text)})
        print(f"  {label}: {elapsed:.1f}s, {len(text)} chars — {text[:60]}...")

    print(f"  Load time: {load_time:.1f}s")
    return {"model": "Qwen3-VL-4B INT4", "device": device, "load_time": load_time, "details": results}


# --- TTS Benchmark ---
def bench_tts():
    """Benchmark TTS synthesis."""
    print("\n" + "=" * 60)
    print("🔊 TTS: CosyVoice-300M")
    print("=" * 60)

    model_path = "models/CosyVoice-300M"
    if not Path(model_path).exists():
        print("  SKIP — model not found")
        return None

    try:
        import onnxruntime as ort
        t0 = time.time()
        sessions = {}
        for name, fname in [
            ("campplus", "campplus.onnx"),
            ("flow_decoder", "flow.decoder.estimator.fp32.onnx"),
            ("speech_tokenizer", "speech_tokenizer_v1.onnx"),
        ]:
            fpath = Path(model_path) / fname
            if fpath.exists():
                opts = ort.SessionOptions()
                opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
                sessions[name] = ort.InferenceSession(str(fpath), opts, providers=["CPUExecutionProvider"])

        load_time = time.time() - t0
        print(f"  Loaded {len(sessions)} ONNX models in {load_time:.1f}s")

        # Quick inference test
        if "speech_tokenizer" in sessions:
            t0 = time.time()
            dummy = np.zeros((1, 100), dtype=np.int64)
            audio = sessions["speech_tokenizer"].run(None, {"input": dummy})[0]
            infer_time = time.time() - t0
            print(f"  Speech tokenizer: {infer_time*1000:.0f}ms, output shape {audio.shape}")

        return {"model": "CosyVoice-300M", "onnx_components": len(sessions), "load_time": load_time}

    except Exception as e:
        print(f"  ❌ {e}")
        return None


# --- Main ---
def main():
    parser = argparse.ArgumentParser(description="Phase 1 Benchmark Suite")
    parser.add_argument("--device", default="CPU", choices=["CPU", "GPU", "NPU"])
    parser.add_argument("--output", "-o", default=None, help="Save results to JSON")
    parser.add_argument("--skip", nargs="*", choices=["llm", "vlm", "tts"], help="Skip benchmarks")
    args = parser.parse_args()

    skip = set(args.skip or [])

    print("=" * 60)
    print("🚀 Phase 1 Benchmark Suite")
    print(f"   Device: {args.device}")
    print("=" * 60)

    results = {}

    if "llm" not in skip:
        results["llm"] = bench_llm(args.device)

    if "vlm" not in skip:
        results["vlm"] = bench_vlm(args.device)

    if "tts" not in skip:
        results["tts"] = bench_tts()

    # Summary
    print("\n" + "=" * 60)
    print("📊 Summary")
    print("=" * 60)
    if results.get("llm"):
        print(f"  LLM: {results['llm']['avg_tok_per_s']:.1f} tok/s on {args.device}")
    if results.get("vlm"):
        print(f"  VLM: loaded in {results['vlm']['load_time']:.1f}s on {args.device}")
    if results.get("tts"):
        print(f"  TTS: {results['tts']['onnx_components']} ONNX models loaded")

    if args.output:
        with open(args.output, "w") as f:
            json.dump(results, f, indent=2, ensure_ascii=False, default=str)
        print(f"\nResults saved to {args.output}")


if __name__ == "__main__":
    main()
