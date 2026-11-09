// The careers lookup: decide each pending company's status, asking Claude for the links of those without one.
// Nothing here may import 'electron': the app and the live check share makeRunBatch.
import { mkdirSync } from 'node:fs'
import type { Company, CompanyList, LookupProgress } from '../../shared/types'
import {
  addCompanies,
  findCompany,
  getCompany,
  noteFailedLookup,
  pendingCompanies,
  saveCheck
} from '../db/companies'
import type { Db } from '../db/db'
import type { Fetcher } from '../readers/fetcher'
import { checkCareers } from './check'
import { lookupArgs, lookupPrompt, parseLookupResult, runClaude, type LookupAnswer } from './claude'
import { isJobBoardSite } from './detect'

export interface BatchOutcome {
  ok: boolean
  answers: LookupAnswer[]
  summary: string
}

function isWebAddress(text: string): boolean {
  try {
    const { protocol } = new URL(text)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * What the owner typed or pasted as a link, made ready to check: an address with no scheme, like acme.com/careers,
 * gets https:// in front; anything else (a mailto: link, plain words, a path) is only trimmed.
 */
export function normalizeLink(input: string): string {
  const text = input.trim()
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text)
  const looksLikeAddress = text.includes('.') && !/\s/.test(text) && !text.startsWith('/')
  return !hasScheme && looksLikeAddress ? `https://${text}` : text
}

/** Why a (normalised) link can't be a company's careers link, in words for the owner; null when it can. */
export function linkProblem(url: string): string | null {
  if (!isWebAddress(url)) return 'Paste a link that starts with http:// or https://'
  if (isJobBoardSite(url)) return "Use the company's own careers page, not a job board"
  return null
}

/** Checks a link the owner pasted and stores the result, whatever the company's status. Throws a message for the screen. */
export async function checkLink(
  db: Db,
  fetcher: Fetcher,
  id: number,
  url: string
): Promise<Company> {
  const link = normalizeLink(url)
  const problem = linkProblem(link)
  if (problem !== null) throw new Error(problem)
  saveCheck(db, id, await checkCareers(fetcher, link, link, 'Link added by you'))
  const company = getCompany(db, id)
  if (!company) throw new Error('That company is no longer in the list')
  return company
}

/**
 * Adds a company the owner typed in and, when they gave a link, checks it. Everything that can be refused is
 * refused before anything is added, so a refused company or link leaves the list as it was. Throws a message for
 * the screen.
 */
export async function addCompany(
  db: Db,
  fetcher: Fetcher,
  name: string,
  list: CompanyList,
  careersUrl: string | null
): Promise<Company> {
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('Type a company name.')
  const existing = findCompany(db, trimmed)
  if (existing) throw new Error(`${existing.name} is already in the app.`)
  const link = careersUrl?.trim()
  const problem = link ? linkProblem(normalizeLink(link)) : null
  if (problem !== null) throw new Error(problem)
  addCompanies(db, [{ name: trimmed, list }])
  const company = findCompany(db, trimmed)
  if (!company) throw new Error('The company could not be added.')
  return link ? checkLink(db, fetcher, company.id, link) : company
}

export interface LookupDeps {
  db: Db
  fetcher: Fetcher
  runBatch(companies: Company[], signal: AbortSignal): Promise<BatchOutcome>
  log(line: string): void
  onProgress(p: LookupProgress): void
  batchSize?: number
  maxAttempts?: number
  /** How many batches are with Claude at once. */
  parallel?: number
}

export interface Lookup {
  /** Runs until no company is pending, a batch fails, or stop(); a start while running joins the run. Never rejects. */
  start(): Promise<void>
  stop(): void
  progress(): LookupProgress
  /** What Claude is doing right now; shown until the batch ends. */
  step(text: string): void
}

/** A company's outcome as one log line: `Name: status (system board), error`. */
function describeOutcome(c: Company): string {
  const board = c.jobBoard ? ` (${c.jobBoard.system} ${c.jobBoard.board})` : ''
  return `${c.name}: ${c.status}${board}${c.error ? `, ${c.error}` : ''}`
}

// A job board link is not a company's own page, so a company holding one is looked up like one without a link.
const hasOwnLink = (c: Company): boolean => c.careersUrl !== null && !isJobBoardSite(c.careersUrl)

export function createLookup(deps: LookupDeps): Lookup {
  const { db, fetcher, log } = deps
  const batchSize = deps.batchSize ?? 5
  const maxAttempts = deps.maxAttempts ?? 2
  const parallel = deps.parallel ?? 3
  let progress: LookupProgress = {
    running: false,
    done: 0,
    total: 0,
    current: [],
    step: null,
    lastSummary: null
  }
  let controller: AbortController | null = null
  let running: Promise<void> | null = null

  const snapshot = (): LookupProgress => ({ ...progress, current: [...progress.current] })
  function update(change: Partial<LookupProgress>): void {
    progress = { ...progress, ...change }
    deps.onProgress(snapshot())
  }

  // The owner can settle a company by hand while the lookup is busy; that result is left alone. A company that
  // has left pending counts as done, whoever settled it.
  function settle(c: Company, apply: () => void): void {
    const wasPending = getCompany(db, c.id)?.status === 'pending'
    if (wasPending) apply()
    const after = getCompany(db, c.id)
    if (!after || after.status === 'pending') return
    if (wasPending) log(describeOutcome(after))
    update({ done: progress.done + 1 })
  }

  // Once stop() is called nothing more is saved, even a check already under way.
  async function checkAndSave(
    c: Company,
    careersUrl: string | null,
    jobsUrl: string | null,
    note: string | null,
    signal: AbortSignal
  ): Promise<void> {
    const result = await checkCareers(fetcher, careersUrl, jobsUrl, note)
    if (!signal.aborted) settle(c, () => saveCheck(db, c.id, result))
  }

  async function attempt(batch: Company[], signal: AbortSignal): Promise<BatchOutcome> {
    try {
      return await deps.runBatch(batch, signal)
    } catch (err) {
      return { ok: false, answers: [], summary: err instanceof Error ? err.message : String(err) }
    }
  }

  /** One batch with Claude, its answers saved; returns the batch's failure summary, else null. */
  async function askOne(batch: Company[], signal: AbortSignal): Promise<string | null> {
    const names = batch.map((c) => c.name)
    update({ current: [...progress.current, ...names] })
    try {
      const outcome = await attempt(batch, signal)
      if (progress.step !== null) update({ step: null })
      if (signal.aborted) return null
      if (!outcome.ok) {
        log(`lookup batch failed (${names.join(', ')}): ${outcome.summary}`)
        return `${outcome.summary} (batch: ${names.join(', ')})`
      }
      const answers = new Map(outcome.answers.map((a) => [a.id, a]))
      for (const c of batch) {
        if (signal.aborted) return null
        const a = answers.get(c.id)
        if (a) await checkAndSave(c, a.careersUrl, a.jobsUrl, a.note || null, signal)
        else settle(c, () => noteFailedLookup(db, c.id, maxAttempts))
      }
      return null
    } finally {
      update({ current: progress.current.filter((n) => !names.includes(n)) })
    }
  }

  /**
   * Hands the batches to Claude, `parallel` at a time. After a failed batch or an error no new batch starts, and
   * those already with Claude finish and are saved. Returns the first failed batch's summary, else null.
   */
  async function askClaude(batches: Company[][], signal: AbortSignal): Promise<string | null> {
    let next = 0
    let failure: string | null = null
    let error: Error | null = null
    const worker = async (): Promise<void> => {
      while (next < batches.length && failure === null && error === null && !signal.aborted) {
        try {
          const result = await askOne(batches[next++], signal)
          if (failure === null) failure = result
        } catch (err) {
          error ??= err instanceof Error ? err : new Error(String(err))
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(parallel, batches.length) }, worker))
    if (error !== null) throw error
    return failure
  }

  /** Works through what is pending, pass after pass; returns the summary of a failed batch, else null. */
  async function work(first: Company[], signal: AbortSignal): Promise<string | null> {
    // Each pass either settles a company or counts a miss against it, so the passes always end.
    for (
      let pending = first;
      pending.length > 0 && !signal.aborted;
      pending = pendingCompanies(db)
    ) {
      for (const c of pending.filter(hasOwnLink)) {
        if (signal.aborted) return null
        await checkAndSave(c, c.careersUrl, c.jobsUrl, null, signal)
      }
      const unlinked = pending.filter((c) => !hasOwnLink(c))
      const batches: Company[][] = []
      for (let i = 0; i < unlinked.length; i += batchSize)
        batches.push(unlinked.slice(i, i + batchSize))
      const failure = await askClaude(batches, signal)
      if (failure !== null) return failure
    }
    return null
  }

  async function run(signal: AbortSignal): Promise<void> {
    try {
      const pending = pendingCompanies(db)
      progress = {
        running: true,
        done: 0,
        total: pending.length,
        current: [],
        step: null,
        lastSummary: null
      }
      deps.onProgress(snapshot())
      log(`lookup started: ${pending.length} companies`)

      const failure = await work(pending, signal)
      let lastSummary: string | null = null
      if (signal.aborted) {
        log('lookup stopped')
        lastSummary = 'Stopped.'
      } else if (failure !== null) {
        lastSummary = failure
      } else {
        log('lookup finished')
      }
      update({ running: false, current: [], step: null, lastSummary })
    } catch (err) {
      // Not a batch outcome (a database error, say): the run ends here, and the screen is told why rather than
      // being left showing a lookup that is no longer running.
      const message = err instanceof Error ? err.message : String(err)
      log(`lookup failed: ${message}`)
      update({ running: false, current: [], step: null, lastSummary: `Lookup stopped: ${message}` })
    }
  }

  return {
    start() {
      if (running) return running
      const own = new AbortController()
      controller = own
      running = run(own.signal).finally(() => {
        running = null
        controller = null
      })
      return running
    },
    stop() {
      controller?.abort()
    },
    progress: snapshot,
    step(text) {
      update({ step: text })
    }
  }
}

/** The real runBatch: one headless Claude run for a batch of companies. */
export function makeRunBatch(opts: {
  findClaudePath(): string | null
  cwd: string
  timeoutMs: number
  onStep(step: string): void
}): (companies: Company[], signal: AbortSignal) => Promise<BatchOutcome> {
  return async (companies, signal) => {
    if (signal.aborted) return { ok: false, answers: [], summary: 'Stopped.' }
    const claudePath = opts.findClaudePath()
    if (claudePath === null)
      return { ok: false, answers: [], summary: 'Claude Code was not found on this computer.' }
    mkdirSync(opts.cwd, { recursive: true })
    const run = runClaude({
      claudePath,
      args: lookupArgs(),
      prompt: lookupPrompt(companies),
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      onStep: opts.onStep
    })
    const stop = (): void => run.stop()
    signal.addEventListener('abort', stop, { once: true })
    try {
      const done = await run.done
      return {
        ok: done.ok,
        answers: done.ok
          ? parseLookupResult(
              done.text,
              companies.map((c) => c.id)
            )
          : [],
        summary: done.text
      }
    } finally {
      signal.removeEventListener('abort', stop)
    }
  }
}
