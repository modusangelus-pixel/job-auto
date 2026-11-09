import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Company,
  CompanyList,
  CompanyStatus,
  ImportResult,
  LookupProgress,
  SponsorCountry,
  SponsorListInfo
} from '../../../shared/types'
import { cleanName } from '../../../shared/cleanName'
import { SPONSOR_LIST_LABEL } from '../../../shared/visa'
import { dayMonthTime } from '../dates'
import { LIST_LABEL, shortLink, STATUS_LABEL, SYSTEM_LABEL } from '../labels'

// Object keys keep the order they are written in, so the tabs and chips follow labels.ts.
const LISTS = Object.keys(LIST_LABEL) as CompanyList[]
const FILTERS: (CompanyStatus | 'all')[] = [
  'all',
  ...(Object.keys(STATUS_LABEL) as CompanyStatus[])
]

const IDLE: LookupProgress = {
  running: false,
  done: 0,
  total: 0,
  current: [],
  step: null,
  lastSummary: null
}

// A rejected call carries a message written for the owner, so it is shown as it is.
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function progressLine(p: LookupProgress): string {
  let line = `Checked ${p.done} of ${p.total}`
  if (p.current.length > 0) line += ` · now: ${p.current.join(', ')}`
  if (p.step !== null) line += ` · ${p.step}`
  return line
}

function ListSelect(props: {
  label: string
  value: CompanyList
  disabled?: boolean
  onChange(list: CompanyList): void
}): React.JSX.Element {
  return (
    <select
      aria-label={props.label}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value as CompanyList)}
    >
      {LISTS.map((l) => (
        <option key={l} value={l}>
          {LIST_LABEL[l]}
        </option>
      ))}
    </select>
  )
}

/** `UK, Netherlands or Canada` */
function joinOr(items: string[]): string {
  return items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

interface SponsorItem {
  key: string
  text: string
  /** The entries' details, one per line. */
  title: string
  country: SponsorCountry
  /** The name sent with Not this company. */
  name: string
}

/**
 * A company's matches as row items, one per list and cleaned name: two spellings of one name are one item. A list
 * with one name shows it in brackets when it differs from the company's; a list with several is named once, with each
 * name in brackets.
 */
function sponsorItems(c: Company): SponsorItem[] {
  const own = cleanName(c.name)
  const byList = new Map<SponsorCountry, { name: string; norm: string; details: string[] }[]>()
  for (const m of c.sponsors) {
    const names = byList.get(m.country) ?? []
    byList.set(m.country, names)
    const norm = cleanName(m.name)
    const same = names.find((x) => x.norm === norm)
    if (!same) names.push({ name: m.name, norm, details: [m.detail] })
    else if (!same.details.includes(m.detail)) same.details.push(m.detail)
  }
  return [...byList].flatMap(([country, names]) =>
    names.map((x, i) => {
      const label = i === 0 ? SPONSOR_LIST_LABEL[country] : ''
      const bracket = names.length > 1 || x.norm !== own ? `(${x.name})` : ''
      return {
        key: `${country}|${x.norm}`,
        text: [label, bracket].filter((t) => t !== '').join(' '),
        title: x.details.join('\n'),
        country,
        name: x.name
      }
    })
  )
}

interface RowProps {
  company: Company
  /** The sponsor lists, to name the ones read when a company matches none */
  lists: SponsorListInfo[]
  /** The row's new state, after a pasted link was checked */
  onUpdated(company: Company): void
  /** Something moved, went or reset: read the list again */
  onChanged(): void
}

function CompanyRow({ company: c, lists, onUpdated, onChanged }: RowProps): React.JSX.Element {
  const [pasting, setPasting] = useState(false)
  const [link, setLink] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Whatever a button asks for, a refusal shows under this company, where the owner is looking.
  async function run(call: () => Promise<void>): Promise<void> {
    setBusy(true)
    try {
      await call()
      setMessage(null)
    } catch (err) {
      setMessage(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = (): void => {
    if (!window.confirm(`Remove ${c.name}? Its jobs, statuses and notes are removed too.`)) return
    void run(async () => {
      await window.jobAuto.removeCompany(c.id)
      onChanged()
    })
  }

  const check = (): void =>
    void run(async () => {
      onUpdated(await window.jobAuto.pasteCareersLink(c.id, link.trim()))
      setPasting(false)
      setLink('')
    })

  // Both links are shown for the owner to review; when they are the same page it is shown once, as the careers page.
  const links: { label: string; url: string }[] = []
  if (c.careersUrl) links.push({ label: 'Open careers page', url: c.careersUrl })
  if (c.jobsUrl && c.jobsUrl !== c.careersUrl)
    links.push({ label: 'Open jobs page', url: c.jobsUrl })
  const fetched = lists
    .filter((l) => l.fetchedAt !== null)
    .map((l) => SPONSOR_LIST_LABEL[l.country])
  const where = [c.hq, c.focus].filter((part) => part !== '').join(' · ')
  return (
    <li className="company">
      <div className="company-line">
        <span className="company-name">{c.name}</span>
        {where !== '' && <span className="muted">{where}</span>}
        <span className="company-system">
          {c.jobBoard ? `${SYSTEM_LABEL[c.jobBoard.system]} · ${c.jobBoard.board}` : '—'}
        </span>
        <span className="company-status">{STATUS_LABEL[c.status]}</span>
      </div>
      {c.note && <p className="muted">{c.note}</p>}
      {c.error && <p className="muted">{c.error}</p>}
      {/* Companies read directly, and those read weekly as pages with Claude, have jobs to show. */}
      {(c.status === 'direct' || c.status === 'needs_claude') && (
        <p className="muted">
          {c.readAt !== null
            ? `${c.openJobs} open ${c.openJobs === 1 ? 'job' : 'jobs'} · read ${
                c.status === 'needs_claude' ? 'as a page ' : ''
              }${dayMonthTime(c.readAt)}`
            : 'not read yet'}
        </p>
      )}
      {(c.status === 'direct' || c.status === 'needs_claude') && c.readError && (
        <p className="warn">{`Last read failed: ${c.readError}`}</p>
      )}
      {c.sponsors.length > 0 && (
        <div className="company-line sponsor-line">
          <span className="muted">Sponsor lists: </span>
          {sponsorItems(c).map((m) => (
            <span key={m.key} className="sponsor-match" title={m.title}>
              {m.text}
              <button
                className="link"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await window.jobAuto.rejectSponsor(c.id, m.country, m.name)
                    onChanged()
                  })
                }
              >
                Not this company
              </button>
            </span>
          ))}
        </div>
      )}
      {c.sponsors.length === 0 && fetched.length > 0 && (
        <p className="muted">
          {`No match on the ${joinOr(fetched)} sponsor ${fetched.length === 1 ? 'list' : 'lists'}`}
        </p>
      )}
      {links.map(({ label, url }) => (
        <div key={label} className="company-link">
          <span className="muted" title={url}>
            {shortLink(url)}
          </span>
          <button className="link" onClick={() => void run(() => window.jobAuto.openExternal(url))}>
            {label}
          </button>
        </div>
      ))}
      <div className="row-buttons">
        <button
          className="link"
          onClick={() => {
            setPasting(!pasting)
            setMessage(null)
          }}
        >
          Paste link
        </button>
        <button
          className="link"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await window.jobAuto.lookUpAgain(c.id)
              onChanged()
            })
          }
        >
          Look up again
        </button>
        <ListSelect
          label={`List for ${c.name}`}
          value={c.list}
          disabled={busy}
          onChange={(list) =>
            void run(async () => {
              await window.jobAuto.moveCompany(c.id, list)
              onChanged()
            })
          }
        />
        <button className="link remove" disabled={busy} onClick={remove}>
          Remove
        </button>
      </div>
      {pasting && (
        <form
          className="paste"
          onSubmit={(e) => {
            e.preventDefault()
            check()
          }}
        >
          <input
            aria-label={`Careers page link for ${c.name}`}
            placeholder="https://…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={busy}>
            Check
          </button>
        </form>
      )}
      {message && <p className="warn">{message}</p>}
    </li>
  )
}

function AddCompany({ onAdded }: { onAdded(): void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [list, setList] = useState<CompanyList>('vehicle')
  const [link, setLink] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function add(): Promise<void> {
    setBusy(true)
    try {
      await window.jobAuto.addCompany(name.trim(), list, link.trim() === '' ? null : link.trim())
      setName('')
      setLink('')
      setMessage(null)
    } catch (err) {
      setMessage(messageOf(err))
    } finally {
      setBusy(false)
      // A refused name or link adds nothing; the list is read again either way, so it always matches the app's.
      onAdded()
    }
  }

  return (
    <form
      className="add-company"
      onSubmit={(e) => {
        e.preventDefault()
        void add()
      }}
    >
      <input
        aria-label="New company name"
        placeholder="Company name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <ListSelect label="New company list" value={list} onChange={setList} />
      <input
        aria-label="New company careers page link (optional)"
        placeholder="Careers page link (optional)"
        value={link}
        onChange={(e) => setLink(e.target.value)}
      />
      <button type="submit" disabled={busy}>
        Add
      </button>
      {message && <p className="warn">{message}</p>}
    </form>
  )
}

export function Companies(): React.JSX.Element {
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [tab, setTab] = useState<CompanyList>('vehicle')
  const [filter, setFilter] = useState<CompanyStatus | 'all'>('all')
  const [claudePath, setClaudePath] = useState<string | null | undefined>(undefined)
  const [progress, setProgress] = useState<LookupProgress>(IDLE)
  const [starting, setStarting] = useState(false)
  const [testRun, setTestRun] = useState(false)
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState<ImportResult | null>(null)
  const [lists, setLists] = useState<SponsorListInfo[]>([])
  // A problem from a button or from the startup questions, and a problem reading the list, which a later read clears.
  const [problem, setProblem] = useState<string | null>(null)
  const [listProblem, setListProblem] = useState<string | null>(null)
  // The last progress seen, to tell a new `done` or the end of the run from a mere change of step.
  const lastProgress = useRef<LookupProgress>(IDLE)

  const load = useCallback(
    () =>
      void window.jobAuto
        .listCompanies()
        .then((list) => {
          setCompanies(list)
          setListProblem(null)
        })
        .catch((err: unknown) => setListProblem(messageOf(err))),
    []
  )

  useEffect(() => {
    const api = window.jobAuto
    load()
    void api
      .lookupInfo()
      .then((info) => {
        setClaudePath(info.claudePath)
        lastProgress.current = info.progress
        setProgress(info.progress)
      })
      .catch((err: unknown) => {
        // Without an answer the lookup can't be offered, so it is shown as needing Claude Code.
        setClaudePath(null)
        setProblem(messageOf(err))
      })
    void api
      .sponsorLists()
      .then(setLists)
      .catch((err: unknown) => setProblem(messageOf(err)))
    void api
      .appInfo()
      .then((info) => setTestRun(info.test))
      .catch((err: unknown) => setProblem(messageOf(err)))
    return api.onLookupProgress((p) => {
      const before = lastProgress.current
      lastProgress.current = p
      setProgress(p)
      // Each finished company changes its status, so the list follows the run.
      if (p.done !== before.done || (before.running && !p.running)) load()
    })
  }, [load])

  async function startLookup(): Promise<void> {
    setStarting(true)
    try {
      await window.jobAuto.startLookup()
    } catch (err) {
      setProblem(messageOf(err))
    } finally {
      setStarting(false)
      load()
    }
  }

  async function stopLookup(): Promise<void> {
    try {
      await window.jobAuto.stopLookup()
    } catch (err) {
      setProblem(messageOf(err))
    }
  }

  async function importTracker(): Promise<void> {
    setImporting(true)
    setProblem(null)
    try {
      const result = await window.jobAuto.importTracker()
      if (result) {
        setImported(result)
        load()
      }
    } catch (err) {
      setProblem(messageOf(err))
    } finally {
      setImporting(false)
    }
  }

  const updateCompany = (updated: Company): void =>
    setCompanies((all) => all && all.map((c) => (c.id === updated.id ? updated : c)))

  const all = companies ?? []
  const inTab = all.filter((c) => c.list === tab)
  const shown = filter === 'all' ? inTab : inTab.filter((c) => c.status === filter)
  const pending = all.filter((c) => c.status === 'pending').length
  // A stop followed by a start would only join the stopping run, so nothing starts while one is going.
  const running = starting || progress.running

  return (
    <div className="companies">
      <h2>Companies</h2>
      {testRun && <p className="warn">Test run: working on a copy of your data.</p>}

      <div className="import">
        <button
          className={all.length > 0 ? 'secondary' : ''}
          disabled={importing}
          onClick={() => void importTracker()}
        >
          Import your company tracker (.xlsx)
        </button>
        {imported && (
          <div className="import-result">
            <p>{`Added ${imported.added} companies. ${imported.skipped} were already in the app.`}</p>
            {imported.errors.map((line, i) => (
              <p key={i} className="warn">
                {line}
              </p>
            ))}
          </div>
        )}
      </div>
      {problem && <p className="warn">{problem}</p>}
      {listProblem && <p className="warn">{listProblem}</p>}

      {all.length > 0 && (
        <div className="lookup">
          <div className="row-buttons">
            <button disabled={running || !claudePath} onClick={() => void startLookup()}>
              {`Find careers pages (${pending} to check)`}
            </button>
            {running && (
              <button className="secondary" onClick={() => void stopLookup()}>
                Stop
              </button>
            )}
          </div>
          {claudePath === null && (
            <p className="warn">Needs Claude Code on this computer, signed in.</p>
          )}
          {running && progress.running && <p className="muted">{progressLine(progress)}</p>}
          {!running && progress.lastSummary !== null && <p>{progress.lastSummary}</p>}
        </div>
      )}

      <AddCompany onAdded={load} />

      {companies !== null && all.length === 0 && (
        <p className="muted">No companies yet. Import your company tracker, or add one above.</p>
      )}
      {all.length > 0 && (
        <>
          <div className="tabs" role="tablist">
            {LISTS.map((l) => (
              <button
                key={l}
                role="tab"
                aria-selected={l === tab}
                className="tab"
                onClick={() => setTab(l)}
              >
                {`${LIST_LABEL[l]} (${all.filter((c) => c.list === l).length})`}
              </button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Filter by status">
            {FILTERS.map((s) => (
              <button
                key={s}
                className="chip"
                aria-pressed={s === filter}
                onClick={() => setFilter(s)}
              >
                {s === 'all'
                  ? `All (${inTab.length})`
                  : `${STATUS_LABEL[s]} (${inTab.filter((c) => c.status === s).length})`}
              </button>
            ))}
          </div>
          {shown.length > 0 ? (
            <ul className="rows">
              {shown.map((c) => (
                <CompanyRow
                  key={c.id}
                  company={c}
                  lists={lists}
                  onUpdated={updateCompany}
                  onChanged={load}
                />
              ))}
            </ul>
          ) : (
            <p className="muted">No companies here.</p>
          )}
        </>
      )}
    </div>
  )
}
