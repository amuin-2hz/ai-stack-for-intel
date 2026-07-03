"""
WebSocket server utilities for Python inference engines.
Runs alongside the HTTP server — handles /health over HTTP,
streaming TTS/ASR over WebSocket, all on one port.

Usage in tts_qwen.py / asr.py (--port mode):
    from ws_server import start_ws_server
    start_ws_server(host, port, engine_name, ws_handler, version)
"""

import asyncio
import json
import os
import signal
import time
import threading
import traceback
from typing import Callable, Awaitable

import websockets
from websockets.asyncio.server import serve as ws_serve


# Module-level callback registry (mirrors server_utils._handlers pattern)
_ws_handler_factory: Callable | None = None


def start_ws_server(
    host: str,
    port: int,
    engine_name: str,
    handle_ws_message: Callable[[dict], Awaitable[dict | bytes | None]],
    version: str = "0.1.0",
):
    """Start a unified HTTP+WebSocket server on `port`.

    HTTP:
      GET /health          → engine manager health check
      GET /v1/models       → model listing

    WebSocket:
      /v1/audio/speech         → streaming TTS (binary WAV chunks)
      /v1/audio/transcriptions → streaming ASR (binary audio → text)

    The `handle_ws_message` callback receives parsed JSON messages and
    returns responses.  For binary frames, the raw bytes are passed as
    {"_binary": <bytes>}.
    """
    global _ws_handler_factory
    _ws_handler_factory = handle_ws_message

    async def process_http(connection, request):
        """Handle plain HTTP requests (health check & model list)."""
        if request.path == "/health":
            payload = json.dumps({
                "status": "healthy",
                "engine": engine_name,
                "version": version,
            }, ensure_ascii=False)
            response = connection.respond(200, payload)
            response.headers["Content-Type"] = "application/json; charset=utf-8"
            return response

        if request.path == "/v1/models":
            model_id = os.environ.get("ENGINE_MODEL_NAME") or os.environ.get("ENGINE_MODEL_ID") or version or engine_name
            payload = json.dumps({
                "object": "list",
                "data": [{"id": model_id, "object": "model", "owned_by": engine_name}],
            }, ensure_ascii=False)
            response = connection.respond(200, payload)
            response.headers["Content-Type"] = "application/json; charset=utf-8"
            return response

        # Everything else: allow WebSocket upgrade
        return None

    async def handle_ws(websocket):
        """Handle a WebSocket connection.

        Creates a per-connection message handler to avoid shared mutable state
        between connections (e.g. ASR audio_chunks leaking across users).
        Falls back to shared handler for backward compatibility.
        """
        # Try to create a per-connection handler (factory pattern).
        # If the registered callback is a factory (callable with no args
        # that returns another callable), use it. Otherwise use it directly
        # as a shared handler (backward compat).
        try:
            handler = _ws_handler_factory()
            if not callable(handler):
                print("   [WS] Handler factory returned non-callable, falling back to shared handler")
                handler = _ws_handler_factory  # fallback: use as shared
            else:
                print("   [WS] Created per-connection handler")
        except (TypeError, Exception):
            print("   [WS] Handler factory failed, falling back to shared handler")
            handler = _ws_handler_factory  # fallback: use as shared

        try:
            async for message in websocket:
                done = False
                try:
                    # Text message: parse JSON
                    if isinstance(message, bytes):
                        data = {"_binary": message}
                    else:
                        data = json.loads(message)

                    result = handler(data)

                    # Support both async generators (streaming TTS)
                    # and regular coroutines (ASR — must await first).
                    if hasattr(result, '__aiter__'):
                        # Async generator: iterate over yielded chunks
                        async for chunk in result:
                            if chunk is None:
                                continue
                            elif isinstance(chunk, dict):
                                await websocket.send(json.dumps(chunk, ensure_ascii=False))
                                if chunk.get("type") in ("done", "error"):
                                    done = True
                                    break
                            elif isinstance(chunk, bytes):
                                await websocket.send(chunk)
                    elif hasattr(result, '__await__'):
                        # Regular coroutine: await it, then handle the return value
                        result = await result
                        if result is None:
                            continue
                        elif isinstance(result, dict):
                            await websocket.send(json.dumps(result, ensure_ascii=False))
                            if result.get("type") in ("done", "error", "result"):
                                done = True
                        elif isinstance(result, bytes):
                            await websocket.send(result)

                except json.JSONDecodeError:
                    await websocket.send(json.dumps({"type": "error", "message": "Invalid JSON"}))
                except Exception:
                    await websocket.send(json.dumps({
                        "type": "error",
                        "message": traceback.format_exc(),
                    }))

                if done:
                    return  # clean exit — close the WebSocket properly

        except websockets.exceptions.ConnectionClosed:
            pass  # client disconnected, clean exit

    async def serve_forever():
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()

        # Register signal handlers so Ctrl+C / SIGTERM cleanly stops the server.
        # Only works in the main thread — when running in a background thread
        # (e.g. spawned by engineManager.ts), signal handlers can't be added.
        try:
            loop.add_signal_handler(signal.SIGTERM, stop.set)
            loop.add_signal_handler(signal.SIGINT, stop.set)
        except (NotImplementedError, RuntimeError):
            pass  # Windows or non-main thread

        # Suppress noisy tracebacks from empty TCP connections (health probes,
        # port scanners) that websockets prints to stderr via asyncio.
        import logging
        logging.getLogger("websockets").setLevel(logging.ERROR)

        def _quiet_exceptions(loop, ctx):
            exc = ctx.get("exception")
            if isinstance(exc, (EOFError, ConnectionError, ConnectionResetError)):
                return  # ignore — harmless TCP probes
            loop.default_exception_handler(ctx)

        loop.set_exception_handler(_quiet_exceptions)

        async with ws_serve(handle_ws, host, port, process_request=process_http,
                            max_size=16 * 1024 * 1024):  # 16 MB max message
            print(f"  ✅ {engine_name} WS+HTTP server on ws://{host}:{port}")
            print(f"     Health: http://{host}:{port}/health")
            await stop.wait()

    def _run():
        try:
            asyncio.run(serve_forever())
        except (KeyboardInterrupt, asyncio.CancelledError):
            pass  # clean exit
        except Exception as e:
            # Don't crash on transport errors (empty TCP probes, etc.)
            print(f"  ⚠️  Server stopped: {e}")

    t = threading.Thread(target=_run, daemon=True, name=f"ws-{engine_name}")
    t.start()
    time.sleep(0.3)  # brief wait for server socket to bind
    return t
