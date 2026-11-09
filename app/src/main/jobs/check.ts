// The job check: read every "read directly" company's job board, then the due careers pages with Claude, store
// the jobs and report progress.
// Nothing here may import 'electron'.
import type {
  Company,
  FilterSettings,
  JobBoard,
  JobCheckProgress,
  JobSystem,
  RawJob
} from '../../shared/types'
import { detectFromHtml, detectFromUrl } from '../careers/detect'
import { getCompany, listCompanies, saveCheck } from '../db/companies'
import type { Db } from '../db/db'
import { fittingJobs, knownDetails, noteReadFailed, saveRead, storedJobs } from '../db/jobs'
import { getSetting, loadReadPages, setSetting } from '../db/settings'
import { pageBoard, pagePrompt, pageUrlOf, parsePageJobs } from '../pages/claudeJobs'
import type { CapturedPage, PageCapture } from '../pages/types'
import { BlockedError, type Fetcher } from '../readers/fetcher'
import { loadFilters, rulesFor } from './filters'
import { regionGroupsOf } from './location'
import { READERS } from './readers'
import type { Reader } from './readers/types'

/** Reading script-built careers pages: the hidden window, and Claude. */
export interface PageReading {
  capture: PageCapture
  /** Claude Code's path; null when it isn't on this computer. */
  claudePath(): string | null
  /** One headless Claude run on a request; ok false with the reason when it failed. */
  ask(claudePath: string, prompt: string): Promise<{ ok: boolean; text: string }>
}

export interface JobCheckDeps {
  db: Db
  fetcher: Fetcher
  log(line: string): void
  onProgress(p: JobCheckProgress): void
  readers?: Partial<Record<JobSystem, Reader>>
  /** Without it, no careers page is read with Claude. */
  pages?: PageReading
  now?: () => Date
  parallel?: number
}

export interface JobCheck {
  start(): Promise<void>
  stop(): void
  progress(): JobCheckProgress
}

const LAST_CHECK_KEY = 'lastCheckAt'
/** When each company's page was last tried with Claude, as a JSON object of company id → time. */
const PAGE_TRIES_KEY = 'pageReadTried'
/** A page is read at most once a week, whether the last try worked or not. */
const PAGE_EVERY_MS = 7 * 24 * 60 * 60 * 1000
/** At most this many pages a check, so the weekly reads spread over the days instead of one long check. */
const PAGES_PER_CHECK = 20

class StoppedError extends Error {
  constructor() {
    super('stopped')
    this.name = 'StoppedError'
  }
}

const localDay = (d: Date): number => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate()

/** True when there was no check yet, or the last one was on an earlier day of the computer's calendar. */
export function shouldCheckOnOpen(lastCheckAt: string | null, now: Date): boolean {
  if (lastCheckAt === null) return true
  const last = new Date(lastCheckAt)
  if (Number.isNaN(last.getTime())) return true
  return localDay(last) < localDay(now)
}

/** True when the check should start by itself on opening: none ran today and a company is read directly. */
export function checkIsDue(
  lastCheckAt: string | null,
  companies: Pick<Company, 'status'>[],
  now: Date
): boolean {
  return shouldCheckOnOpen(lastCheckAt, now) && companies.some((c) => c.status === 'direct')
}

/**
 * One job per sourceId (countries joined in the order found, the rest from the first row). Rows with an empty
 * sourceId are left out and counted in `noId`.
 */
function mergeDuplicates(rows: RawJob[]): { jobs: RawJob[]; noId: number } {
  const byId = new Map<string, RawJob>()
  let noId = 0
  for (const row of rows) {
    if (row.sourceId === '') {
      noId++
      continue
    }
    const first = byId.get(row.sourceId)
    if (!first) byId.set(row.sourceId, { ...row, countries: [...row.countries] })
    else for (const c of row.countries) if (!first.countries.includes(c)) first.countries.push(c)
  }
  return { jobs: [...byId.values()], noId }
}

export function createJobCheck(deps: JobCheckDeps): JobCheck {
  const { db, log } = deps
  const readers = deps.readers ?? READERS
  const now = deps.now ?? ((): Date => new Date())
  const parallel = deps.parallel ?? 4
  let state: Omit<JobCheckProgress, 'lastCheckAt'> = {
    running: false,
    done: 0,
    total: 0,
    current: [],
    lastSummary: null
  }
  let stopped = false
  let running: Promise<void> | null = null
  // Kept in memory so reporting progress never touches the database (which may be what just failed).
  let lastCheckAt: string | null = null
  try {
    lastCheckAt = getSetting(db, LAST_CHECK_KEY)
  } catch {
    lastCheckAt = null
  }

  const snapshot = (): JobCheckProgress => ({
    ...state,
    current: [...state.current],
    lastCheckAt
  })
  function update(change: Partial<typeof state>): void {
    state = { ...state, ...change }
    deps.onProgress(snapshot())
  }

  /** The fetcher a reader gets: once the run is stopped it makes no further request. */
  const stopAware: Fetcher = {
    async get(url, opts) {
      if (stopped) throw new StoppedError()
      return deps.fetcher.get(url, opts)
    },
    async getBytes(url, opts) {
      if (stopped) throw new StoppedError()
      return deps.fetcher.getBytes(url, opts)
    },
    async post(url, json) {
      if (stopped) throw new StoppedError()
      return deps.fetcher.post(url, json)
    },
    async permits(url) {
      if (stopped) throw new StoppedError()
      return deps.fetcher.permits(url)
    }
  }

  /** Reads the details a row needs, when its title fits and its region is on or unknown. */
  async function withDetails(
    reader: Reader,
    board: string,
    rows: RawJob[],
    filters: FilterSettings
  ): Promise<RawJob[]> {
    if (!reader.details) return rows
    const rules = rulesFor(filters)
    const wanted = (row: RawJob): boolean =>
      row.needsDetails &&
      rules.titleFits(row.title) &&
      (row.countries.length === 0 || regionGroupsOf(row.countries).some((g) => filters.regions[g]))
    const out: RawJob[] = []
    for (const row of rows) {
      if (!wanted(row)) {
        out.push(row)
        continue
      }
      if (stopped) throw new StoppedError()
      try {
        out.push(await reader.details(stopAware, board, row))
      } catch (err) {
        // A block fails the company; any other error leaves this row as it was.
        if (err instanceof StoppedError || err instanceof BlockedError) throw err
        out.push(row)
      }
    }
    return out
  }

  /**
   * Reads one board once and stores its jobs for every company on it (a group's brands often share one careers
   * site). Returns whether the read failed, for all of them alike; null when a stop cut it short.
   */
  async function readBoard(companies: Company[], filters: FilterSettings): Promise<boolean | null> {
    const fail = (message: string, blocked: boolean): true => {
      for (const c of companies) {
        noteReadFailed(db, c.id, message, blocked, now())
        log(`read ${c.name} failed: ${message}`)
      }
      return true
    }
    const board = companies[0].jobBoard!
    const reader = readers[board.system]
    if (!reader) return fail(`No job reader for ${board.system} yet`, false)
    try {
      const result = await reader.list(stopAware, board.board, now())
      const merged = mergeDuplicates(result.jobs)
      // Rows without an id may be jobs already stored, so such a read closes nothing; when no row has an id the
      // list was misread and nothing is saved.
      if (merged.noId > 0 && merged.jobs.length === 0) {
        throw new Error('Job list not recognised: no job has an id')
      }
      // Each company on the board is saved the same rows, so the first one's stored details stand for all.
      const known = knownDetails(db, companies[0].id)
      const listed = merged.jobs.map((row) => {
        const k = known.get(row.sourceId)
        return k && row.needsDetails ? { ...row, ...k, needsDetails: false } : row
      })
      const rows = await withDetails(reader, board.board, listed, filters)
      if (stopped) return null
      const notes = [
        result.note,
        merged.noId > 0 ? `${merged.noId} jobs had no id, so no job was closed` : null
      ].filter((n) => n !== null)
      for (const c of companies) {
        const { added, closed } = saveRead(
          db,
          c.id,
          `${board.system}:${board.board}`,
          rows,
          result.complete && merged.noId === 0,
          now()
        )
        log(
          `read ${c.name}: ${rows.length} jobs (${added} new, ${closed} closed)` +
            (notes.length > 0 ? ` — ${notes.join('; ')}` : '')
        )
      }
      return false
    } catch (err) {
      // A refusal that arrives after Stop still counts: the stop error is never a BlockedError.
      const blocked = err instanceof BlockedError
      if (stopped && !blocked) return null
      return fail(err instanceof Error ? err.message : String(err), blocked)
    }
  }

  function pageTries(): Record<string, string> {
    try {
      const saved: unknown = JSON.parse(getSetting(db, PAGE_TRIES_KEY) ?? '{}')
      return typeof saved === 'object' && saved !== null ? (saved as Record<string, string>) : {}
    } catch {
      return {}
    }
  }

  function notePageTry(companyId: number, at: Date): void {
    setSetting(
      db,
      PAGE_TRIES_KEY,
      JSON.stringify({ ...pageTries(), [companyId]: at.toISOString() })
    )
  }

  /**
   * The needs-Claude companies whose page is due: switched on, a page of their own (never a job board), neither
   * read nor tried in the last week. Those waiting longest first, at most PAGES_PER_CHECK.
   */
  function pagesDue(at: Date): { company: Company; url: string }[] {
    if (!deps.pages || !loadReadPages(db)) return []
    const tries = pageTries()
    const last = (c: Company): number =>
      Math.max(
        c.readAt ? new Date(c.readAt).getTime() || 0 : 0,
        tries[c.id] ? new Date(tries[c.id]).getTime() || 0 : 0
      )
    return listCompanies(db)
      .filter((c) => c.status === 'needs_claude' && at.getTime() - last(c) >= PAGE_EVERY_MS)
      .map((company) => ({ company, url: pageUrlOf(company) }))
      .filter((p): p is { company: Company; url: string } => p.url !== null)
      .sort((a, b) => last(a.company) - last(b.company))
      .slice(0, PAGES_PER_CHECK)
  }

  /**
   * A job board the app reads itself that a loaded page lands on or links to; null when there is none. The page's
   * scripts often add the link a plain fetch never saw. SmartRecruiters forbids reading its feed, so a link to it
   * leaves the page to Claude.
   */
  function boardOnPage(page: CapturedPage): JobBoard | null {
    const found =
      detectFromUrl(page.finalUrl) ??
      detectFromHtml(page.links.map((l) => l.href).join(' '), page.finalUrl)
    return found && found.system !== 'smartrecruiters' && readers[found.system] ? found : null
  }

  /**
   * Reads one company's page; returns whether it failed. A page that leads to a job board the app reads makes the
   * company direct and that board is read at once, without Claude. Otherwise Claude reads the page, and such a read
   * never closes jobs.
   */
  async function readPage(
    c: Company,
    url: string,
    claudePath: string,
    filters: FilterSettings
  ): Promise<boolean> {
    const fail = (message: string, blocked: boolean): true => {
      noteReadFailed(db, c.id, message, blocked, now())
      log(`read ${c.name} (page) failed: ${message}`)
      return true
    }
    notePageTry(c.id, now())
    try {
      const page = await deps.pages!.capture.capture(url)
      if (page === null) return fail('robots.txt does not allow reading this page', true)
      const linked = boardOnPage(page)
      if (linked) {
        saveCheck(db, c.id, {
          careersUrl: c.careersUrl,
          jobsUrl: c.jobsUrl,
          status: 'direct',
          jobBoard: linked,
          note: c.note,
          error: null
        })
        log(
          `${c.name}: its careers page links to ${linked.system} ${linked.board}, so it is read directly from now on`
        )
        return (await readBoard([getCompany(db, c.id)!], filters)) === true
      }
      const answer = await deps.pages!.ask(claudePath, pagePrompt(c, page))
      if (!answer.ok) return fail(`Claude: ${answer.text}`, false)
      const jobs = parsePageJobs(answer.text, page.finalUrl)
      if (jobs === null) return fail('Claude gave no job list', false)
      const { added } = saveRead(db, c.id, pageBoard(page.finalUrl), jobs, false, now())
      log(`read ${c.name} (page): ${jobs.length} jobs (${added} new)`)
      return false
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err), err instanceof BlockedError)
    }
  }

  /** Reads the due pages one at a time; Stop works between them. Returns how many failed. */
  async function readPages(
    list: { company: Company; url: string }[],
    filters: FilterSettings
  ): Promise<number> {
    if (list.length === 0) return 0
    const claudePath = deps.pages!.claudePath()
    if (claudePath === null) {
      log('page reading skipped: Claude Code was not found on this computer')
      update({ total: state.total - list.length })
      return 0
    }
    let failures = 0
    for (const { company, url } of list) {
      if (stopped) break
      update({ current: [`${company.name} (page)`] })
      try {
        if (await readPage(company, url, claudePath, filters)) failures++
        update({ done: state.done + 1 })
      } finally {
        update({ current: [] })
      }
    }
    return failures
  }

  /** Companies grouped by the board they are read from, in the order each board first appears. */
  function byBoard(companies: Company[]): Company[][] {
    const groups = new Map<string, Company[]>()
    for (const c of companies) {
      const key = `${c.jobBoard!.system}:${c.jobBoard!.board}`
      const group = groups.get(key)
      if (group) group.push(c)
      else groups.set(key, [c])
    }
    return [...groups.values()]
  }

  async function run(): Promise<void> {
    try {
      // Only companies read directly: status direct, with a board to read.
      const companies = listCompanies(db).filter((c) => c.status === 'direct' && c.jobBoard)
      const filters = loadFilters(db)
      // The pages read with Claude after them count in the progress too.
      const pages = pagesDue(now())
      state = {
        running: true,
        done: 0,
        total: companies.length + pages.length,
        current: [],
        lastSummary: null
      }
      deps.onProgress(snapshot())
      log(
        `job check started: ${companies.length} companies` +
          (pages.length > 0 ? `, ${pages.length} pages to read with Claude` : '')
      )

      const groups = byBoard(companies)
      let next = 0
      let failures = 0
      let error: Error | null = null
      const worker = async (): Promise<void> => {
        // After an error no new board starts; those already under way finish.
        while (next < groups.length && !stopped && error === null) {
          const group = groups[next++]
          const names = group.map((c) => c.name)
          try {
            update({ current: [...state.current, ...names] })
            try {
              const failed = await readBoard(group, filters)
              if (failed !== null) {
                if (failed) failures += group.length
                update({ done: state.done + group.length })
              }
            } finally {
              update({ current: state.current.filter((n) => !names.includes(n)) })
            }
          } catch (err) {
            error ??= err instanceof Error ? err : new Error(String(err))
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(parallel, groups.length) }, worker))
      if (error !== null) throw error
      if (!stopped) failures += await readPages(pages, filters)

      if (stopped) {
        log('job check stopped')
        update({ running: false, current: [], lastSummary: 'Stopped.' })
        return
      }
      const at = now()
      const open = storedJobs(db, at).filter((j) => j.closedAt === null).length
      const fit = fittingJobs(db, filters, at).filter((j) => j.closedAt === null).length
      // A check where every company failed (offline, say) is not today's check, so opening the app tries again.
      if (!(state.done > 0 && failures === state.done)) {
        setSetting(db, LAST_CHECK_KEY, at.toISOString())
        lastCheckAt = at.toISOString()
      }
      log('job check finished')
      update({
        running: false,
        current: [],
        lastSummary:
          `Checked ${state.total} companies: ${open} open jobs, ${fit} fit your filters.` +
          (failures > 0 ? ` ${failures} could not be read.` : '')
      })
    } catch (err) {
      // Not a company's failure (a database error, say): the run ends here and the screen is told why.
      // Nothing here may throw: start() never rejects, even when the log or the progress callback is what broke.
      const message = err instanceof Error ? err.message : String(err)
      state = {
        ...state,
        running: false,
        current: [],
        lastSummary: `Job check stopped: ${message}`
      }
      try {
        log(`job check failed: ${message}`)
      } catch {
        // nowhere left to report it
      }
      try {
        deps.onProgress(snapshot())
      } catch {
        // as above
      }
    }
  }

  return {
    start() {
      if (running) return running
      stopped = false
      running = run().finally(() => {
        running = null
      })
      return running
    },
    stop() {
      // Harmless when nothing runs: start() clears it.
      stopped = true
    },
    progress: snapshot
  }
}
