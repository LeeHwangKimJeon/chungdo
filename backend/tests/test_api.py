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


def test_recommendations_returns_empty_without_curated_data(tmp_path, monkeypatch) -> None:
    curated_file = tmp_path / "curated.json"
    curated_file.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(app_module, "_CURATED_POSTINGS_PATH", curated_file)

    response = app.test_client().get("/api/v1/postings/recommendations")

    assert response.status_code == 200
    assert response.get_json() == {"items": []}


def test_recommendations_filters_verified_list(tmp_path, monkeypatch) -> None:
    curated_file = tmp_path / "curated.json"
    curated_file.write_text(
        """[{
          "id":"curated-1",
          "company":"청도테크",
          "title":"주니어 개발자",
          "location":"경북 청도",
          "deadline":null,
          "url":"https://example.com/jobs/1",
          "source":"운영자 확인 원문",
          "keywords":["python"]
        }]""",
        encoding="utf-8",
    )
    monkeypatch.setattr(app_module, "_CURATED_POSTINGS_PATH", curated_file)

    response = app.test_client().get(
        "/api/v1/postings/recommendations?q=python&location=청도"
    )

    assert response.status_code == 200
    item = response.get_json()["items"][0]
    assert item["id"] == "curated-1"
    assert item["reason"]
    assert item["source"] == "운영자 확인 원문"


def test_daily_plan_streams_result(monkeypatch) -> None:
    async def fake_plan(payload, emit):
        emit("status", {"stage": "plan_reviewing", "message": "검토"})
        return {
            "ai_generated": True,
            "days": [
                {
                    "date": "2026-11-06",
                    "tasks": [
                        {
                            "title": "공고 확인",
                            "reason": "마감 준비",
                            "related_application_id": "job-1",
                            "estimated_minutes": 20,
                        }
                    ],
                }
            ],
            "needs_review": [],
        }

    monkeypatch.setattr(app_module, "generate_daily_plan", fake_plan)
    monkeypatch.setattr(app_module, "_rate_limited", lambda _ip: False)

    response = app.test_client().post(
        "/api/v1/plans/daily",
        json={
            "base_date": "2026-11-06",
            "days": 1,
            "applications": [
                {
                    "id": "job-1",
                    "company": "예시 회사",
                    "title": "개발자",
                    "stage": "preparing",
                }
            ],
        },
    )

    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert response.mimetype == "text/event-stream"
    assert "event: result" in body
    assert '"ai_generated":true' in body


def test_interview_requires_explicit_consent(monkeypatch) -> None:
    monkeypatch.setattr(app_module, "_rate_limited", lambda _ip: False)

    response = app.test_client().post(
        "/api/v1/interviews/turns",
        json={
            "consent": False,
            "company": "예시 회사",
            "title": "개발자",
            "answer": "문제를 해결한 경험을 설명했습니다.",
        },
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "CONSENT_REQUIRED"


def test_interview_streams_question_and_feedback(monkeypatch) -> None:
    async def fake_interview(payload, emit):
        return {
            "ai_generated": True,
            "question": "프로젝트에서 맡은 역할은 무엇이었나요?",
            "feedback": "구체적인 결과를 덧붙이면 더 명확합니다.",
            "strengths": ["역할을 설명함"],
            "improvements": ["결과를 구체화"],
            "evidence": ["답변에서 프로젝트 경험을 언급함"],
            "needs_review": [],
        }

    monkeypatch.setattr(app_module, "generate_interview_turn", fake_interview)
    monkeypatch.setattr(app_module, "_rate_limited", lambda _ip: False)

    response = app.test_client().post(
        "/api/v1/interviews/turns",
        json={
            "consent": True,
            "company": "예시 회사",
            "title": "개발자",
            "posting_summary": "Python API를 개발하는 직무",
            "turns": [],
            "answer": "학교 프로젝트에서 API를 구현했습니다.",
        },
    )

    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert response.mimetype == "text/event-stream"
    assert "event: result" in body
    assert "프로젝트에서 맡은 역할" in body


def test_draft_requires_explicit_consent(monkeypatch) -> None:
    monkeypatch.setattr(app_module, "_rate_limited", lambda _ip: False)

    response = app.test_client().post(
        "/api/v1/drafts/generate",
        json={
            "consent": False,
            "draft_type": "cover_letter",
            "company": "예시 회사",
            "title": "개발자",
            "experiences": [{"experience": "학교 프로젝트에서 API를 구현했습니다."}],
        },
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "CONSENT_REQUIRED"


def test_draft_streams_user_reviewable_result(monkeypatch) -> None:
    async def fake_draft(payload, emit):
        return {
            "ai_generated": True,
            "draft": "프로젝트에서 API를 구현했습니다.",
            "evidence": [
                {
                    "claim": "API 구현",
                    "source": "학교 프로젝트에서 API를 구현했습니다.",
                }
            ],
            "missing_information": [],
            "needs_review": [],
        }

    monkeypatch.setattr(app_module, "generate_draft", fake_draft)
    monkeypatch.setattr(app_module, "_rate_limited", lambda _ip: False)

    response = app.test_client().post(
        "/api/v1/drafts/generate",
        json={
            "consent": True,
            "draft_type": "cover_letter",
            "company": "예시 회사",
            "title": "개발자",
            "experiences": [{"experience": "학교 프로젝트에서 API를 구현했습니다."}],
        },
    )

    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert "event: result" in body
    assert "프로젝트에서 API를 구현했습니다." in body
