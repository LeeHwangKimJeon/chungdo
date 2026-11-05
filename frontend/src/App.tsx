import { useMemo, useState } from "react";

type Stage =
  | "interest"
  | "preparing"
  | "applied"
  | "passed"
  | "interview"
  | "offer";

type View = "pipeline" | "calendar" | "notes";

type Job = {
  id: number;
  company: string;
  title: string;
  stage: Stage;
  deadline: string;
  interview?: string;
  tag: string;
};

type ExtractedField = {
  value: string | null;
  confidence: number;
  evidence: string | null;
};

type AnalysisResult = {
  company: ExtractedField;
  title: ExtractedField;
  deadline: ExtractedField;
  source_url: string;
  ai_generated: true;
  needs_review: string[];
};

type ApiErrorPayload = {
  error?: {
    message?: string;
  };
};

async function* readServerEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function parseBlock(block: string) {
    let event = "message";
    const data: string[] = [];

    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).trimStart());
      }
    }

    if (!data.length) return null;
    return { event, data: JSON.parse(data.join("\n")) as unknown };
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer = (buffer + (value ? decoder.decode(value, { stream: !done }) : ""))
        .replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseBlock(block);
        if (parsed) yield parsed;
        boundary = buffer.indexOf("\n\n");
      }

      if (done) {
        if (buffer.trim()) {
          const parsed = parseBlock(buffer);
          if (parsed) yield parsed;
        }
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

const columns: { id: Stage; label: string }[] = [
  { id: "interest", label: "관심" },
  { id: "preparing", label: "준비 중" },
  { id: "applied", label: "지원 완료" },
  { id: "passed", label: "서류 통과" },
  { id: "interview", label: "면접" },
  { id: "offer", label: "제안" },
];

const initialJobs: Job[] = [
  {
    id: 1,
    company: "오렌지랩",
    title: "콘텐츠 마케터",
    stage: "preparing",
    deadline: "2024-06-28",
    tag: "AI 추천",
  },
  {
    id: 2,
    company: "카카오",
    title: "서비스 기획 인턴",
    stage: "interest",
    deadline: "2024-07-04",
    tag: "관심 공고",
  },
  {
    id: 3,
    company: "무신사",
    title: "브랜드 마케팅",
    stage: "applied",
    deadline: "2024-06-21",
    tag: "지원 완료",
  },
  {
    id: 4,
    company: "토스",
    title: "Product Designer",
    stage: "passed",
    deadline: "2024-06-18",
    interview: "2024-06-20T14:00",
    tag: "서류 통과",
  },
  {
    id: 5,
    company: "오늘의집",
    title: "콘텐츠 에디터",
    stage: "interview",
    deadline: "2024-06-30",
    interview: "2024-06-24T11:00",
    tag: "면접 예정",
  },
];

const storageKey = "chungdo-jobs";

function loadJobs(): Job[] {
  const saved = localStorage.getItem(storageKey);
  return saved ? JSON.parse(saved) : initialJobs;
}

function App() {
  const [view, setView] = useState<View>("pipeline");
  const [jobs, setJobs] = useState<Job[]>(loadJobs);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [toast, setToast] = useState("");

  const [url, setUrl] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [analysisError, setAnalysisError] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState("");
  const [analysisEvidence, setAnalysisEvidence] = useState("");
  const [manualEntry, setManualEntry] = useState(false);

  const filteredJobs = useMemo(() => {
    const keyword = search.toLowerCase();

    return jobs.filter((job) =>
      `${job.company} ${job.title}`.toLowerCase().includes(keyword),
    );
  }, [jobs, search]);

  function updateJobs(nextJobs: Job[]) {
    setJobs(nextJobs);
    localStorage.setItem(storageKey, JSON.stringify(nextJobs));
  }

  function notify(message: string) {
    setToast(message);
    setTimeout(() => setToast(""), 2200);
  }

  function resetModal() {
    setModalOpen(false);
    setUrl("");
    setCompany("");
    setTitle("");
    setDeadline("");
    setAnalysisStatus("idle");
    setAnalysisError("");
    setAnalysisProgress("");
    setAnalysisEvidence("");
    setManualEntry(false);
  }

  async function analyzeJob() {
    if (!url.trim()) {
      notify("공고 URL을 입력해 주세요.");
      return;
    }

    setAnalysisStatus("loading");
    setAnalysisError("");
    setAnalysisProgress("");
    setAnalysisEvidence("");
    setManualEntry(false);
    setCompany("");
    setTitle("");
    setDeadline("");

    try {
      const response = await fetch("/api/v1/postings/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!response.ok) {
        let message = `공고 분석 요청에 실패했습니다. (${response.status})`;
        try {
          const payload = (await response.json()) as ApiErrorPayload;
          message = payload.error?.message || message;
        } catch {
          throw new Error(message);
        }
        throw new Error(message);
      }
      if (!response.body) {
        throw new Error("분석 스트림을 시작할 수 없습니다. 다시 시도해 주세요.");
      }

      let receivedResult = false;
      for await (const serverEvent of readServerEvents(response.body)) {
        if (serverEvent.event === "status") {
          const data = serverEvent.data as { message?: string };
          setAnalysisProgress(data.message || "공고 정보를 분석하고 있습니다.");
        } else if (serverEvent.event === "delta") {
          const data = serverEvent.data as { text?: string };
          if (data.text) {
            setAnalysisProgress((current) => `${current}${data.text}`);
          }
        } else if (serverEvent.event === "error") {
          const data = serverEvent.data as { message?: string };
          throw new Error(data.message || "공고 분석에 실패했습니다.");
        } else if (serverEvent.event === "result") {
          const result = serverEvent.data as AnalysisResult;
          setCompany(result.company.value || "");
          setTitle(result.title.value || "");
          setDeadline(result.deadline.value || "");
          setAnalysisEvidence(
            [
              `회사명: ${result.company.evidence || "근거를 확인하지 못했습니다."}`,
              `공고명: ${result.title.evidence || "근거를 확인하지 못했습니다."}`,
              `마감일: ${result.deadline.evidence || "공고에서 확인되지 않았습니다."}`,
            ].join(" · "),
          );
          setAnalysisProgress("");
          setAnalysisStatus("success");
          receivedResult = true;
        }
      }

      if (!receivedResult) {
        throw new Error("분석 연결이 결과 수신 전에 종료되었습니다. 다시 시도해 주세요.");
      }
    } catch (error) {
      setAnalysisStatus("error");
      setAnalysisError(
        error instanceof Error
          ? error.message
          : "공고 분석 중 알 수 없는 오류가 발생했습니다.",
      );
    }
  }

  function saveJob() {
    if (!company.trim() || !title.trim()) {
      notify("회사명과 공고명을 입력해 주세요.");
      return;
    }

    const newJob: Job = {
      id: Date.now(),
      company,
      title,
      deadline,
      stage: "interest",
      tag: manualEntry ? "직접 입력" : "AI 확인 완료",
    };

    updateJobs([newJob, ...jobs]);
    resetModal();
    notify("공고가 저장되었습니다.");
  }

  function moveJob(stage: Stage) {
    if (draggedId === null) return;

    const nextJobs = jobs.map((job) =>
      job.id === draggedId ? { ...job, stage } : job,
    );

    updateJobs(nextJobs);
    setDraggedId(null);
    notify("지원 단계가 변경되었습니다.");
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-mark">C</div>
          <div>
            <strong>chungdo</strong>
            <small>취업 파이프라인</small>
          </div>
        </div>

        <nav>
          <button
            className={view === "pipeline" ? "nav active" : "nav"}
            onClick={() => setView("pipeline")}
          >
            ▦ 파이프라인
          </button>

          <button
            className={view === "calendar" ? "nav active" : "nav"}
            onClick={() => setView("calendar")}
          >
            ◫ 일정
          </button>

          <button
            className={view === "notes" ? "nav active" : "nav"}
            onClick={() => setView("notes")}
          >
            ☷ 자소서 메모
          </button>
        </nav>

        <div className="sidebar-tip">
          <b>✦ 오늘의 한 걸음</b>
          <p>작은 기록이 기회를 놓치지 않게 해요.</p>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <span>내 보드 / {view === "pipeline" ? "파이프라인" : view === "calendar" ? "일정" : "자소서 메모"}</span>
          <span>민지님의 보드</span>
        </header>

        {view === "pipeline" && (
          <section className="content">
            <div className="heading">
              <div>
                <p className="eyebrow">MY JOB SEARCH</p>
                <h1>안녕하세요, 민지님 ✦</h1>
                <p>오늘도 한 걸음씩, 나에게 맞는 기회를 찾아봐요.</p>
              </div>

              <button className="primary" onClick={() => setModalOpen(true)}>
                ＋ 공고 추가
              </button>
            </div>

            <div className="summary">
              <Summary label="전체 지원" value={`${jobs.length}건`} />
              <Summary
                label="진행 중"
                value={`${jobs.filter((job) => job.stage !== "offer").length}건`}
              />
              <Summary
                label="서류 통과"
                value={`${jobs.filter((job) => job.stage === "passed").length}건`}
              />
              <Summary
                label="면접 일정"
                value={`${jobs.filter((job) => job.interview).length}건`}
              />
            </div>

            <div className="toolbar">
              <h2>지원 현황</h2>

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="회사명, 공고명 검색"
              />
            </div>

            <div className="board">
              {columns.map((column) => {
                const columnJobs = filteredJobs.filter(
                  (job) => job.stage === column.id,
                );

                return (
                  <div
                    className="column"
                    key={column.id}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => moveJob(column.id)}
                  >
                    <div className="column-title">
                      <b>{column.label}</b>
                      <span>{columnJobs.length}</span>
                    </div>

                    {columnJobs.length === 0 && (
                      <div className="empty">공고를 끌어다 놓아보세요</div>
                    )}

                    {columnJobs.map((job) => (
                      <article
                        className="job-card"
                        draggable
                        key={job.id}
                        onDragStart={() => setDraggedId(job.id)}
                      >
                        <small>{job.company}</small>
                        <h3>{job.title}</h3>
                        <p>마감일 {job.deadline || "미정"}</p>
                        <em>{job.tag}</em>
                      </article>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {view === "calendar" && (
          <section className="content">
            <p className="eyebrow">SCHEDULE</p>
            <h1>일정 한눈에 보기</h1>

            <div className="schedule-card">
              {jobs
                .filter((job) => job.deadline || job.interview)
                .map((job) => (
                  <div className="schedule-item" key={job.id}>
                    <b>{job.company}</b>
                    <span>{job.title}</span>
                    <small>
                      {job.interview
                        ? `면접: ${job.interview}`
                        : `마감: ${job.deadline}`}
                    </small>
                  </div>
                ))}
            </div>
          </section>
        )}

        {view === "notes" && (
          <section className="content">
            <p className="eyebrow">DOCUMENT NOTES</p>
            <h1>자소서 버전 메모</h1>

            <div className="notes">
              {jobs.slice(0, 3).map((job) => (
                <article className="note" key={job.id}>
                  <b>
                    {job.company} · {job.title}
                  </b>
                  <small>최근 수정 2024.06.15</small>
                  <p>
                    지원 직무에 맞춰 경험과 프로젝트 내용을 수정한 버전입니다.
                  </p>
                  <em>v2 · 지원용</em>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      {modalOpen && (
        <div className="modal-bg">
          <div className="modal">
            <button className="close" onClick={resetModal}>
              ×
            </button>

            <p className="eyebrow">NEW APPLICATION</p>
            <h2>공고를 추가해볼까요?</h2>
            <p>URL을 붙여 넣으면 AI가 공고 정보를 찾아드려요.</p>

            <label>
              공고 URL
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/job"
              />
            </label>

            <button
              className="outline"
              onClick={analyzeJob}
              disabled={analysisStatus === "loading"}
            >
              ✦ AI로 공고 분석하기
            </button>

            {analysisStatus === "loading" && (
              <div className="status loading">
                {analysisProgress || "공고 정보를 분석하고 있어요..."}
              </div>
            )}

            {analysisStatus === "error" && (
              <div className="status error">
                {analysisError} 아래에 직접 입력하거나 URL을 확인하고 다시 시도해 주세요.
                <button
                  onClick={() => {
                    setAnalysisStatus("success");
                  setManualEntry(true);
                  setCompany("");
                  setTitle("");
                  setDeadline("");
                  }}
                >
                  직접 입력하기
                </button>
              </div>
            )}

            {analysisStatus === "success" && (
              <div className="result">
                <span>
                  {manualEntry ? "직접 입력 · 저장 전 확인" : "✦ AI 생성 · 확인 필요"}
                </span>

                <label>
                  회사명
                  <input
                    value={company}
                    onChange={(event) => setCompany(event.target.value)}
                  />
                </label>

                <label>
                  공고명
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>

                <label>
                  마감일
                  <input
                    type="date"
                    value={deadline}
                    onChange={(event) => setDeadline(event.target.value)}
                  />
                </label>

                {!manualEntry && (
                  <p className="evidence">근거: {analysisEvidence}</p>
                )}
              </div>
            )}

            <div className="modal-footer">
              <button onClick={resetModal}>취소</button>
              <button
                className="primary"
                onClick={saveJob}
                disabled={analysisStatus !== "success"}
              >
                확인하고 저장
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export default App;