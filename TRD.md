# TRD — 취준·이직 파이프라인 보드

## 구현·환경 확인 (2026-11-05)
- 최초 저장소에는 문서만 있었으며, 현재 .NET 10 API, React/Vite 클라이언트, 테스트 프로젝트, Aspire AppHost가 추가됐다.
- 기술 검증은 .NET SDK 10.0.403, `GitHub.Copilot.SDK` 1.0.28, `Microsoft.Agents.AI.Workflows` 1.27.0 조합에서 통과했다. 저장소는 SDK 10.0.100을 `latestFeature`로 허용하며 NuGet 패키지 버전을 고정한다.
- API/AppHost 빌드, URL 안전성 테스트 10개, 클라이언트 빌드·린트가 통과했다. Aspire 13.6.4 `publish`로 Bicep 산출물 생성도 확인했다.
- Azure CLI/구독 인증은 사용할 수 없어 실제 `aspire deploy`, Key Vault secret 해석, 공개 Azure 기본 도메인, Application Insights 수집은 검증하지 않았다. 배포 자격 증명을 설정하기 전까지 배포 완료로 간주하지 않는다.
- [해커톤 참가 안내](https://github.com/hackersground-kr/hackathon-cheongdo/blob/main/README.md), [평가 기준](https://github.com/hackersground-kr/hackathon-cheongdo/blob/main/judgement/judgement-criteria.md), [청도 사회문제 브리핑](https://github.com/hackersground-kr/hackathon-cheongdo/blob/main/references/cheongdo-social-issues.md)을 확인했다. 안내는 청년 취업·창업 지원을 참고 주제로 제시하고, 로그인 없는 심사 가능성과 Azure 기본 도메인 배포를 요구한다. 평가 가중치는 SDK+Agent Framework 25%, 생산성·문제 적합성 18%, Azure 18%, 완성도 16%, UX 12%, 책임 있는 AI·보안 6%, 혁신성 5%다.

## 기술 근거와 선행 검증
- Copilot SDK 공식 저장소는 .NET 및 TypeScript SDK를 제공한다. .NET SDK는 `GitHub.Copilot.SDK`와 이벤트 기반 세션을 제공하며, 모델 호출은 GitHub Copilot 인증 또는 BYOK가 필요하다. BYOK는 API 키 기반이며 Azure Managed Identity를 지원하지 않는다. 배포 시 키는 Key Vault 참조 등으로 주입해야 한다.
- Microsoft Agent Framework 공식 문서는 .NET·Python·Go 에이전트와 다중 에이전트 workflow를 설명한다. 이번 조사에서 Copilot SDK를 Agent Framework에 연결하는 공식 어댑터/통합은 확인되지 않았다. 따라서 구현 전 기술 검증(P0)에서 사용자 정의 어댑터의 실동작을 증명한다. 호환되지 않으면 대체 아키텍처를 임의 적용하지 않는다.
- Aspire 공식 배포 문서는 `aspire deploy`가 AppHost에 배포 target 리소스가 있을 때만 실제 배포 단계를 실행한다고 명시하고, Azure App Service 및 Azure Container Apps target을 지원한다. 단순히 CLI 명령만 두는 것으로는 배포가 되지 않는다.
- 해커톤 평가 기준은 두 필수 기술의 실질적 활용을 요구한다. Azure AI/모델 서비스 사용은 필수로 요구하지 않으며, 불필요한 Azure 서비스를 추가하면 감점될 수 있다.
- 참고: [Copilot SDK](https://github.com/github/copilot-sdk), [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/), [Aspire 배포 모델](https://aspire.dev/deployment/deploy-with-aspire/).

## 구현 아키텍처
- **웹:** React + TypeScript. 보드, URL 검토/수정 화면, 반응형 상태 표현.
- **API/에이전트:** ASP.NET Core, .NET 10, Microsoft Agent Framework workflow, Copilot SDK .NET. `POST /api/analyze`가 SSE로 단계·응답을 전달한다. 사용자 정의 MAF executor가 실제 Copilot SDK 세션을 순차 호출하며, 공식 SDK 간 어댑터라고 주장하지 않는다.
- **에이전트·도구:** 분석 에이전트에는 사용자가 제출한 페이지를 읽는 도구만 허용하고, 검증 에이전트에는 도구를 제공하지 않는다. 저장 도구는 어느 에이전트에도 노출하지 않는다.
- **데이터:** 현재 확인한 공고는 브라우저 `localStorage`에만 저장하며, 공고 URL과 추출 결과를 서버에 영구 저장하지 않는다. 면접 일정·자소서 버전 메모는 미구현이다. 기기 간 동기화·복구는 지원하지 않는다.
- **현재 UI 범위:** URL 등록·AI 검토·확인 저장 및 저장 공고 목록/삭제가 구현됐다. 전체 칸반, 면접 일정, 자소서 버전 관리 기능은 아직 구현되지 않았다.
- **Azure 최소 구성:** Aspire AppHost는 Azure App Service, Key Vault, Application Insights target을 구성한다. 브라우저 로컬 저장을 쓰므로 데이터베이스는 없다. `aspire publish` 템플릿 생성은 통과했지만 Azure 배포와 런타임 관찰성은 미검증이다.
- **비밀·인증:** 로컬은 환경변수 또는 Copilot SDK 기본 로그인, Azure에서는 App Service 설정의 Key Vault 참조로 모델 인증 정보를 주입한다. SDK의 Azure Managed Identity BYOK 미지원 제약을 숨기지 않는다. 로컬 SDK 호출은 검증됐으나 Azure Key Vault 주입은 미검증이다. 공고 URL·자소서 메모 등 개인 정보와 비밀값은 로그에 남기지 않는다.
- **공개 API 보호:** 로그인 없는 심사 환경에서는 앱 전체에 인증을 강제하지 않되, AI 분석 API는 IP/요청 단위 rate limit, 요청 크기 제한, 시간 제한을 둔다. 사용자 입력이나 URL 내용을 운영 로그에 저장하지 않는다. 익명 공개 서비스의 비용 한도와 rate limit은 Azure에서 검증한다.
- **제출 공개성:** 배포는 Azure 기본 도메인을 사용하고 커스텀 도메인을 요구하지 않는다. 심사자가 로그인·별도 자격 증명 없이 핵심 기능을 실행할 수 있게 한다.

## URL 가져오기 안전성 및 오류
백엔드 도구에서만 페이지를 가져온다. HTTPS만 허용하고 URL 사용자정보·사설/루프백/링크 로컬 IP를 거부하며, DNS 결과와 각 리디렉션 목적지를 다시 검증한다. 리디렉션 수·응답 크기·시간을 제한하고 HTML만 처리한다. 로그인·차단·동적 페이지·파싱 실패는 구분해 알리고, 수동 편집/입력으로 흐름을 이어 간다. URL 입력은 외부 프롬프트 인젝션으로 취급하고 페이지 지시문을 에이전트 명령으로 따르지 않는다.

## 구현 단계와 상태
1. **P0 검증 — 완료:** .NET/MAF/Copilot SDK 조합, 실제 도구 호출, 순차 agent workflow, SDK 스트리밍을 작은 실행 가능한 proof로 확인했다.
2. **P1 보드 — 부분 구현:** 확인 저장 및 브라우저 공고 목록은 구현했다. 칸반 상태 이동, 일정·버전 관리는 미구현이다.
3. **P2 에이전트 흐름 — 완료:** 제한된 HTTPS 가져오기, 근거 추출·검증, SSE 진행 상태, 사용자 확인 및 수동 입력 경로를 구현했다.
4. **P3 배포 — 부분 검증:** Aspire publish 템플릿 생성은 통과했다. 실제 `aspire deploy`, Key Vault 참조, Azure 도메인·헬스·App Insights 확인은 Azure CLI와 구독 권한 확보 후 수행해야 한다.

## 운영상 제약
`localStorage`는 브라우저·기기 간 동기화와 서버 복구를 제공하지 않으며, 브라우저 데이터를 지우면 저장 항목이 사라진다. 심사 환경에서 민감한 개인 정보를 입력하지 않도록 안내한다. 배포 검증 전에는 Azure 배포 완료를 주장하지 않는다. SDK 런타임, 모델 공급자 인증, 익명 요청 제한과 관찰성 내보내기는 실제 Azure에서 검증한다.
