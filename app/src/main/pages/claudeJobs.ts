// Reading a captured careers page with Claude: the request, Claude's answer as jobs, and the board a page read is
// saved under. Nothing here may import 'electron'.
import { mkdirSync } from 'node:fs'
import { foldText } from '../../shared/fold'
import type { Company, RawJob } from '../../shared/types'
import { firstJsonArray, pageArgs, runClaude } from '../careers/claude'
import { isJobBoardSite } from '../careers/detect'
import { countriesIn } from '../jobs/location'
import { employmentFrom } from '../jobs/readers/employment'
import type { CapturedPage } from './types'

/** The page a company's jobs are read from: its jobs link, else its careers link; never a job board site. */
export function pageUrlOf(c: Pick<Company, 'jobsUrl' | 'careersUrl'>): string | null {
  for (const url of [c.jobsUrl, c.careersUrl]) {
    if (url && url.trim() !== '' && !isJobBoardSite(url)) return url.trim()
  }
  return null
}

/**
 * The board a page read is saved under: `page:` + the page's host and path. A query or fragment (tracking,
 * sessions) would otherwise make each weekly read a new board, so every job would start over as not new.
 */
export function pageBoard(finalUrl: string): string {
  try {
    const u = new URL(finalUrl)
    return `page:${u.host}${u.pathname}`
  } catch {
    return `page:${finalUrl}`
  }
}

/** The request: the company, the page's address, its text, then its links one per line as `text — address`. */
export function pagePrompt(company: Pick<Company, 'name'>, page: CapturedPage): string {
  return [
    `Company: ${company.name}`,
    `Page: ${page.finalUrl}`,
    '',
    'Text:',
    page.text,
    '',
    'Links:',
    ...page.links.map((l) => `${l.text} — ${l.href}`)
  ].join('\n')
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** An http(s) address, made absolute against the page; null for anything else. */
function linkOf(value: unknown, pageUrl: string): string | null {
  const raw = text(value)
  if (raw === '') return null
  try {
    const u = new URL(raw, pageUrl)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * Claude's answer as jobs; null when it holds no JSON array. A job is known by its own link, else by its folded
 * title and location; rows without a title are dropped and repeats are merged (the first stays).
 */
export function parsePageJobs(answer: string, pageUrl: string): RawJob[] | null {
  const items = firstJsonArray(answer)
  if (items === null) return null
  const byId = new Map<string, RawJob>()
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    const title = text(row.title)
    if (title === '') continue
    const location = text(row.location)
    const link = linkOf(row.url, pageUrl)
    const sourceId = link ?? `t:${foldText(title)}|${foldText(location)}`
    if (byId.has(sourceId)) continue
    byId.set(sourceId, {
      sourceId,
      title,
      location,
      countries: countriesIn(location),
      employment: employmentFrom(title),
      url: link ?? pageUrl,
      postedAt: null,
      postedRough: false,
      needsDetails: false
    })
  }
  return [...byId.values()]
}

/** One headless Claude run on a page request, in Claude's own empty folder; ok false with the reason when it failed. */
export function makeAskClaude(opts: {
  cwd: string
  timeoutMs: number
}): (claudePath: string, prompt: string) => Promise<{ ok: boolean; text: string }> {
  return async (claudePath, prompt) => {
    mkdirSync(opts.cwd, { recursive: true })
    return runClaude({
      claudePath,
      args: pageArgs(),
      prompt,
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      onStep: () => {}
    }).done
  }
}
