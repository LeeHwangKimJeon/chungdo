from __future__ import annotations

from backend import app as app_module
from backend.app import app
from backend.security import PostingFetchError, resolve_public_target


def test_health_returns_ok() -> None:
    response = app.test_client().get("/api/v1/health")

    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}


def test_analyze_requires_json() -> None:
    response = app.test_client().post(
        "/api/v1/postings/analyze", data="url=https://example.com"
    )

    assert response.status_code == 415
    assert response.get_json()["error"]["code"] == "UNSUPPORTED_MEDIA_TYPE"


def test_analyze_rejects_non_https_url() -> None:
    response = app.test_client().post(
        "/api/v1/postings/analyze",
        json={"url": "http://example.com/jobs/1"},
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "INVALID_URL"


def test_analyze_rejects_private_ip() -> None:
    response = app.test_client().post(
        "/api/v1/postings/analyze",
        json={"url": "https://127.0.0.1/jobs/1"},
    )

    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "URL_NOT_ALLOWED"


def test_resolve_rejects_url_credentials() -> None:
    try:
        resolve_public_target("https://user:password@example.com/jobs")
    except PostingFetchError as exc:
        assert exc.code == "INVALID_URL"
    else:
        raise AssertionError("URL credentials must be rejected")


def test_analyze_streams_result(monkeypatch) -> None:
    async def fake_analysis(url, emit):
        emit("status", {"stage": "verifying", "message": "근거 확인 중"})
        return {
            "company": {"value": "예시 회사", "confidence": 1, "evidence": "회사명"},
            "title": {"value": "개발자", "confidence": 1, "evidence": "공고명"},
            "deadline": {"value": None, "confidence": 0, "evidence": None},
            "source_url": url,
            "ai_generated": True,
            "needs_review": ["deadline"],
        }

    monkeypatch.setattr(app_module, "analyze_posting", fake_analysis)
    monkeypatch.setattr(
        app_module,
        "resolve_public_target",
        lambda url: object(),
    )
    monkeypatch.setattr(app_module, "_rate_limited", lambda _ip: False)

    response = app.test_client().post(
        "/api/v1/postings/analyze",
        json={"url": "https://example.com/jobs/1"},
    )

    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert response.mimetype == "text/event-stream"
    assert "event: status" in body
    assert '"stage":"verifying"' in body
    assert "event: result" in body
    assert '"ai_generated":true' in body
