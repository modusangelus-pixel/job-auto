import type { CheckResult, JobBoard } from '../../shared/types'
import { BlockedError, type FetchResult, type Fetcher } from '../readers/fetcher'
import { detectFromHtml, detectFromUrl } from './detect'

/** Why a SmartRecruiters company is blocked; migration 2 in db.ts writes the same text. */
export const SMARTRECRUITERS_BLOCKED =
  'SmartRecruiters does not allow automated reading of its job feed (robots.txt)'

/** What reading one page came to: the job system on it (if any), or why it could not be read. */
type Reading =
  | { ok: true; board: JobBoard | null }
  | { ok: false; status: 'blocked' | 'needs_claude'; error: string }

/** Fetches one page, a redirect followed once and never more, and looks at it for a job system. Never throws. */
async function readPage(fetcher: Fetcher, url: string): Promise<Reading> {
  let fetched: FetchResult | null
  try {
    fetched = await fetcher.get(url)
  } catch (err) {
    if (err instanceof BlockedError) return { ok: false, status: 'blocked', error: err.reason }
    return {
      ok: false,
      status: 'needs_claude',
      error: err instanceof Error ? err.message : String(err)
    }
  }
  if (fetched === null)
    return { ok: false, status: 'blocked', error: 'robots.txt does not allow reading this page' }
  if (fetched.status >= 400)
    return { ok: false, status: 'needs_claude', error: `HTTP ${fetched.status}` }
  return {
    ok: true,
    board: detectFromUrl(fetched.url) ?? detectFromHtml(fetched.body, fetched.url)
  }
}

/**
 * Decides a company's status from its careers and jobs links. A link already on a known job system is read
 * directly with no fetch; otherwise the jobs link (else the careers link) is fetched once and looked at for a job
 * system. When that page can't be read and a different careers link exists, the careers page is fetched and decides
 * instead, so a company is blocked only when the page actually used is. At most one fetch per link. Nothing here
 * throws: a failure becomes a status.
 */
export async function checkCareers(
  fetcher: Fetcher,
  careersUrl: string | null,
  jobsUrl: string | null,
  note: string | null
): Promise<CheckResult> {
  const result = (
    status: CheckResult['status'],
    jobBoard: CheckResult['jobBoard'] = null,
    error: string | null = null
  ): CheckResult => ({ careersUrl, jobsUrl, status, jobBoard, note, error })

  const board = (found: JobBoard): CheckResult =>
    found.system === 'smartrecruiters'
      ? result('blocked', found, SMARTRECRUITERS_BLOCKED)
      : result('direct', found)

  const page = jobsUrl ?? careersUrl
  if (page === null) return result('not_found')

  const known =
    (jobsUrl === null ? null : detectFromUrl(jobsUrl)) ??
    (careersUrl === null ? null : detectFromUrl(careersUrl))
  if (known) return board(known)

  let reading = await readPage(fetcher, page)
  // A jobs link that can't be read says nothing about the company's careers page, which may be fine.
  if (!reading.ok && jobsUrl !== null && careersUrl !== null && careersUrl !== jobsUrl)
    reading = await readPage(fetcher, careersUrl)

  if (!reading.ok) return result(reading.status, null, reading.error)
  return reading.board ? board(reading.board) : result('needs_claude')
}
