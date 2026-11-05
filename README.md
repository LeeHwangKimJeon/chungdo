# 청도 취업 파이프라인

공고 URL을 서버에서 안전하게 읽고, GitHub Copilot SDK의 공고 분석·근거 검증 에이전트가 제안한 값을 사용자가 확인한 뒤 브라우저 보드에 저장하는 MVP 수직 슬라이스입니다. 보드 데이터는 브라우저 `localStorage`에만 저장됩니다.

## 로컬 실행

필요한 도구는 .NET 10 SDK와 Node.js 20.19 이상입니다.

```sh
dotnet run --project src/JobBoard.AppHost
```

Aspire AppHost는 앱을 시작하고 React 클라이언트를 함께 빌드합니다. API는 `COPILOT_GITHUB_TOKEN` 환경변수를 우선 사용하고, 없으면 Copilot SDK의 기본 로그인 인증을 사용합니다. 모델은 `COPILOT_MODEL`로 지정할 수 있으며 기본값은 `gpt-4.1`입니다. 토큰을 코드·로그·일반 설정 파일에 저장하지 마세요.

## 동작 범위와 안전성

- 분석 API에는 분당 IP 기준 8회 제한과 요청 크기 제한이 있습니다.
- 서버 fetch는 HTTPS 443만 허용하고, DNS의 사설·로컬·예약 주소를 차단합니다. 리디렉션마다 재검증하고 연결 시 DNS를 다시 검증해 해당 공개 IP에 직접 연결합니다. HTML 응답은 1MB, 분석용 텍스트는 30,000자, 가져오기 시간은 제한됩니다.
- 분석 에이전트에는 사용자가 입력한 URL만 가져오는 읽기 전용 도구 하나만 허용됩니다. 검증 에이전트에는 도구가 없습니다. 페이지 내용은 신뢰할 수 없는 데이터로 취급하며, 서버가 근거 문구의 페이지 포함 여부도 확인합니다.
- 에이전트 진행과 응답 조각은 SSE로 표시합니다. 가져오기·에이전트·응답 형식 오류는 실패로 표시하며, 수동 입력과 재시도가 가능합니다.
- AI 제안은 확인 전 저장되지 않습니다. 사용자가 수정한 뒤 **확인하고 보드에 저장**을 눌러야 브라우저에 기록됩니다. AI는 지원 제출, 칸반 이동, 일정 또는 자소서 버전 기능을 실행하지 않습니다.
- 로컬 저장 데이터는 브라우저·기기 간 동기화되지 않습니다. 공개 심사에는 민감한 개인 정보를 입력하지 마세요.

## 기술 검증 및 테스트

구현 전 .NET 10.0.403에서 GitHub Copilot SDK 1.0.28과 Microsoft Agent Framework 1.27.0을 사용해 실제 도구 호출, 두 Copilot 세션을 순차 연결한 MAF workflow, SDK 이벤트 스트리밍을 검증했습니다. 저장소에는 이 버전 조합을 고정했습니다.
검증된 항목은 API/AppHost 빌드, URL 안전성 테스트 10개, 클라이언트 빌드·린트, Aspire publish 템플릿 생성입니다. 수동 브라우저 확인에서는 사용자가 저장 버튼을 누르기 전에는 보드가 비어 있고, 확인 후 저장된 공고가 새로고침 뒤에도 남는 것을 확인했습니다. 실제 Azure 배포나 런타임 Key Vault/App Insights 동작은 검증되지 않았습니다.

```sh
dotnet test tests/JobBoard.Api.Tests/JobBoard.Api.Tests.csproj
dotnet build src/JobBoard.AppHost/JobBoard.AppHost.csproj
cd src/JobBoard.Api/ClientApp && npm ci && npm run build && npm run lint
```

## Azure 배포

AppHost는 Aspire 13.6.4 App Service 배포 target을 사용하며, Azure Key Vault에서 `COPILOT_GITHUB_TOKEN`을 공급하고 Application Insights를 활성화하도록 구성되어 있습니다. 배포 전에 AppHost의 `copilot-github-token-value` secret parameter를 Azure용 Copilot 인증 정보로 설정하고, Azure CLI/Aspire CLI에 로그인한 뒤 `aspire deploy`를 실행하세요. 이 저장소 작업 환경에는 Azure CLI·Azure 구독 인증이 없어 실제 Azure 배포, Key Vault 참조 해석, 공개 도메인, Application Insights 수집은 검증되지 않았습니다.
