from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    StringConstraints,
    field_validator,
)


ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8_000)]


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ApplicationContext(RequestModel):
    id: ShortText
    company: ShortText
    title: ShortText
    stage: ShortText
    deadline: date | None = None
    interview_at: datetime | None = None
    estimated_minutes: int | None = Field(default=None, ge=5, le=480)


class DailyPlanRequest(RequestModel):
    base_date: date
    days: int = Field(ge=1, le=14)
    applications: list[ApplicationContext] = Field(min_length=1, max_length=20)


class PlannedTask(BaseModel):
    title: ShortText
    reason: ShortText
    related_application_id: str | None = None
    estimated_minutes: int = Field(ge=5, le=480)


class PlannedDay(BaseModel):
    date: date
    tasks: list[PlannedTask] = Field(max_length=8)


class DailyPlanResult(BaseModel):
    ai_generated: bool
    days: list[PlannedDay] = Field(max_length=14)
    needs_review: list[str] = Field(max_length=20)


class InterviewTurn(RequestModel):
    role: str = Field(pattern="^(assistant|user)$")
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4_000)]


class InterviewRequest(RequestModel):
    consent: bool
    company: ShortText
    title: ShortText
    posting_summary: Annotated[str, StringConstraints(max_length=6_000)] = ""
    company_info: Annotated[str, StringConstraints(max_length=3_000)] = ""
    turns: list[InterviewTurn] = Field(default_factory=list, max_length=8)
    answer: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5_000)]


class InterviewResult(BaseModel):
    ai_generated: bool
    question: ShortText
    feedback: ShortText
    strengths: list[str] = Field(max_length=5)
    improvements: list[str] = Field(max_length=5)
    evidence: list[str] = Field(max_length=5)
    needs_review: list[str] = Field(max_length=10)


class DraftType(StrEnum):
    COVER_LETTER = "cover_letter"
    PORTFOLIO = "portfolio"


class ExperienceFact(RequestModel):
    experience: LongText


class DraftRequest(RequestModel):
    consent: bool
    draft_type: DraftType
    company: ShortText
    title: ShortText
    posting_summary: Annotated[str, StringConstraints(max_length=6_000)] = ""
    experiences: list[ExperienceFact] = Field(min_length=1, max_length=12)
    instructions: Annotated[str, StringConstraints(max_length=2_000)] = ""


class EvidenceItem(BaseModel):
    claim: ShortText
    source: ShortText


class DraftResult(BaseModel):
    ai_generated: bool
    draft: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=12_000)]
    evidence: list[EvidenceItem] = Field(max_length=20)
    missing_information: list[str] = Field(max_length=20)
    needs_review: list[str] = Field(max_length=20)


class CuratedPosting(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: ShortText
    company: ShortText
    title: ShortText
    location: str | None = Field(default=None, max_length=200)
    deadline: date | None = None
    url: HttpUrl
    source: ShortText
    keywords: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("url")
    @classmethod
    def require_https(cls, value: HttpUrl) -> HttpUrl:
        if value.scheme != "https":
            raise ValueError("Curated posting URLs must use HTTPS.")
        return value
