"""
Author: zhenz

Shared HTTP server utilities for inference scripts.
Provides a lightweight JSON HTTP server with health endpoint,
used by chat, vision, asr, and tts scripts when --port is provided.
"""

import json
import os
import traceback
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Callable, Optional

# Module-level handler registry — avoids Python treating class attributes as bound methods
_handlers: dict = {}


class StreamContext:
    """Track client-side cancellation for a streaming response."""

    def __init__(self):
        """Create a new uncancelled stream context."""
        self._cancel_event = threading.Event()

    def cancel(self):
        """Mark the stream as cancelled by the client or transport."""
        self._cancel_event.set()

    def is_cancelled(self) -> bool:
        """Return whether the stream has already been cancelled."""
        return self._cancel_event.is_set()


class InferenceRequestHandler(BaseHTTPRequestHandler):
    """Base handler with JSON support, CORS headers, and health check."""

    engine_name: str = "inference"
    version: str = "0.1.0"

    def log_message(self, format, *args):
        """Suppress default logging to stderr."""
        pass

    def _send_json(self, status: int, data: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        body = self.rfile.read(length)
        return json.loads(body)

    def do_OPTIONS(self):
        self.send_response(204)
        for header in ("Access-Control-Allow-Origin", "Access-Control-Allow-Methods",
                       "Access-Control-Allow-Headers"):
            self.send_header(header, "*")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._send_json(200, {
                "status": "healthy",
                "engine": self.engine_name,
                "version": self.version
            })
        if self.path == "/v1/models":
            model_id = os.environ.get("ENGINE_MODEL_NAME") or os.environ.get("ENGINE_MODEL_ID") or self.version or self.engine_name
            return self._send_json(200, {
                "object": "list",
                "data": [{"id": model_id, "object": "model", "owned_by": self.engine_name}]
            })
        self._send_json(404, {"detail": "Not found"})

    def do_POST(self):
        try:
            body = self._read_body()

            if self.path == "/v1/chat/completions" and _handlers.get("chat"):
                stream = body.get("stream", False)
                stream_context = StreamContext() if stream else None
                if stream_context:
                    body["_stream_context"] = stream_context
                result = _handlers["chat"](body)
                if stream:
                    return self._stream_response(result, stream_context)
                return self._send_json(200, result)

            if self.path == "/v1/audio/transcriptions" and _handlers.get("transcriptions"):
                result = _handlers["transcriptions"](body)
                return self._send_json(200, result)

            if self.path == "/v1/audio/speech" and _handlers.get("speech"):
                result = _handlers["speech"](body)
                if isinstance(result, bytes):
                    self.send_response(200)
                    self.send_header("Content-Type", "audio/wav")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    return self.wfile.write(result)
                return self._send_json(200, result)

            if self.path == "/v1/embeddings" and _handlers.get("embeddings"):
                result = _handlers["embeddings"](body)
                return self._send_json(200, result)

            if self.path in ("/v1/rerank", "/v3/rerank") and _handlers.get("rerank"):
                result = _handlers["rerank"](body)
                return self._send_json(200, result)

            self._send_json(404, {"detail": f"Endpoint not found: {self.path}"})
        except Exception:
            self._send_json(500, {
                "detail": traceback.format_exc()
            })

    def _stream_response(self, result: dict, stream_context: StreamContext | None = None):
        """Send SSE streaming response from either a ready payload or an iterator."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        if isinstance(result, dict):
            model = result.get("model", self.engine_name)
            chunks = result.get("chunks", [result.get("text", "")])
            if isinstance(chunks, str):
                chunks = [chunks]
            try:
                self._write_sse_chunk({
                    "id": "chatcmpl-" + self.engine_name,
                    "object": "chat.completion.chunk",
                    "choices": [{"delta": {"role": "assistant"}, "index": 0}],
                    "model": model
                }, stream_context)
                for chunk in chunks:
                    self._write_sse_chunk({
                        "id": "chatcmpl-" + self.engine_name,
                        "object": "chat.completion.chunk",
                        "choices": [{"delta": {"content": chunk}, "index": 0}],
                        "model": model
                    }, stream_context)
                self._write_sse_chunk({
                    "id": "chatcmpl-" + self.engine_name,
                    "object": "chat.completion.chunk",
                    "choices": [{"delta": {}, "index": 0, "finish_reason": "stop"}],
                    "model": model
                }, stream_context)
                self._write_sse_done(stream_context)
            except (BrokenPipeError, ConnectionResetError):
                if stream_context:
                    stream_context.cancel()
            return

        model = self.engine_name
        finished = False
        self._write_sse_chunk({
            "id": "chatcmpl-" + self.engine_name,
            "object": "chat.completion.chunk",
            "choices": [{"delta": {"role": "assistant"}, "index": 0}],
            "model": model
        }, stream_context)

        try:
            for event in result:
                if stream_context and stream_context.is_cancelled():
                    break
                if isinstance(event, str):
                    self._write_sse_chunk({
                        "id": "chatcmpl-" + self.engine_name,
                        "object": "chat.completion.chunk",
                        "choices": [{"delta": {"content": event}, "index": 0}],
                        "model": model
                    }, stream_context)
                    continue

                if not isinstance(event, dict):
                    continue

                model = event.get("model", model)
                event_type = event.get("type", "delta")
                if event_type == "delta":
                    content = event.get("content", "")
                    if content:
                        self._write_sse_chunk({
                            "id": event.get("id", "chatcmpl-" + self.engine_name),
                            "object": "chat.completion.chunk",
                            "choices": [{"delta": {"content": content}, "index": 0}],
                            "model": model
                        }, stream_context)
                elif event_type == "done":
                    self._write_sse_chunk({
                        "id": event.get("id", "chatcmpl-" + self.engine_name),
                        "object": "chat.completion.chunk",
                        "choices": [{
                            "delta": {},
                            "index": 0,
                            "finish_reason": event.get("finish_reason", "stop")
                        }],
                        "model": model
                    }, stream_context)
                    finished = True
                    break
                elif event_type == "error":
                    self._write_sse_chunk({
                        "error": {
                            "message": event.get("message", "Streaming generation failed"),
                            "type": "server_error",
                            "param": None,
                            "code": "streaming_generation_failed"
                        }
                    }, stream_context)
                    finished = True
                    break
        except (BrokenPipeError, ConnectionResetError):
            if stream_context:
                stream_context.cancel()
            if hasattr(result, "close"):
                result.close()
        finally:
            if not (stream_context and stream_context.is_cancelled()):
                if not finished:
                    self._write_sse_chunk({
                        "id": "chatcmpl-" + self.engine_name,
                        "object": "chat.completion.chunk",
                        "choices": [{"delta": {}, "index": 0, "finish_reason": "stop"}],
                        "model": model
                    }, stream_context)
                self._write_sse_done(stream_context)

    def _write_sse_chunk(self, payload: dict, stream_context: StreamContext | None = None):
        """Write one SSE JSON chunk and flush it immediately."""
        if stream_context and stream_context.is_cancelled():
            return
        data = json.dumps(payload, ensure_ascii=False)
        self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
        self.wfile.flush()

    def _write_sse_done(self, stream_context: StreamContext | None = None):
        """Write the final SSE terminator chunk."""
        if stream_context and stream_context.is_cancelled():
            return
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


def start_server(
    host: str,
    port: int,
    engine_name: str,
    handle_chat: Optional[Callable] = None,
    handle_transcriptions: Optional[Callable] = None,
    handle_speech: Optional[Callable] = None,
    handle_vision: Optional[Callable] = None,
    handle_embeddings: Optional[Callable] = None,
    handle_rerank: Optional[Callable] = None,
    version: str = "0.1.0"
):
    """Create and start an HTTP inference server on the given port."""

    # Store handlers in module-level dict to avoid Python bound-method issues
    _handlers.clear()
    if handle_chat:
        _handlers["chat"] = handle_chat
    if handle_transcriptions:
        _handlers["transcriptions"] = handle_transcriptions
    if handle_speech:
        _handlers["speech"] = handle_speech
    if handle_vision:
        _handlers["vision"] = handle_vision
    if handle_embeddings:
        _handlers["embeddings"] = handle_embeddings
    if handle_rerank:
        _handlers["rerank"] = handle_rerank

    # Subclass to set engine metadata
    class Handler(InferenceRequestHandler):
        pass

    Handler.engine_name = engine_name
    Handler.version = version

    server = HTTPServer((host, port), Handler)
    print(f"  ✅ {engine_name} server listening on http://{host}:{port}")
    print(f"     Health: http://{host}:{port}/health")
    if handle_chat:
        print(f"     Chat:   http://{host}:{port}/v1/chat/completions")
    if handle_embeddings:
        print(f"     Embed:  http://{host}:{port}/v1/embeddings")
    if handle_rerank:
        print(f"     Rerank: http://{host}:{port}/v1/rerank")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print(f"\n{engine_name} server stopped.")
        server.shutdown()
