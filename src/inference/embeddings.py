"""
Text Embeddings — OpenVINO GenAI TextEmbeddingPipeline

Usage:
  python embeddings.py --prompt "hello"
  python embeddings.py --port 31004 --device GPU --model-path models/Qwen3-Embedding-0.6B-fp16-ov
"""
import argparse
import time
from pathlib import Path

import numpy as np
import openvino_genai as ovg

DEFAULT_MODEL_PATH = "models/Qwen3-Embedding-0.6B-fp16-ov"
DEFAULT_DEVICE = "GPU"


def _to_vector(value) -> list[float]:
    if hasattr(value, "embedding"):
        value = value.embedding
    elif hasattr(value, "embeddings"):
        value = value.embeddings
    if isinstance(value, (list, tuple)) and len(value) == 1 and not isinstance(value[0], (int, float)):
        value = value[0]
    arr = np.asarray(value, dtype=np.float32).reshape(-1)
    return arr.tolist()


def _to_vectors(value) -> list[list[float]]:
    if hasattr(value, "embeddings"):
        value = value.embeddings
    try:
        return [_to_vector(item) for item in value]
    except TypeError:
        return [_to_vector(value)]


def load_pipeline(model_path: str, device: str = DEFAULT_DEVICE):
    print(f"Loading embedding model on {device}...")
    t0 = time.time()
    pipe = ovg.TextEmbeddingPipeline(
        model_path,
        device,
        pooling_type=ovg.TextEmbeddingPipeline.PoolingType.LAST_TOKEN,
        normalize=True,
        padding_side="left",
    )
    print(f"  Loaded in {time.time() - t0:.1f}s")
    return pipe


def embed(pipe, texts: list[str], model: str) -> dict:
    t0 = time.time()
    vectors = _to_vectors(pipe.embed_documents(texts))
    elapsed = time.time() - t0
    return {
        "object": "list",
        "model": model,
        "data": [
            {"object": "embedding", "index": i, "embedding": vector}
            for i, vector in enumerate(vectors)
        ],
        "usage": {
            "prompt_tokens": sum(max(1, len(text) // 4) for text in texts),
            "total_tokens": sum(max(1, len(text) // 4) for text in texts),
        },
        "time": elapsed,
    }


def create_embeddings_handler(pipe):
    def handle(request: dict) -> dict:
        value = request.get("input", request.get("texts", ""))
        model = request.get("model", "embedding")
        if isinstance(value, str):
            texts = [value]
        elif isinstance(value, list):
            texts = [str(item) for item in value]
        else:
            texts = [str(value)]
        texts = [text for text in texts if text]
        if not texts:
            return {"error": {"message": "input is required"}}
        return embed(pipe, texts, str(model))
    return handle


def main():
    parser = argparse.ArgumentParser(description="OpenVINO text embedding engine")
    parser.add_argument("--prompt", "-p", default=None)
    parser.add_argument("--device", default=DEFAULT_DEVICE, choices=["CPU", "GPU", "NPU"])
    parser.add_argument("--model-path", default=str(Path(__file__).parent.parent / DEFAULT_MODEL_PATH))
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    model_path = Path(args.model_path)
    if not model_path.exists():
        raise SystemExit(f"Model not found: {model_path}")

    pipe = load_pipeline(str(model_path), args.device)

    if args.port:
        from server_utils import start_server
        start_server(
            host=args.host,
            port=args.port,
            engine_name="embedding",
            handle_embeddings=create_embeddings_handler(pipe),
            version=model_path.name,
        )
        return

    text = args.prompt or "hello"
    result = embed(pipe, [text], model_path.name)
    print({"dimensions": len(result["data"][0]["embedding"]), "time": result["time"]})


if __name__ == "__main__":
    main()
