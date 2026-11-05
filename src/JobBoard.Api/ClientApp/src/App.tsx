import { useRef, useState, type FormEvent } from 'react'
import './App.css'

type FieldName = 'company' | 'title' | 'deadline'
type PostingCandidate = {
  field: FieldName
  value: string | null
  evidence: string | null
  verified: boolean
  note: string | null
}
type AnalysisResult = {
  url: string
  pageTitle: string | null
  aiGenerated: boolean
  fields: PostingCandidate[]
}
type ProgressEvent = {
  type: 'stage' | 'token' | 'result' | 'error'
  agent?: string
  text?: string
  result?: AnalysisResult
}
type Draft = {
  company: string
  title: string
  deadline: string
}
type SavedPosting = {
  id: string
  url: string
  savedAt: string
  aiGenerated: boolean
  fields: PostingCandidate[]
}

const storageKey = 'chungdo-postings-v1'
const fieldLabels: Record<FieldName, string> = {
  company: '회사명',
  title: '공고명',
  deadline: '마감일',
}
const emptyDraft: Draft = { company: '', title: '', deadline: '' }

function readSavedPostings() {
  try {
    const saved = window.localStorage.getItem(storageKey)
    if (!saved) return { postings: [] as SavedPosting[], error: '' }
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed) || !parsed.every(isSavedPosting)) {
      throw new Error('저장된 공고 데이터 형식이 올바르지 않습니다.')
    }
    return { postings: parsed, error: '' }
  } catch (error) {
    return {
      postings: [] as SavedPosting[],
      error: error instanceof Error ? error.message : '저장된 공고를 읽지 못했습니다.',
    }
  }
}

function isSavedPosting(value: unknown): value is SavedPosting {
  if (!value || typeof value !== 'object') return false
  const posting = value as Partial<SavedPosting>
  return typeof posting.id === 'string'
    && typeof posting.url === 'string'
    && typeof posting.savedAt === 'string'
    && typeof posting.aiGenerated === 'boolean'
    && Array.isArray(posting.fields)
    && posting.fields.every((field) => field !== null
      && typeof field === 'object'
      && ['company', 'title', 'deadline'].includes(field.field)
      && (field.value === null || typeof field.value === 'string')
      && (field.evidence === null || typeof field.evidence === 'string')
      && typeof field.verified === 'boolean'
      && (field.note === null || typeof field.note === 'string'))
}

function safePostingHref(value: string) {
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
    if (parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || (parsed.port && parsed.port !== '443')
      || host === 'localhost'
      || host.endsWith('.localhost')
      || host.endsWith('.local')
      || host.endsWith('.internal')) return null
    const octets = host.split('.').map(Number)
    if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [first, second] = octets
      if (first === 0 || first === 10 || first === 127
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168)
        || (first === 192 && second === 0)
        || (first === 198 && (second === 18 || second === 19 || second === 51))
        || (first === 203 && second === 0)
        || (first === 100 && second >= 64 && second <= 127)
        || first >= 224) return null
    }
    if (host.includes(':') && (!/^[23]/.test(host) || host.startsWith('2001:db8:') || host.startsWith('2002:'))) return null
    return parsed.href
  } catch {
    return null
  }
}

function draftFromResult(result: AnalysisResult): Draft {
  const value = (field: FieldName) => result.fields.find((item) => item.field === field)?.value ?? ''
  return { company: value('company'), title: value('title'), deadline: value('deadline') }
}

function App() {
  const [initialStorage] = useState(readSavedPostings)
  const [url, setUrl] = useState('')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [postings, setPostings] = useState(initialStorage.postings)
  const [storageError, setStorageError] = useState(initialStorage.error)
  const [analysisError, setAnalysisError] = useState('')
  const [formError, setFormError] = useState('')
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'review' | 'saved'>('idle')
  const [progress, setProgress] = useState<string[]>([])
  const [streamed, setStreamed] = useState<Record<string, string>>({})
  const abortRef = useRef<AbortController | null>(null)
  const receivedResult = useRef(false)

  const analyzeUrl = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAnalysisError('')
    setFormError('')
    setAnalysis(null)
    setDraft(emptyDraft)
    setProgress([])
    setStreamed({})
    receivedResult.current = false
    setStatus('analyzing')
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(body?.error || `분석 요청에 실패했습니다 (HTTP ${response.status}).`)
      }
      if (!response.body) throw new Error('분석 스트림을 시작할 수 없습니다. 직접 입력해 주세요.')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const handleBlock = (block: string) => {
        const data = block.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (!data) return
        const update = JSON.parse(data) as ProgressEvent
        if (update.type === 'stage' && update.text) {
          setProgress((current) => [...current.slice(-4), update.text!])
        } else if (update.type === 'token' && update.agent && update.text) {
          setStreamed((current) => ({ ...current, [update.agent!]: `${current[update.agent!] ?? ''}${update.text}` }))
        } else if (update.type === 'result' && update.result) {
          receivedResult.current = true
          setAnalysis(update.result)
          setDraft(draftFromResult(update.result))
          setStatus('review')
        } else if (update.type === 'error') {
          throw new Error(update.text || '공고 분석에 실패했습니다. 직접 입력해 주세요.')
        }
      }

      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() ?? ''
        for (const block of blocks) handleBlock(block)
        if (done) break
      }
      if (buffer.trim()) handleBlock(buffer)
      if (!receivedResult.current) throw new Error('분석 연결이 결과 전에 종료되었습니다. 직접 입력해 주세요.')
    } catch (error) {
      const message = controller.signal.aborted
        ? '분석을 취소했습니다. 내용을 직접 입력할 수 있습니다.'
        : error instanceof Error ? error.message : '공고 분석에 실패했습니다. 직접 입력해 주세요.'
      setAnalysisError(message)
      setAnalysis(null)
      setStatus('review')
    } finally {
      abortRef.current = null
    }
  }

  const savePosting = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')
    if (!draft.company.trim() || !draft.title.trim()) {
      setFormError('회사명과 공고명을 입력해 주세요.')
      return
    }

    const fields = (['company', 'title', 'deadline'] as const).map((field) => {
      const original = analysis?.fields.find((item) => item.field === field)
      const value = draft[field].trim() || null
      const unchanged = original?.value === value
      return {
        field,
        value,
        evidence: original?.evidence ?? null,
        verified: Boolean(original?.verified && unchanged),
        note: original && !unchanged ? '사용자가 확인·수정한 값입니다.' : original?.note ?? null,
      }
    })
    const posting: SavedPosting = {
      id: crypto.randomUUID(),
      url: analysis?.url ?? url.trim(),
      savedAt: new Date().toISOString(),
      aiGenerated: Boolean(analysis?.aiGenerated),
      fields,
    }
    const next = [posting, ...postings]
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next))
      setPostings(next)
      setStatus('saved')
      setAnalysis(null)
      setDraft(emptyDraft)
      setUrl('')
      setAnalysisError('')
      setStorageError('')
    } catch {
      setStorageError('브라우저에 공고를 저장하지 못했습니다. 저장 공간을 확인해 주세요.')
    }
  }

  const deletePosting = (id: string) => {
    const next = postings.filter((posting) => posting.id !== id)
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next))
      setPostings(next)
      setStorageError('')
    } catch {
      setStorageError('공고 변경 사항을 브라우저에 저장하지 못했습니다.')
    }
  }

  const resetReview = () => {
    abortRef.current?.abort()
    setStatus('idle')
    setAnalysis(null)
    setDraft(emptyDraft)
    setAnalysisError('')
    setFormError('')
    setProgress([])
    setStreamed({})
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="청도 취업 파이프라인 홈">
          <span className="brand-mark" aria-hidden="true">청</span>
          <span>청도 취업 파이프라인</span>
        </a>
        <span className="private-note">내 브라우저에만 저장됩니다</span>
      </header>

      <section className="intro">
        <p className="eyebrow">JOB SEARCH, IN ONE PLACE</p>
        <h1>공고를 읽고,<br className="mobile-break" /> 내 정보로 확인하세요.</h1>
        <p className="intro-copy">공고 링크를 분석해 회사명·공고명·마감일 후보와 근거를 정리합니다. 확인 전에는 보드에 저장되지 않습니다.</p>
      </section>

      <section className="panel register-panel" aria-labelledby="register-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">새 공고</p>
            <h2 id="register-title">공고 링크 등록</h2>
          </div>
          <span className="step-pill">01 / 분석</span>
        </div>
        <form className="url-form" onSubmit={analyzeUrl}>
          <label htmlFor="posting-url">공고 URL</label>
          <div className="url-row">
            <input
              id="posting-url"
              type="url"
              inputMode="url"
              placeholder="https://example.com/jobs/123"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={status === 'analyzing'}
              required
            />
            {status === 'analyzing'
              ? <button className="button button-secondary" type="button" onClick={() => abortRef.current?.abort()}>분석 취소</button>
              : <button className="button button-primary" type="submit">공고 분석하기</button>}
          </div>
          <p className="field-hint">공개 HTTPS 페이지에서만 정보를 가져옵니다. 접근이 안 되면 직접 입력할 수 있어요.</p>
        </form>

        {(status === 'analyzing' || analysisError) && (
          <div className={`analysis-status ${analysisError ? 'status-error' : ''}`} aria-live="polite">
            <div className="status-heading">
              <span className={status === 'analyzing' ? 'spinner' : 'status-icon'} aria-hidden="true">{status === 'analyzing' ? '' : '!'}</span>
              <strong>{analysisError ? '공고 분석을 완료하지 못했습니다' : '공고를 확인하고 있습니다'}</strong>
            </div>
            {analysisError && <p>{analysisError}</p>}
            {progress.length > 0 && <ul className="progress-list">{progress.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul>}
            {Object.entries(streamed).map(([agent, text]) => text && (
              <details className="stream-detail" key={agent} open>
                <summary>{agent === 'extractor' ? '공고 분석 에이전트 응답' : '근거 검증 에이전트 응답'}</summary>
                <pre>{text}</pre>
              </details>
            ))}
          </div>
        )}
      </section>

      {status === 'review' && (
        <section className="panel review-panel" aria-labelledby="review-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">사용자 확인</p>
              <h2 id="review-title">내용을 검토해 주세요</h2>
            </div>
            <span className="step-pill">02 / 확인</span>
          </div>
          {analysis?.aiGenerated && (
            <div className="ai-notice"><span>AI 생성</span> 제안된 값과 근거입니다. 수정한 뒤 저장할 수 있습니다.</div>
          )}
          {analysis?.pageTitle && <p className="page-title">가져온 페이지: {analysis.pageTitle}</p>}
          <form onSubmit={savePosting}>
            <div className="review-fields">
              {(['company', 'title', 'deadline'] as const).map((field) => {
                const candidate = analysis?.fields.find((item) => item.field === field)
                return (
                  <div className="review-field" key={field}>
                    <label htmlFor={`field-${field}`}>{fieldLabels[field]}{field !== 'deadline' && <span>필수</span>}</label>
                    <input
                      id={`field-${field}`}
                      type="text"
                      value={draft[field]}
                      onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
                      placeholder={field === 'deadline' ? '확인되지 않으면 비워 두세요' : `${fieldLabels[field]} 입력`}
                      required={field !== 'deadline'}
                    />
                    {analysis && (
                      <div className={`evidence ${candidate?.verified ? 'evidence-verified' : 'evidence-uncertain'}`}>
                        <strong>{candidate?.verified ? '근거 확인' : '확인 필요'}</strong>
                        <span>{candidate?.evidence || candidate?.note || '페이지에서 확인된 근거가 없습니다.'}</span>
                        {candidate?.note && candidate.verified && <small>{candidate.note}</small>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <div className="review-actions">
              <p>저장 버튼을 누르기 전에는 보드에 기록되지 않습니다.</p>
              <div>
                <button className="button button-secondary" type="button" onClick={resetReview}>다시 입력</button>
                <button className="button button-primary" type="submit">확인하고 보드에 저장</button>
              </div>
            </div>
          </form>
        </section>
      )}

      {status === 'saved' && <p className="success-message" role="status">확인한 공고를 보드에 저장했습니다.</p>}
      {storageError && <p className="form-error storage-error" role="alert">{storageError}</p>}

      <section className="board-section" aria-labelledby="board-title">
        <div className="section-heading board-heading">
          <div>
            <p className="eyebrow">내 지원 보드</p>
            <h2 id="board-title">확인한 공고</h2>
          </div>
          <span className="count-pill">{postings.length}건</span>
        </div>
        {postings.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">＋</span>
            <strong>아직 저장한 공고가 없어요</strong>
            <p>공고 링크를 분석하고 내용을 확인한 뒤 보드에 추가해 보세요.</p>
          </div>
        ) : (
          <ul className="posting-list">
            {postings.map((posting) => {
              const value = (field: FieldName) => posting.fields.find((item) => item.field === field)?.value || '미입력'
              return (
                <li className="posting-card" key={posting.id}>
                  <div className="posting-card-top">
                    <div>
                      <p className="posting-company">{value('company')}</p>
                      <h3>{value('title')}</h3>
                    </div>
                    <button className="text-button" type="button" onClick={() => deletePosting(posting.id)} aria-label={`${value('company')} 공고 삭제`}>삭제</button>
                  </div>
                  <div className="posting-meta">
                    <span>마감 {value('deadline')}</span>
                    <span>{posting.aiGenerated ? 'AI 제안 확인 완료' : '직접 입력'}</span>
                  </div>
                  {safePostingHref(posting.url) && <a className="posting-link" href={safePostingHref(posting.url)!} target="_blank" rel="noreferrer">공고 페이지 보기 ↗</a>}
                  <time dateTime={posting.savedAt}>{new Date(posting.savedAt).toLocaleDateString('ko-KR')} 저장</time>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <footer className="footer-note">공고 정보는 제안일 뿐입니다. 마감일과 지원 자격은 원문에서 다시 확인하세요.</footer>
    </main>
  )
}

export default App
