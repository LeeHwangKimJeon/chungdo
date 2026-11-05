# TRD — 취준·이직 파이프라인 보드

## 저장소·환경 확인 (2026-11-05)
- 저장소에는 현재 `AGENTS.md`, `PRD.md`, `TRD.md`, `TDD.md` 기획 문서가 있으며 앱 구현과 Aspire AppHost는 아직 없다.
- 확인된 도구: Node.js 24.18.0, npm 11.16.0, Python 3.9.6, Docker. 확인되지 않은 도구: .NET SDK, Azure CLI(`az`), Aspire CLI. Copilot Python SDK는 Python 3.11 이상을 요구하므로 Python도 업그레이드해야 한다. 이 환경에서 Azure 배포를 실행할 수 없다.
- 사용 가능한 skills 목록에 Azure 전용 skill이 없어 적용하지 않았다.
- [해커톤 참가 안내](https://github.com/hackersground-kr/hackathon-cheongdo/blob/main/README.md), [평가 기준](https://github.com/hackersground-kr/hackathon-cheongdo/blob/main/judgement/judgement-criteria.md), [청도 사회문제 브리핑](https://github.com/hackersground-kr/hackathon-cheongdo/blob/main/references/cheongdo-social-issues.md)을 확인했다. 안내는 청년 취업·창업 지원을 참고 주제로 제시하고, 로그인 없는 심사 가능성과 Azure 기본 도메인 배포를 요구한다. 평가 가중치는 SDK+Agent Framework 25%, 생산성·문제 적합성 18%, Azure 18%, 완성도 16%, UX 12%, 책임 있는 AI·보안 6%, 혁신성 5%다.

## 기술 근거와 선행 검증
- Copilot SDK 공식 문서는 Python SDK `github-copilot-sdk`가 Python 3.11 이상, 비동기 세션 이벤트와 실시간 스트리밍을 지원한다고 명시한다. SDK 런타임은 패키지 설치 후 내려받거나 처음 실행할 때 준비된다. 모델 호출에는 Copilot 인증 또는 BYOK가 필요하다. 배포 이미지에서 런타임 준비와 인증을 검증한다.
- Microsoft Agent Framework 공식 문서는 Python 에이전트와 workflow를 지원하며 Python 패키지는 `agent-framework`다. 이번 조사에서 Copilot SDK를 Agent Framework에 연결하는 공식 어댑터/통합은 확인되지 않았다. 따라서 구현 전 기술 검증(P0)에서 Python 사용자 정의 연결의 실제 도구 호출·스트리밍·다중 에이전트 협업을 증명한다. 호환되지 않으면 대체 아키텍처를 임의 적용하지 않는다.
- Aspire 공식 배포 문서는 `aspire deploy`가 AppHost에 배포 target 리소스가 있을 때만 실제 배포 단계를 실행한다고 명시하고, Azure App Service 및 Azure Container Apps target을 지원한다. 단순히 CLI 명령만 두는 것으로는 배포가 되지 않는다.
- 해커톤 평가 기준은 두 필수 기술의 실질적 활용을 요구한다. Azure AI/모델 서비스 사용은 필수로 요구하지 않으며, 불필요한 Azure 서비스를 추가하면 감점될 수 있다.
- 참고: [Copilot SDK](https://github.com/github/copilot-sdk), [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/), [Aspire 배포 모델](https://aspire.dev/deployment/deploy-with-aspire/).

## 제안 아키텍처
- **웹:** React + TypeScript. 보드, URL 검토/수정 화면, 반응형 상태 표현.
- **API/에이전트:** Python 3.11 이상, Flask, Microsoft Agent Framework Python package, Copilot SDK Python package. Flask는 API와 React 빌드 정적 파일을 한 서비스로 제공한다. 비동기 에이전트 실행·Copilot SDK 이벤트 전달을 서버 스트리밍(SSE)으로 연결한다. Flask의 WSGI 요청 수명과 SDK의 asyncio 이벤트 스트림을 안전하게 연결하는 방식은 P0에서 검증한다.
- **에이전트·도구:** 공고 분석과 근거 검증 역할을 별도 agent로 구성한다. `fetchPosting`만 등록하고 사용자 확인 전에는 저장 도구를 노출하지 않는다.
- **데이터:** 계정 없이 공개 심사가 가능하도록 사용자별 지원 보드와 자소서 버전 메모는 브라우저 `localStorage`에 저장한다. 공고 URL과 추출 결과는 서버에 영구 저장하지 않는다. 기기 간 동기화·복구는 MVP에서 지원하지 않는다.
- **Azure 최소 구성:** React 정적 빌드와 Flask API를 단일 컨테이너 이미지로 구성하고 Aspire AppHost에서 Azure Container Apps에 배포하는 안을 우선한다. 브라우저 로컬 저장을 쓰므로 데이터베이스는 추가하지 않고, Application Insights로 오류·지연을 관찰한다. Aspire AppHost는 별도 .NET 프로젝트이므로 Python 백엔드만 사용하더라도 .NET SDK가 필요하다. Container Apps Aspire target, 컨테이너 빌드/실행, Azure 기본 도메인 동작을 P0에서 검증한다.
- **비밀·인증:** 로컬은 환경변수, Azure는 검증된 Azure 리소스 설정/Key Vault 참조로 모델 인증 정보를 주입한다. Copilot SDK의 BYOK는 API 키 기반이며 Azure Managed Identity를 모델 키로 직접 사용하지 못한다. 실제 공급자 인증과 Key Vault 연동은 P0에서 검증하고, 공고 URL·자소서 메모 등 개인 정보와 비밀값은 로그에 남기지 않는다.
- **공개 API 보호:** 로그인 없는 심사 환경에서는 앱 전체에 인증을 강제하지 않되, AI 분석 API는 IP/요청 단위 rate limit, 요청 크기 제한, 시간 제한을 둔다. 사용자 입력이나 URL 내용을 운영 로그에 저장하지 않는다. 익명 공개 서비스의 비용 한도와 rate limit은 Azure에서 검증한다.
- **제출 공개성:** 배포는 Azure 기본 도메인을 사용하고 커스텀 도메인을 요구하지 않는다. 심사자가 로그인·별도 자격 증명 없이 핵심 기능을 실행할 수 있게 한다.

## URL 가져오기 안전성 및 오류
백엔드 도구에서만 페이지를 가져온다. HTTPS만 허용하고 URL 사용자정보·사설/루프백/링크 로컬 IP를 거부하며, DNS 결과와 각 리디렉션 목적지를 다시 검증한다. 리디렉션 수·응답 크기·시간을 제한하고 HTML만 처리한다. 로그인·차단·동적 페이지·파싱 실패는 구분해 알리고, 수동 편집/입력으로 흐름을 이어 간다. URL 입력은 외부 프롬프트 인젝션으로 취급하고 페이지 지시문을 에이전트 명령으로 따르지 않는다.

## 구현 단계
1. **P0 검증:** Python 3.11+/Flask/MAF Python/Copilot SDK Python 조합의 실제 도구 호출, 두 agent 역할, 스트리밍과 Flask 비동기 연결을 검증한다. 별도로 .NET 기반 Aspire AppHost의 Azure Container Apps target 및 컨테이너 배포를 확인한다. 미지원이면 중단하고 기술 결정을 갱신한다.
2. **P1 보드:** 저장소 모델/API, 상태 칸반, 일정·버전 편집과 단위/통합 테스트.
3. **P2 에이전트 흐름:** 안전한 URL 가져오기, 근거가 있는 추출·검증, SSE 상태, 사용자 확인 및 실패 경로.
4. **P3 배포:** Aspire `deploy`, Azure Container Apps/비밀값 주입/Application Insights 설정, Azure 기본 도메인 배포·헬스·오류 확인. 필수 CLI와 Azure 구독 권한이 확보될 때 수행한다.

## 운영상 제약
`localStorage`는 브라우저·기기 간 동기화와 서버 복구를 제공하지 않으며, 브라우저 데이터를 지우면 저장 항목이 사라진다. 심사 환경에서 민감한 개인 정보를 입력하지 않도록 안내한다. 개발 환경의 Python 3.9.6은 SDK 최소 요구 버전보다 낮고, Aspire AppHost 실행에 필요한 .NET/Azure 도구도 설치되어 있지 않다. 배포 검증 전에는 Azure 배포 완료를 주장하지 않는다. SDK 런타임, 모델 공급자 인증, Flask 스트리밍, 익명 요청 제한과 관찰성은 실제 환경에서 검증한다.
