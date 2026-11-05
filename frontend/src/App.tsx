import { useMemo, useState } from "react";

type Stage =
  | "interest"
  | "preparing"
  | "applied"
  | "passed"
  | "interview"
  | "offer"
  | "rejected"
  | "hold";
type View = "pipeline" | "calendar" | "notes";
type AnalysisStatus = "idle" | "loading" | "success" | "error";

type Version = { name: string; date: string; memo: string };
type Job = {
  id: number;
  company: string;
  title: string;
  stage: Stage;
  deadline: string;
  interview: string;
  tag: string;
  versions: Version[];
};

const columns: { id: Stage; label: string; color: string }[] = [
  { id: "interest", label: "관심", color: "gray" },
  { id: "preparing", label: "준비 중", color: "blue" },
  { id: "applied", label: "지원 완료", color: "purple" },
  { id: "passed", label: "서류 통과", color: "green" },
  { id: "interview", label: "면접", color: "amber" },
  { id: "offer", label: "제안", color: "teal" },
  { id: "rejected", label: "불합격", color: "red" },
  { id: "hold", label: "보류", color: "slate" },
];

const initialJobs: Job[] = [
  { id: 1, company: "새솔물류", title: "물류관리 사원", stage: "interest", deadline: "2026-11-21", interview: "", tag: "마감일 미정", versions: [] },
  { id: 2, company: "한빛식품", title: "품질관리 신입", stage: "preparing", deadline: "2026-11-07", interview: "", tag: "자소서 v3", versions: [{ name: "v3 · 실습 경험 보강", date: "11.04", memo: "HACCP 실습 내용을 2번 문항으로 옮김" }, { name: "v2 · 지원동기 수정", date: "11.01", memo: "" }] },
  { id: 3, company: "경북에너지솔루션", title: "사무보조 (계약직)", stage: "preparing", deadline: "2026-11-10", interview: "", tag: "자소서 v1", versions: [{ name: "v1 · 초안", date: "10.28", memo: "" }] },
  { id: 4, company: "다온디자인", title: "주니어 UI 디자이너", stage: "preparing", deadline: "2026-11-18", interview: "", tag: "자소서 v2", versions: [] },
  { id: 5, company: "마루소프트", title: "웹 개발 인턴", stage: "applied", deadline: "2026-11-02", interview: "", tag: "자소서 v4", versions: [] },
  { id: 6, company: "대구은빛병원", title: "원무 행정", stage: "applied", deadline: "2026-10-30", interview: "", tag: "자소서 v2", versions: [] },
  { id: 7, company: "푸른숲여행사", title: "국내여행 상품 기획", stage: "passed", deadline: "", interview: "2026-11-12", tag: "면접 일정", versions: [] },
  { id: 8, company: "동해마린텍", title: "생산관리", stage: "interview", deadline: "", interview: "2026-11-12", tag: "면접 일정", versions: [] },
];

const storageKey = "chungdo-jobs-v3";

function readJobs(): Job[] {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : initialJobs;
  } catch {
    return initialJobs;
  }
}

function dateLabel(date: string) {
  return date ? `마감 ${date.slice(5).replace("-", ".")}` : "마감일 미정";
}

function daysUntil(date: string) {
  if (!date) return "";
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const deadline = new Date(`${date}T00:00:00`).getTime();
  const days = Math.round((deadline - startOfToday) / 86400000);
  return days >= 0 ? `D-${days}` : "마감";
}

function App() {
  const [view, setView] = useState<View>("pipeline");
  const [jobs, setJobs] = useState<Job[]>(readJobs);
  const [search, setSearch] = useState("");
  const [mobileStage, setMobileStage] = useState<Stage>("preparing");
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [url, setUrl] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");

  const filteredJobs = useMemo(() => {
    const keyword = search.toLowerCase().trim();
    return jobs.filter((job) => `${job.company} ${job.title}`.toLowerCase().includes(keyword));
  }, [jobs, search]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function saveJobs(next: Job[]) {
    setJobs(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function resetModal() {
    setModalOpen(false);
    setUrl("");
    setCompany("");
    setTitle("");
    setDeadline("");
    setAnalysisStatus("idle");
  }

  function analyzeJob() {
    if (!url.trim()) return notify("공고 URL을 입력해 주세요.");
    setAnalysisStatus("loading");
    window.setTimeout(() => {
      if (!url.startsWith("https://") || /login|blocked|timeout/i.test(url)) {
        setAnalysisStatus("error");
        return;
      }
      setCompany("한빛식품");
      setTitle("품질관리 신입");
      setDeadline("2026-11-07");
      setAnalysisStatus("success");
    }, 1100);
  }

  function saveJob() {
    if (!company.trim() || !title.trim()) return notify("회사명과 공고명을 입력해 주세요.");
    saveJobs([{ id: Date.now(), company, title, deadline, interview: "", stage: "interest", tag: "AI 확인 완료", versions: [] }, ...jobs]);
    resetModal();
    notify("공고가 저장되었습니다.");
  }

  function moveJob(stage: Stage) {
    if (draggedId === null) return;
    saveJobs(jobs.map((job) => (job.id === draggedId ? { ...job, stage } : job)));
    setDraggedId(null);
    notify("지원 단계가 변경되었습니다.");
  }

  function updateSelected(patch: Partial<Job>) {
    if (!selectedJob) return;
    const next = { ...selectedJob, ...patch };
    saveJobs(jobs.map((job) => (job.id === next.id ? next : job)));
    setSelectedJob(next);
  }

  const currentColumn = columns.find((column) => column.id === mobileStage) ?? columns[1];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">▥</div><div><strong>취준보드</strong><small>내 지원 현황</small></div></div>
        <nav>
          <button className={view === "pipeline" ? "nav active" : "nav"} onClick={() => setView("pipeline")}>▥ <span>지원 보드</span></button>
          <button className={view === "calendar" ? "nav active" : "nav"} onClick={() => setView("calendar")}>▣ <span>마감·면접 일정</span></button>
          <button className={view === "notes" ? "nav active" : "nav"} onClick={() => setView("notes")}>▤ <span>자소서 버전</span></button>
        </nav>
        <div className="sidebar-note">보드는 이 브라우저에만 저장돼요.<br />브라우저 데이터를 지우면<br />함께 사라져요.</div>
      </aside>

      <main>
        <header className="demo-banner">ⓘ &nbsp; 심사용 데모예요. 실제 이름, 연락처 같은 개인 정보는 입력하지 마세요.</header>

        {view === "pipeline" && (
          <section className="content board-page">
            <div className="page-heading">
              <div><h1>지원 보드</h1><div className="headline-pills"><span>이번 주 마감 2건</span><span>다가오는 면접 1건</span></div></div>
              <div className="board-actions"><label className="searchbox">⌕<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="회사·공고 찾기" /></label><button className="primary" onClick={() => setModalOpen(true)}>＋ 공고 URL로 추가</button></div>
            </div>
            <div className="mobile-tabs">{columns.map((column) => <button key={column.id} className={column.id === mobileStage ? "active" : ""} onClick={() => setMobileStage(column.id)}>{column.label} <b>{jobs.filter((job) => job.stage === column.id).length}</b></button>)}</div>
            <div className="mobile-sort"><span>마감 가까운 순</span><b>이번 주 마감 2건</b></div>
            <div className="board">
              {columns.map((column) => {
                const columnJobs = filteredJobs.filter((job) => job.stage === column.id);
                return <section className={`column column-${column.color}`} key={column.id} onDragOver={(event) => event.preventDefault()} onDrop={() => moveJob(column.id)}>
                  <div className="column-heading"><span className="status-dot" /><strong>{column.label}</strong><b>{columnJobs.length}</b><button aria-label={`${column.label} 메뉴`}>•••</button></div>
                  <div className="column-cards">
                    {columnJobs.map((job) => <article className="job-card" draggable key={job.id} onDragStart={() => setDraggedId(job.id)} onClick={() => setSelectedJob(job)}>
                      <small>{job.company}</small><h3>{job.title}</h3>
                      <strong className={daysUntil(job.deadline) && daysUntil(job.deadline) !== "D-13" ? "deadline urgent" : "deadline"}>{daysUntil(job.deadline)}</strong>
                      <div className="job-meta"><span>▣ {dateLabel(job.deadline)}</span><span>▤ {job.tag}</span></div>
                      <select value={job.stage} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); const stage = event.target.value as Stage; saveJobs(jobs.map((item) => item.id === job.id ? { ...item, stage } : item)); notify("지원 단계가 변경되었습니다."); }}><option value={job.stage}>단계 옮기기</option>{columns.filter((item) => item.id !== job.stage).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select>
                    </article>)}
                    {!columnJobs.length && <div className="empty">이곳에 공고를 놓아보세요</div>}
                  </div>
                </section>;
              })}
            </div>
          </section>
        )}

        {view === "calendar" && <section className="content secondary-page"><div className="section-kicker">SCHEDULE</div><h1>마감·면접 일정</h1><p className="lead">놓치기 쉬운 일정을 한곳에서 확인하고 관리하세요.</p><div className="calendar-list">{jobs.filter((job) => job.deadline || job.interview).sort((a, b) => (a.deadline || a.interview).localeCompare(b.deadline || b.interview)).map((job) => <button className="calendar-item" key={job.id} onClick={() => setSelectedJob(job)}><span className="calendar-date">{job.interview ? "면접" : "마감"}</span><div><b>{job.company}</b><strong>{job.title}</strong><small>{job.interview || job.deadline}</small></div><i>›</i></button>)}</div></section>}
        {view === "notes" && <section className="content secondary-page"><div className="section-kicker">DOCUMENTS</div><h1>자소서 버전</h1><p className="lead">공고별 수정 이력과 메모를 관리하세요.</p><div className="notes-grid">{jobs.map((job) => <article className="note-card" key={job.id}><div><small>{job.company}</small><h3>{job.title}</h3></div>{(job.versions.length ? job.versions : [{ name: job.tag, date: "최근", memo: "아직 상세 메모가 없어요." }]).map((version) => <div className="version" key={version.name}><b>{version.name}</b><small>{version.date} 수정</small><p>{version.memo || "지원 직무에 맞춰 경험과 프로젝트 내용을 수정한 버전입니다."}</p></div>)}</article>)}</div></section>}
      </main>

      {modalOpen && <div className="modal-bg"><section className={`modal add-modal ${analysisStatus}`}><button className="close" onClick={resetModal}>×</button><div className="section-kicker">NEW APPLICATION</div><h2>공고를 추가해볼까요?</h2><p className="modal-lead">URL을 붙여 넣으면 AI가 공고 정보를 찾아드려요.</p>
        {analysisStatus === "idle" && <><label>공고 URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/job" /></label><button className="outline full" onClick={analyzeJob}>✦ AI로 공고 분석하기</button></>}
        {analysisStatus === "loading" && <div className="state-screen"><div className="state-icon spin">✦</div><h3>공고를 읽고 있어요</h3><p>공개 페이지에서 회사명, 직무, 마감일을 찾는 중이에요.</p><div className="progress"><span /></div><small>페이지 가져오기 · 정보 확인 중</small></div>}
        {analysisStatus === "error" && <div className="state-screen error-screen"><div className="state-icon">!</div><h3>공고를 가져오지 못했어요</h3><p>로그인이 필요하거나 페이지 접근이 제한되어 내용을 읽지 못했어요.</p><div className="error-actions"><button className="text-button" onClick={() => setAnalysisStatus("success")}>직접 입력하기</button><button className="outline full" onClick={() => setAnalysisStatus("idle")}>이 URL로 다시 시도</button></div></div>}
        {analysisStatus === "success" && <div className="review-result"><span className="ai-badge">✦ AI 생성 · 확인 필요</span><label>회사명<input value={company} onChange={(event) => setCompany(event.target.value)} /></label><label>공고명<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>마감일<input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label><p>근거: 공개 공고 본문에서 후보 정보를 찾았어요.</p></div>}
        <footer className="modal-footer"><button onClick={resetModal}>취소</button><button className="primary" disabled={analysisStatus !== "success"} onClick={saveJob}>확인하고 저장</button></footer>
      </section></div>}

      {selectedJob && <div className="drawer-bg"><aside className="drawer"><button className="close" onClick={() => setSelectedJob(null)}>×</button><div className="section-kicker">APPLICATION DETAIL</div><small className="drawer-company">{selectedJob.company}</small><h2>{selectedJob.title}</h2><label>진행 단계<select value={selectedJob.stage} onChange={(event) => updateSelected({ stage: event.target.value as Stage })}>{columns.map((column) => <option value={column.id} key={column.id}>{column.label}</option>)}</select></label><div className="drawer-section"><div className="drawer-title"><h3>일정</h3><span>자동 저장</span></div><label>지원 마감<input type="date" value={selectedJob.deadline} onChange={(event) => updateSelected({ deadline: event.target.value })} /></label><label>면접 일시<input type="datetime-local" value={selectedJob.interview} onChange={(event) => updateSelected({ interview: event.target.value })} /></label></div><div className="drawer-section"><div className="drawer-title"><h3>자소서 버전</h3><button onClick={() => updateSelected({ versions: [{ name: `v${selectedJob.versions.length + 1} · 새 버전`, date: "오늘", memo: "새 버전 메모를 입력해 주세요." }, ...selectedJob.versions] })}>＋ 추가</button></div>{selectedJob.versions.length ? selectedJob.versions.map((version) => <div className="drawer-version" key={version.name}><b>{version.name}</b><small>{version.date} 수정</small><p>{version.memo}</p></div>) : <p className="muted">아직 등록된 자소서 버전이 없어요.</p>}</div><div className="saved-callout">✓ 변경사항은 자동으로 저장돼요</div></aside></div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
