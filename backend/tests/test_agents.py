from __future__ import annotations

import asyncio
import json

import pytest

from backend import agents


def test_two_agent_workflow_passes_generator_output_to_reviewer(monkeypatch) -> None:
    prompts: list[str] = []

    async def fake_completion(prompt, *, tools, available_tools, emit):
        prompts.append(prompt)
        return "초안" if len(prompts) == 1 else "검토 완료"

    monkeypatch.setattr(agents, "_copilot_completion", fake_completion)

    result = asyncio.run(
        agents._run_two_agent_workflow(
            initial_prompt="초기 작업",
            review_prompt=lambda draft: f"이 초안을 검토: {draft}",
            feature="test",
            emit=lambda _event, _data: None,
        )
    )

    assert result == "검토 완료"
    assert prompts == ["초기 작업", "이 초안을 검토: 초안"]


def test_daily_plan_rejects_dates_outside_requested_range(monkeypatch) -> None:
    async def fake_workflow(**kwargs):
        return json.dumps(
            {
                "ai_generated": True,
                "days": [{"date": "2026-11-08", "tasks": []}],
                "needs_review": [],
            }
        )

    monkeypatch.setattr(agents, "_run_two_agent_workflow", fake_workflow)
    request = agents.DailyPlanRequest.model_validate(
        {
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
        }
    )

    with pytest.raises(agents.AnalysisError, match="요청 기간 밖"):
        asyncio.run(
            agents.generate_daily_plan(request, lambda _event, _data: None)
        )
