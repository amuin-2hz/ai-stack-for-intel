"""
Text Rerank — OpenVINO GenAI TextRerankPipeline

Usage:
  python rerank.py --query "capital of China" --document "Beijing is the capital."
  python rerank.py --port 31005 --device GPU --model-path models/Qwen3-Reranker-0.6B-fp16-ov
"""
import argparse
import time
from pathlib import Path

import openvino_genai as ovg

DEFAULT_MODEL_PATH = "models/Qwen3-Reranker-0.6B-fp16-ov"
DEFAULT_DEVICE = "GPU"


def load_pipeline(model_path: str, device: str = DEFAULT_DEVICE, top_n: int = 10):
    print(f"Loading rerank model on {device}...")
    t0 = time.time()
    pipe = ovg.TextRerankPipeline(model_path, device, top_n=top_n)
    print(f"  Loaded in {time.time() - t0:.1f}s")
    return pipe


def rerank(pipe, query: str, documents: list[str], model: str, top_n: int | None = None) -> dict:
    t0 = time.time()
    result = list(pipe.rerank(query, documents))
    if top_n is not None:
        result = result[:top_n]
    elapsed = time.time() - t0
    return {
        "id": f"rerank-{int(time.time())}",
        "object": "list",
        "model": model,
        "results": [
            {
                "index": int(index),
                "relevance_score": float(score),
                "document": {"text": documents[int(index)]},
            }
            for index, score in result
        ],
        "usage": {"total_tokens": max(1, (len(query) + sum(len(d) for d in documents)) // 4)},
        "time": elapsed,
    }


def create_rerank_handler(pipe):
    def handle(request: dict) -> dict:
        query = str(request.get("query", ""))
        docs_value = request.get("documents", request.get("docs", []))
        model = str(request.get("model", "rerank"))
        top_n_raw = request.get("top_n")
        top_n = int(top_n_raw) if top_n_raw is not None else None
        documents = [str(item.get("text", item)) if isinstance(item, dict) else str(item) for item in docs_value]
        documents = [doc for doc in documents if doc]
        if not query or not documents:
            return {"error": {"message": "query and documents are required"}}
        return rerank(pipe, query, documents, model, top_n)
    return handle


def main():
    parser = argparse.ArgumentParser(description="OpenVINO text rerank engine")
    parser.add_argument("--query", default="capital of China")
    parser.add_argument("--document", action="append", default=[])
    parser.add_argument("--top-n", type=int, default=3)
    parser.add_argument("--device", default=DEFAULT_DEVICE, choices=["CPU", "GPU", "NPU"])
    parser.add_argument("--model-path", default=str(Path(__file__).parent.parent / DEFAULT_MODEL_PATH))
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    model_path = Path(args.model_path)
    if not model_path.exists():
        raise SystemExit(f"Model not found: {model_path}")

    pipe = load_pipeline(str(model_path), args.device, args.top_n)

    if args.port:
        from server_utils import start_server
        start_server(
            host=args.host,
            port=args.port,
            engine_name="rerank",
            handle_rerank=create_rerank_handler(pipe),
            version=model_path.name,
        )
        return

    docs = args.document or ["Beijing is the capital of China.", "Paris is in France."]
    print(rerank(pipe, args.query, docs, model_path.name, args.top_n))


if __name__ == "__main__":
    main()
