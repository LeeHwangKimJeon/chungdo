# API 명세 — 취준·이직 파이프라인 보드

## 개요

- **API 기본 경로:** `/api/v1`
- **서버:** Flask
- **에이전트:** Microsoft Agent Framework Python workflow가 공고 추출과 근거 검증을 순차 실행하고, 각 에이전트의 모델 호출·도구 호출·토큰 스트리밍은 GitHub Copilot SDK가 수행한다.
- **저장:** 서버는 사용자별 보드 정보를 저장하지 않는다. 지원 카드, 상태, 일정, 자소서 버전 메모는 프런트의 `localStorage`에 남는다.
- **인증:** 공개 데모는 로그인 없이 사용한다. 분석 엔드포인트는 IP당 분당 10회로 제한한다.
- **콘텐츠 유형:** JSON 요청·응답은 `application/json`, 분석 응답은 `text/event-stream`

추출 결과는 AI 제안이다. `result`를 받은 뒤 사용자가 확인·수정해 저장하기 전에는 보드에 반영하지 않는다. 서버에는 보드 저장 엔드포인트가 없다.

## 공통 오류 형식

```json
{
  "error": {
    "code": "INVALID_URL",
    "message": "HTTPS 공고 URL을 입력해 주세요.",
    "retryable": false
  }
}
```

오류 메시지는 사용자에게 표시할 수 있다. URL, 페이지 본문, API 키, 프롬프트 전문은 로그에 기록하지 않는다.

## `GET /api/v1/health`

애플리케이션의 기본 생존 여부를 반환한다. Copilot 인증 정보를 포함한 내부 상태는 노출하지 않는다.

**응답 `200 OK`:**

```json
{
  "status": "ok"
}
```

## `POST /api/v1/postings/analyze`

사용자가 제공한 공고 URL을 안전하게 가져온 다음 Copilot SDK 기반 추출 에이전트와 근거 검증 에이전트를 Agent Framework workflow에서 순차 실행한다. 서버에 공고나 결과를 저장하지 않는다.

**요청 헤더:**

```http
Content-Type: application/json
Accept: text/event-stream
```

**요청 본문:**

```json
{
  "url": "https://jobs.example.com/postings/123"
}
```

URL은 HTTPS 및 기본 포트 443을 사용해야 하며, 요청 본문은 4KB 이하이어야 한다.

### 응답 스트림

요청 검증 후 `200 OK`와 `Content-Type: text/event-stream`을 반환한다. 이벤트 본문은 UTF-8 SSE이며 각 이벤트의 `data`는 JSON 객체다. 프런트는 `fetch`의 `ReadableStream`으로 POST 스트림을 읽는다.

일반적인 순서:

1. `status` — 에이전트 시작
2. `status` — 공고 가져오기
3. `delta` — Copilot SDK가 전달하는 응답 조각(있을 때)
4. `status` — 근거 검증
5. `delta` — 검증 응답 조각(있을 때)
6. `result` — 최종 결과 한 번 전송

**예시:**

```text
event: status
data: {"stage":"starting","message":"에이전트를 준비하고 있습니다."}

event: status
data: {"stage":"fetching","message":"공고 페이지를 가져오는 중입니다."}

event: status
data: {"stage":"verifying","message":"공고 정보와 근거를 확인하고 있습니다."}

event: result
data: {"company":{"value":"예시 회사","confidence":0.97,"evidence":"회사 소개 영역"},"title":{"value":"주니어 백엔드 개발자","confidence":0.91,"evidence":"공고 제목"},"deadline":{"value":null,"confidence":0.0,"evidence":null},"source_url":"https://jobs.example.com/postings/123","ai_generated":true,"needs_review":["deadline"]}
```

### 결과 필드

| 필드 | 형식 | 설명 |
|---|---|---|
| `company` | `ExtractedField` | 회사명 후보 |
| `title` | `ExtractedField` | 공고명 후보 |
| `deadline` | `ExtractedField` | 마감일 후보 |
| `source_url` | string | 가져오기가 완료된 공고 URL |
| `ai_generated` | boolean | 항상 `true`; AI 결과로 표시 |
| `needs_review` | string[] | 값·근거가 없거나 확신도가 0.75 미만인 필드 |

`ExtractedField`:

```json
{
  "value": "예시 값 또는 null",
  "confidence": 0.0,
  "evidence": "페이지에서 확인한 근거 또는 null"
}
```

- `confidence`는 0.0부터 1.0까지다.
- `deadline.value`는 `YYYY-MM-DD` 또는 `null`이다. 페이지에 연도가 없으면 임의로 보충하지 않는다.
- 근거가 없는 값은 `null`로 두며, 클라이언트가 사용자에게 직접 수정할 수 있게 한다.
- 페이지 본문은 분석 과정에서만 사용하며 응답에 전체 내용을 포함하지 않는다.

### 오류와 재시도

SSE 시작 전 오류는 아래 JSON 오류 형식과 HTTP 상태 코드로 반환한다. 스트림 시작 후 오류는 `error` 이벤트 하나를 전송한 뒤 연결을 닫으며, 이 경우 `result` 이벤트는 오지 않는다.

```text
event: error
data: {"code":"FETCH_TIMEOUT","message":"공고 페이지 응답 시간이 초과되었습니다.","retryable":true}
```

| HTTP / 전송 | 코드 | 의미 | 재시도 |
|---|---|---|---:|
| `400` | `INVALID_REQUEST` | JSON 또는 필수 `url` 필드가 잘못됨 | 아니요 |
| `400` | `INVALID_URL` | HTTPS 기본 포트 443 URL이 아님 | 아니요 |
| `403` | `URL_NOT_ALLOWED` | 로컬·사설·공개 라우팅이 아닌 대상 | 아니요 |
| `413` | `REQUEST_TOO_LARGE` | 요청 본문이 4KB 초과 | 아니요 |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | JSON이 아닌 요청 | 아니요 |
| `429` | `RATE_LIMITED` | 분당 요청 한도 초과 (`Retry-After` 제공) | 나중에 |
| 스트림 `error` | `FETCH_TIMEOUT` | 페이지 응답 시간 초과 | 예 |
| 스트림 `error` | `FETCH_FAILED` | DNS 또는 네트워크 연결 실패 | 상황에 따라 |
| 스트림 `error` | `REDIRECT_NOT_ALLOWED` | 목적지 검증 실패 또는 리디렉션 과다 | 아니요 |
| 스트림 `error` | `UNSUPPORTED_PAGE` | 로그인·차단·비 HTML·본문 없음 | 아니요 |
| 스트림 `error` | `PAGE_TOO_LARGE` | 페이지 본문 크기 초과 | 아니요 |
| 스트림 `error` | `AGENT_UNAVAILABLE` | Copilot CLI·모델 연결 또는 인증 실패 | 예 |
| 스트림 `error` | `AGENT_FAILED` | 에이전트 결과 검증 실패 | 예 |

클라이언트는 `result`를 받기 전에 연결이 끊기면 성공으로 처리하지 않는다. 오류 후에는 같은 URL 재시도 또는 직접 입력 경로를 제공한다.

## URL 가져오기 및 비밀값 보호

- 서버에서만 URL을 가져오며, HTTPS 기본 포트 외에는 허용하지 않는다.
- 사용자 정보가 포함된 URL, 사설·루프백·링크 로컬·비공개 IP로 해석되는 도메인을 거부한다. DNS 결과에서 선택된 공인 IP에 직접 연결하고, 리디렉션마다 URL과 DNS를 다시 검증한다.
- 최대 리디렉션 4회, 페이지 크기 1.5MB, 가져온 텍스트 24,000자, 네트워크 타임아웃 8초 제한을 둔다. HTML 콘텐츠만 처리한다.
- Copilot SDK에는 내장 도구를 비활성화하고, 사용자가 입력한 URL만 가져오는 `fetch_posting` 사용자 도구를 제공한다. 에이전트는 저장·지원 제출·외부 연락 도구를 갖지 않는다.
- 공고 페이지 텍스트는 신뢰할 수 없는 입력으로 취급한다. 페이지 속 지시문이 에이전트 지침을 바꾸지 않도록 한다.
- Copilot 인증은 배포 환경의 Copilot CLI 인증으로 제공하며 소스 코드나 로그에 비밀값을 넣지 않는다. 모델을 지정할 경우 `COPILOT_MODEL` 환경변수를 사용한다.

## 개발 실행

Python 3.11 이상과 인증된 GitHub Copilot CLI 실행 환경이 필요하다.

```bash
python -m pip install -r requirements.txt
python -m backend.app
```

프런트엔드 개발 서버(`npm run dev`)의 `/api` 요청은 기본적으로 `http://127.0.0.1:5000`으로 프록시된다. 다른 주소가 필요하면 `API_PROXY_TARGET`을 설정한다. 프런트 정적 빌드를 포함해 실행할 때는 `npm run build` 후 Flask 서버를 시작한다.

## 범위 밖

지원 항목 CRUD, 칸반 이동, 면접 일정, 자기소개서 버전 메모의 서버 API는 제공하지 않는다. 해당 데이터는 브라우저 `localStorage`에 저장한다. 로그인, 다중 사용자, 자동 지원, 파일 업로드, 캘린더 연동도 제공하지 않는다.
