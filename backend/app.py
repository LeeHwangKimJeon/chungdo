from __future__ import annotations

import asyncio
import json
import logging
import os
import queue
import threading
from collections import defaultdict, deque
from collections.abc import Iterator
from collections.abc import Awaitable, Callable
from datetime import date
from pathlib import Path
from typing import Any, TypeVar

from flask import Flask, Response, jsonify, request, stream_with_context
from pydantic import BaseModel, ValidationError

from .agents import (
    AnalysisError,
    analyze_posting,
    generate_daily_plan,
    generate_draft,
    generate_interview_turn,
)
from .contracts import (
    CuratedPosting,
    DailyPlanRequest,
    DraftRequest,
    InterviewRequest,
)
from .security import PostingFetchError, resolve_public_target


app = Flask(__name__, static_folder="../frontend/dist", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 64_000
logger = logging.getLogger("chungdo.api")

_RATE_LIMIT_WINDOW_SECONDS = 60
_RATE_LIMIT_REQUESTS = 10
_AI_OPERATION_TIMEOUT_SECONDS = 120
_rate_lock = threading.Lock()
_request_times: dict[str, deque[float]] = defaultdict(deque)
_CURATED_POSTINGS_PATH = Path(
    os.getenv(
        "CURATED_POSTINGS_FILE",
        str(Path(__file__).parent / "data" / "curated_postings.json"),
    )
)
_ResultT = TypeVar("_ResultT", bound=BaseModel)


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


def _validated_request(
    model: type[_ResultT], *, require_consent: bool = False
) -> _ResultT | tuple[Response, int]:
    if not request.is_json:
        return _error(
            "UNSUPPORTED_MEDIA_TYPE",
            "요청은 application/json 형식이어야 합니다.",
            415,
        )
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return _error("INVALID_REQUEST", "JSON 요청 본문이 필요합니다.", 400)
    try:
        result = model.model_validate(payload)
    except ValidationError:
        return _error(
            "INVALID_REQUEST",
            "필수 항목, 글자 수 또는 날짜 형식을 확인해 주세요.",
            400,
        )
    if require_consent and not getattr(result, "consent", False):
        return _error(
            "CONSENT_REQUIRED",
            "AI에 전송할 내용과 범위를 확인하고 동의해 주세요.",
            400,
        )
    return result


def _stream_response(
    *,
    feature: str,
    run: Callable[[Any, Callable[[str, dict[str, Any]], None]], Awaitable[Any]],
    payload: Any,
) -> Response:
    events: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue()

    def emit(event: str, data: dict[str, Any]) -> None:
        events.put((event, data))

    def execute() -> None:
        emit("status", {"stage": "starting", "message": "에이전트를 준비하고 있습니다."})
        try:
            result = asyncio.run(
                asyncio.wait_for(
                    run(payload, emit), timeout=_AI_OPERATION_TIMEOUT_SECONDS
                )
            )
            emit("result", result)
        except TimeoutError:
            emit(
                "error",
                {
                    "code": "AGENT_TIMEOUT",
                    "message": "AI 작업 시간이 초과되었습니다. 다시 시도해 주세요.",
                    "retryable": True,
                },
            )
        except AnalysisError as exc:
            logger.warning("%s failed code=%s", feature, exc.code)
            emit(
                "error",
                {
                    "code": exc.code,
                    "message": exc.message,
                    "retryable": exc.retryable,
                },
            )
        except Exception:
            logger.error("%s failed code=AGENT_FAILED", feature)
            emit(
                "error",
                {
                    "code": "AGENT_FAILED",
                    "message": "요청을 완료하지 못했습니다. 다시 시도해 주세요.",
                    "retryable": True,
                },
            )
        finally:
            events.put(None)

    threading.Thread(target=execute, daemon=True).start()

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


def _load_curated_postings() -> list[CuratedPosting]:
    try:
        raw_data = json.loads(_CURATED_POSTINGS_PATH.read_text(encoding="utf-8"))
        if not isinstance(raw_data, list) or len(raw_data) > 500:
            raise ValueError("Curated posting file must be a list of at most 500 entries.")
        return [CuratedPosting.model_validate(item) for item in raw_data]
    except FileNotFoundError:
        return []
    except (OSError, json.JSONDecodeError, ValidationError, ValueError) as exc:
        raise AnalysisError(
            "CURATED_DATA_INVALID",
            "검증 공고 목록을 읽지 못했습니다. 운영자에게 문의해 주세요.",
        ) from exc


def _recommendation_reason(posting: CuratedPosting, query: str) -> str:
    if not query:
        return "운영자가 출처를 확인한 공고입니다."
    haystack = " ".join(
        [posting.company, posting.title, *posting.keywords]
    ).casefold()
    terms = [term for term in query.casefold().split() if term in haystack]
    if terms:
        return f"검색어 '{', '.join(terms)}'가 공고 정보와 일치합니다."
    return "검증 공고 목록의 공고입니다."


@app.get("/api/v1/health")
def health() -> Response:
    return jsonify(status="ok")


@app.post("/api/v1/postings/analyze")
def analyze() -> Response | tuple[Response, int]:
    if request.content_length and request.content_length > 4_096:
        return _error(
            "REQUEST_TOO_LARGE", "요청 본문은 4KB 이하여야 합니다.", 413
        )
    if not request.is_json:
        return _error(
            "UNSUPPORTED_MEDIA_TYPE",
            "요청은 application/json 형식이어야 합니다.",
            415,
        )
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get("url"), str):
        return _error("INVALID_REQUEST", "HTTPS 공고 URL을 입력해 주세요.", 400)

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

    return _stream_response(
        feature="posting analysis",
        run=lambda value, emit: analyze_posting(value, emit),
        payload=url,
    )


@app.get("/api/v1/postings/recommendations")
def recommendations() -> Response | tuple[Response, int]:
    query = request.args.get("q", "").strip()
    location = request.args.get("location", "").strip()
    if len(query) > 100 or len(location) > 100:
        return _error(
            "INVALID_REQUEST", "검색어와 지역은 각각 100자 이하여야 합니다.", 400
        )

    try:
        postings = _load_curated_postings()
    except AnalysisError as exc:
        return _error(exc.code, exc.message, 500)

    today = date.today()
    results: list[dict[str, Any]] = []
    for posting in postings:
        if posting.deadline and posting.deadline < today:
            continue
        if location and (
            not posting.location
            or location.casefold() not in posting.location.casefold()
        ):
            continue
        search_text = " ".join(
            [posting.company, posting.title, *posting.keywords]
        ).casefold()
        if query and not any(
            term in search_text for term in query.casefold().split()
        ):
            continue
        result = posting.model_dump(mode="json")
        result["url"] = str(posting.url)
        result["reason"] = _recommendation_reason(posting, query)
        results.append(result)
    return jsonify(items=results[:50])


@app.post("/api/v1/plans/daily")
def daily_plan() -> Response | tuple[Response, int]:
    payload = _validated_request(DailyPlanRequest)
    if isinstance(payload, tuple):
        return payload
    if _rate_limited(request.remote_addr or "unknown"):
        response, status = _error(
            "RATE_LIMITED", "요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요.", 429, True
        )
        response.headers["Retry-After"] = str(_RATE_LIMIT_WINDOW_SECONDS)
        return response, status
    return _stream_response(
        feature="daily plan",
        run=generate_daily_plan,
        payload=payload,
    )


@app.post("/api/v1/interviews/turns")
def interview_turn() -> Response | tuple[Response, int]:
    payload = _validated_request(InterviewRequest, require_consent=True)
    if isinstance(payload, tuple):
        return payload
    if _rate_limited(request.remote_addr or "unknown"):
        response, status = _error(
            "RATE_LIMITED", "요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요.", 429, True
        )
        response.headers["Retry-After"] = str(_RATE_LIMIT_WINDOW_SECONDS)
        return response, status
    return _stream_response(
        feature="interview coaching",
        run=generate_interview_turn,
        payload=payload,
    )


@app.post("/api/v1/drafts/generate")
def draft_generate() -> Response | tuple[Response, int]:
    payload = _validated_request(DraftRequest, require_consent=True)
    if isinstance(payload, tuple):
        return payload
    if _rate_limited(request.remote_addr or "unknown"):
        response, status = _error(
            "RATE_LIMITED", "요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요.", 429, True
        )
        response.headers["Retry-After"] = str(_RATE_LIMIT_WINDOW_SECONDS)
        return response, status
    return _stream_response(
        feature="document draft",
        run=generate_draft,
        payload=payload,
    )


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
