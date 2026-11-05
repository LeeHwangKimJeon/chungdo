# TRD — 취준·이직 파이프라인 보드

## 저장소·환경 확인 (2026-11-05)
- 앱에는 React + TypeScript 프런트와 Flask API, Copilot SDK/Agent Framework 기반 공고 분석 workflow가 있다. Aspire AppHost 및 Azure 배포 구성이 아직 없다.
- 검증 시 사용한 Python 3.14.6, Node.js 24.19.0, npm 11.17.0. Python 3.11 이상이 필요하다. Azure 배포 도구와 배포 환경은 별도로 준비·검증해야 한다.
- [해커톤 참가 안내](https://github.com/hackersground-kr/hackathon-cheongdo/blob/main/README.md), [평가 기준](https://github.com/hackersground-kr/hackathon-cheongdo/blob/main/judgement/judgement-criteria.md), [청도 사회문제 브리핑](https://github.com/hackersground-kr/hackathon-cheongdo/blob/main/references/cheongdo-social-issues.md)을 확인했다. 안내는 청년 취업·창업 지원을 참고 주제로 제시하고, 로그인 없는 심사 가능성과 Azure 기본 도메인 배포를 요구한다. 평가 가중치는 SDK+Agent Framework 25%, 생산성·문제 적합성 18%, Azure 18%, 완성도 16%, UX 12%, 책임 있는 AI·보안 6%, 혁신성 5%다.

## 기술 근거와 선행 검증
- Copilot SDK 공식 문서는 Python SDK `github-copilot-sdk`가 Python 3.11 이상, 비동기 세션 이벤트와 실시간 스트리밍을 지원한다고 명시한다. SDK 런타임은 패키지 설치 후 내려받거나 처음 실행할 때 준비된다. 모델 호출에는 Copilot 인증 또는 BYOK가 필요하다. 배포 이미지에서 런타임 준비와 인증을 검증한다.
- Microsoft Agent Framework 공식 문서는 Python 에이전트와 workflow를 지원하며 Python 패키지는 `agent-framework`다. 이번 조사에서 Copilot SDK를 Agent Framework에 연결하는 공식 어댑터/통합은 확인되지 않았다. 따라서 구현 전 기술 검증(P0)에서 Python 사용자 정의 연결의 실제 도구 호출·스트리밍·다중 에이전트 협업을 증명한다. 호환되지 않으면 대체 아키텍처를 임의 적용하지 않는다.
- Aspire 공식 배포 문서는 `aspire deploy`가 AppHost에 배포 target 리소스가 있을 때만 실제 배포 단계를 실행한다고 명시하고, Azure App Service 및 Azure Container Apps target을 지원한다. 단순히 CLI 명령만 두는 것으로는 배포가 되지 않는다.
- 해커톤 평가 기준은 두 필수 기술의 실질적 활용을 요구한다. Azure AI/모델 서비스 사용은 필수로 요구하지 않으며, 불필요한 Azure 서비스를 추가하면 감점될 수 있다.
- 참고: [Copilot SDK](https://github.com/github/copilot-sdk), [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/), [Aspire 배포 모델](https://aspire.dev/deployment/deploy-with-aspire/).

## 제안 아키텍처
- **웹:** React + TypeScript. 반응형 보드, 공고 추천/검토, 날짜별 계획, 대화형 면접 연습, 문서 초안 검토 화면.
- **API/에이전트:** Python 3.11 이상, Flask, Microsoft Agent Framework Python, GitHub Copilot SDK Python. Flask는 React 빌드 정적 파일을 제공하고 AI 작업은 SSE로 진행·텍스트·완료·오류를 전달한다.
- **오케스트레이션:** MAF workflow가 공고 분석 → 근거 검증, 계획 생성 → 일정 타당성 검토, 면접 코치, 문서 초안 → 사실 근거 검토를 조정한다. 각 모델 세션은 실제 Copilot SDK를 사용한다. SDK/MAF 연동을 검증하지 못한 workflow는 출시하지 않는다.
- **도구 최소 권한:** 분석 에이전트는 요청 URL만 가져오는 `fetch_posting` 도구를 사용할 수 있다. 추천 에이전트는 검증된 정적 공고 목록만 조회한다. 계획·면접·문서 에이전트는 외부 쓰기·지원·연락 도구를 갖지 않는다.
- **데이터:** 지원 보드·일정·사용자가 확인한 할 일·문서 초안 및 버전 메모는 브라우저 `localStorage`에 저장한다. 검증 공고 목록은 저장소에서 검토·관리하는 정적 데이터다. 에이전트 요청/대화와 개인 자료는 요청 처리 메모리에서만 사용하고 서버에 영구 저장하지 않는다.
- **Azure 최소 구성:** React 정적 빌드와 Flask API를 단일 컨테이너 이미지로 구성하고 Aspire AppHost에서 Azure Container Apps로 배포하는 안을 우선한다. 개인 데이터를 서버 DB에 보관하지 않는다. Application Insights에는 요청 ID·기능명·지연·비민감 오류 코드만 기록하고, 사용자 입력/생성 콘텐츠를 수집하지 않는다. AppHost target, 반복 배포, 기본 도메인과 관찰성은 실제로 검증한다.
- **비밀·인증:** 개발은 로컬 환경변수와 Copilot CLI 인증, 배포는 검증된 Azure 리소스 설정/Key Vault 참조를 사용한다. API 키 및 개인 자료를 소스나 로그에 남기지 않는다.
- **공개 API 보호:** 로그인을 요구하지 않되 IP/요청 단위 rate limit, 요청 본문 크기 제한, 작업 시간 제한을 적용한다. 민감 문서 전송 전에 프런트가 대상과 내용을 안내하고 명시적 동의를 받는다.
- **제출 공개성:** 배포는 Azure 기본 도메인을 사용하고 커스텀 도메인을 요구하지 않는다. 심사자가 로그인 없이 핵심 흐름을 실행할 수 있게 한다.

## URL 가져오기 안전성 및 오류
백엔드 도구에서만 페이지를 가져온다. HTTPS만 허용하고 URL 사용자정보·사설/루프백/링크 로컬 IP를 거부하며, DNS 결과와 각 리디렉션 목적지를 다시 검증한다. 리디렉션 수·응답 크기·시간을 제한하고 HTML만 처리한다. 로그인·차단·동적 페이지·파싱 실패는 구분해 알리고, 수동 편집/입력으로 흐름을 이어 간다. URL 입력은 외부 프롬프트 인젝션으로 취급하고 페이지 지시문을 에이전트 명령으로 따르지 않는다.

## API 계약

API 구현은 Flask, 기본 경로 `/api/v1`이다. `구현 상태`는 현재 서버 동작, `계약(미구현)`은 다음 기능 구현 시 지켜야 할 인터페이스다. AI 응답은 모두 생성 제안이며, API는 보드·일정·문서 저장 API를 제공하지 않는다.

### 공통 형식

- 요청 본문은 UTF-8 JSON, 응답은 JSON 또는 Server-Sent Events(SSE)다.
- SSE 호출은 `POST` + `fetch` stream으로 읽는다. `Content-Type: text/event-stream`, `Cache-Control: no-cache`를 반환한다.
- 이벤트는 `status`, 선택적 `delta`, 종료 이벤트 `result` 또는 `error` 순이다. 스트림 종료 전에 `result`가 없으면 실패로 처리한다.
- 오류 JSON 및 SSE `error` 데이터는 `{"code":"...","message":"...","retryable":false}` 형태다. 오류 응답에 프롬프트, URL 비밀값 또는 개인 자료를 포함하지 않는다.
- AI 결과는 `ai_generated: true`, 출처/근거, 확인이 필요한 항목을 포함한다. 사용자가 검토·수정·명시적 확인하기 전에는 클라이언트가 보드에 저장하지 않는다.
- 지원 항목, 사용자 프로필, 작업 계획, 면접 대화, 생성 문서는 서버에 영구 저장하지 않는다. 클라이언트가 요청에 포함한 자료는 처리 후 폐기하고 로그·텔레메트리에 기록하지 않는다.
- 로그인 없이 접근 가능한 공개 API이므로 기능별 요청 제한·본문 크기 제한·작업 시간 제한을 적용한다. 현재 분석 API의 요청 본문 제한은 4KB, 제한은 IP당 분당 10회다. 추가 생성 API의 크기/요청 제한은 구현 전 부하·비용 시험으로 정하고 이 문서를 갱신한다.

### `GET /api/v1/health` — 구현됨

응답 `200`: `{"status":"ok"}`. 내부 인증·비밀값은 반환하지 않는다.

### `POST /api/v1/postings/analyze` — 구현됨

요청: `{"url":"https://jobs.example.com/postings/123"}`. HTTPS 기본 포트만 허용한다. 안전한 가져오기 도구가 해당 사용자 URL만 읽고, 추출 에이전트 뒤에 근거 검증 에이전트가 실행된다.

정상 종료 시 `result`는 아래 형식이다.

```json
{
  "company": {"value": "예시 회사", "confidence": 0.97, "evidence": "공고 본문"},
  "title": {"value": "주니어 개발자", "confidence": 0.91, "evidence": "공고 제목"},
  "deadline": {"value": null, "confidence": 0, "evidence": null},
  "source_url": "https://jobs.example.com/postings/123",
  "ai_generated": true,
  "needs_review": ["deadline"]
}
```

`deadline.value`는 `YYYY-MM-DD` 또는 `null`이다. 모르는 마감일을 추정하지 않는다. 스트림 시작 전 오류는 `400 INVALID_URL`, `403 URL_NOT_ALLOWED`, `413 REQUEST_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `429 RATE_LIMITED` 등 JSON으로 반환한다. 스트림 시작 뒤 `FETCH_TIMEOUT`, `FETCH_FAILED`, `REDIRECT_NOT_ALLOWED`, `UNSUPPORTED_PAGE`, `AGENT_UNAVAILABLE`, `AGENT_FAILED`는 `error` 이벤트로 보낸다. 실패 시 `result`를 보내지 않는다.

### `GET /api/v1/postings/recommendations` — 계약(미구현)

`q` 및 `location`은 선택 문자열 필터다. 검색 대상은 관리자가 확인·갱신한 공고 목록뿐이다. 지역 필드는 데이터 출처에서 실제 확인될 때만 노출한다. 준비된 공고가 없으면 빈 배열을 반환한다. 크롤링·자동 수집으로 목록을 채우지 않는다.

응답:

```json
{
  "items": [
    {
      "id": "curated-001",
      "company": "예시 회사",
      "title": "주니어 개발자",
      "location": null,
      "deadline": null,
      "url": "https://jobs.example.com/postings/123",
      "source": "운영자가 검토한 원문",
      "reason": "검색한 직무 키워드와 일치"
    }
  ]
}
```

`reason`은 공고의 실제 필드에 기반해 설명하며 추천을 취업 가능성 보장처럼 표현하지 않는다.

### `POST /api/v1/plans/daily` — 계약(미구현, SSE)

요청에는 기준 날짜, 계획 기간, 사용자가 제공한 지원 항목의 단계·마감일·면접일·예상 소요시간을 포함한다. 개인정보나 보드 전체를 자동 전송하지 않고 필요한 필드만 사용자 선택을 통해 보낸다.

`status`/`delta` 뒤 `result`는 `{ "ai_generated": true, "days": [{ "date":"YYYY-MM-DD", "tasks":[{"title":"공고 요구사항 확인","reason":"마감일이 가까움","related_application_id":"local-id","estimated_minutes":20}]}], "needs_review":[] }`를 반환한다. 사실로 입력되지 않은 날짜를 만들지 않으며 날짜 충돌·정보 부족을 표시한다. 생성된 할 일은 사용자 수정·선택 후에만 브라우저에 저장한다.

### `POST /api/v1/interviews/turns` — 계약(미구현, SSE)

한 번의 사용자 답변에 대해 면접관 에이전트가 다음 질문과 코치 에이전트의 답변 피드백을 생성한다. 요청은 대상 회사/직무, 공고 원문 또는 확인된 요약, 사용자가 직접 제공한 회사 정보, 최근 대화 턴 및 새 답변만 포함한다. 개인 자료의 전송 내용과 AI 사용을 먼저 고지하고 동의를 받아야 한다. 대화는 브라우저가 유지하며 API 세션에 영구 저장하지 않는다.

`result`는 `{ "ai_generated": true, "question": "...", "feedback": "...", "strengths": [], "improvements": [], "evidence": [], "needs_review": [] }` 형태다. 실제 회사 내부 정보나 실제 면접 질문인 것처럼 가장하지 않는다. 정보가 없으면 일반 직무 질문임을 표시한다.

### `POST /api/v1/drafts/generate` — 계약(미구현, SSE)

자소서 또는 포트폴리오 초안을 생성한다. 요청에는 `draft_type` (`cover_letter` 또는 `portfolio`), 대상 공고의 확인된 정보, 사용자가 직접 제공한 경험/프로젝트/성과, 초안 지시를 포함한다. 프런트는 전송할 자료를 미리 보여 주고 명시적 동의를 받아야 한다.

`result`는 `{ "ai_generated": true, "draft": "...", "evidence": [{"claim":"...","source":"사용자 경험 입력"}], "missing_information": [], "needs_review": [] }` 형태다. 원문에 없는 이력·자격·성과·수치를 만들어내지 않고 빈 부분은 `[추가 정보 필요: ...]`처럼 표시한다. 생성 문서는 응답 뒤 서버에서 버리고, 클라이언트는 편집 및 사용자의 저장 확인 후에만 브라우저에 보관한다.

### 오류 코드

요청 검증은 `INVALID_REQUEST`, `INVALID_URL`, `URL_NOT_ALLOWED`, `REQUEST_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `RATE_LIMITED`를 사용한다. 실행 중 오류는 `FETCH_TIMEOUT`, `FETCH_FAILED`, `REDIRECT_NOT_ALLOWED`, `UNSUPPORTED_PAGE`, `AGENT_UNAVAILABLE`, `AGENT_FAILED`로 구분한다. 모든 사용자 오류에는 재시도 가능 여부와 직접 입력 또는 수정 경로를 제공한다.

## 구현 단계
1. **P0 연동·보안 검증:** Copilot SDK 실제 도구 호출/스트리밍과 MAF 순차 workflow, 각 기능의 데이터 비저장, 개인정보 동의, URL SSRF 방어를 검증한다.
2. **P1 공고·보드:** 관리 검증 공고 목록, URL 분석/근거, 사용자 확인, 칸반·일정 저장.
3. **P2 코치:** 실제 보드 기반 날짜별 할 일 제안, 회사·공고 근거형 면접 턴 및 답변 피드백, 사실에 근거한 문서 초안과 누락 정보 표시.
4. **P3 품질·배포:** 기능별 테스트·반응형/접근성 확인, Aspire Azure 배포 구성·실행 및 기본 도메인·관찰성 검증.

## 운영상 제약
`localStorage`는 브라우저·기기 간 동기화·복구를 제공하지 않으며 브라우저 데이터를 지우면 저장 항목이 사라진다. 개인 자료를 전송하기 전에 명시적 동의를 받아야 하며, 심사 환경에서는 민감한 실제 정보를 입력하지 않도록 안내한다. Azure/AppHost 배포는 실행으로 검증하기 전까지 배포 완료라고 주장하지 않는다. 모델 공급자 인증·요청 제한·운영 관찰성은 배포 환경에서 검증한다.
