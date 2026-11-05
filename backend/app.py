from __future__ import annotations

import asyncio
import json
import logging
import os
import queue
import threading
from collections import defaultdict, deque
from collections.abc import Iterator
from typing import Any

from flask import Flask, Response, jsonify, request, stream_with_context

from .agents import AnalysisError, analyze_posting
from .security import PostingFetchError, resolve_public_target


app = Flask(__name__, static_folder="../frontend/dist", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 4_096
logger = logging.getLogger("chungdo.api")

_RATE_LIMIT_WINDOW_SECONDS = 60
_RATE_LIMIT_REQUESTS = 10
_rate_lock = threading.Lock()
_request_times: dict[str, deque[float]] = defaultdict(deque)


def _error(code: str, message: str, status: int, retryable: bool = False) -> tuple[Response, int]:
    return (
        jsonify(
            error={"code": code, "message": message, "retryable": retryable}
        ),
        status,
    )


def _rate_limited(client_ip: str) -> bool:
    import time

    now = time.monotonic()
    with _rate_lock:
        timestamps = _request_times[client_ip]
        while timestamps and now - timestamps[0] >= _RATE_LIMIT_WINDOW_SECONDS:
            timestamps.popleft()
        if len(timestamps) >= _RATE_LIMIT_REQUESTS:
            return True
        timestamps.append(now)
        if len(_request_times) > 1_000:
            expired_keys = [
                key
                for key, values in _request_times.items()
                if not values or now - values[-1] >= _RATE_LIMIT_WINDOW_SECONDS
            ]
            for key in expired_keys:
                _request_times.pop(key, None)
        return False


def _sse(event: str, payload: dict[str, Any]) -> str:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {data}\n\n"


@app.get("/api/v1/health")
def health() -> Response:
    return jsonify(status="ok")


@app.post("/api/v1/postings/analyze")
def analyze() -> Response | tuple[Response, int]:
    if not request.is_json:
        return _error(
            "UNSUPPORTED_MEDIA_TYPE",
            "요청은 application/json 형식이어야 합니다.",
            415,
        )

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get("url"), str):
        return _error(
            "INVALID_REQUEST", "HTTPS 공고 URL을 입력해 주세요.", 400
        )

    url = payload["url"].strip()
    if not url:
        return _error("INVALID_URL", "공고 URL을 입력해 주세요.", 400)
    if _rate_limited(request.remote_addr or "unknown"):
        response, status = _error(
            "RATE_LIMITED",
            "요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요.",
            429,
            True,
        )
        response.headers["Retry-After"] = str(_RATE_LIMIT_WINDOW_SECONDS)
        return response, status

    try:
        resolve_public_target(url)
    except PostingFetchError as exc:
        status = 403 if exc.code == "URL_NOT_ALLOWED" else 400
        return _error(exc.code, exc.message, status, exc.retryable)

    events: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue()

    def emit(event: str, data: dict[str, Any]) -> None:
        events.put((event, data))

    def run_analysis() -> None:
        emit("status", {"stage": "starting", "message": "에이전트를 준비하고 있습니다."})
        try:
            result = asyncio.run(analyze_posting(url, emit))
            emit("result", result)
        except AnalysisError as exc:
            logger.warning("posting analysis failed code=%s", exc.code)
            emit(
                "error",
                {
                    "code": exc.code,
                    "message": exc.message,
                    "retryable": exc.retryable,
                },
            )
        except PostingFetchError as exc:
            logger.warning("posting fetch failed code=%s", exc.code)
            emit(
                "error",
                {
                    "code": exc.code,
                    "message": exc.message,
                    "retryable": exc.retryable,
                },
            )
        except Exception:
            logger.error("posting analysis failed code=AGENT_FAILED")
            emit(
                "error",
                {
                    "code": "AGENT_FAILED",
                    "message": "공고 분석을 완료하지 못했습니다. 다시 시도하거나 직접 입력해 주세요.",
                    "retryable": True,
                },
            )
        finally:
            events.put(None)

    threading.Thread(target=run_analysis, daemon=True).start()

    @stream_with_context
    def generate() -> Iterator[str]:
        while True:
            item = events.get()
            if item is None:
                return
            event, data = item
            yield _sse(event, data)

    response = Response(generate(), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache, no-transform"
    response.headers["X-Accel-Buffering"] = "no"
    return response


@app.get("/")
def index() -> Response:
    index_file = os.path.join(app.static_folder or "", "index.html")
    if os.path.isfile(index_file):
        return app.send_static_file("index.html")
    return jsonify(
        error={
            "code": "FRONTEND_NOT_BUILT",
            "message": "프런트엔드를 먼저 빌드해 주세요.",
            "retryable": False,
        }
    ), 503


@app.errorhandler(413)
def request_too_large(_exception: Exception) -> tuple[Response, int]:
    return _error(
        "REQUEST_TOO_LARGE",
        "요청 본문이 허용 크기를 초과했습니다.",
        413,
    )


@app.errorhandler(400)
def bad_request(_exception: Exception) -> tuple[Response, int]:
    return _error("INVALID_REQUEST", "요청 형식이 올바르지 않습니다.", 400)


@app.errorhandler(415)
def unsupported_media_type(_exception: Exception) -> tuple[Response, int]:
    return _error(
        "UNSUPPORTED_MEDIA_TYPE",
        "요청은 application/json 형식이어야 합니다.",
        415,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), threaded=True)
