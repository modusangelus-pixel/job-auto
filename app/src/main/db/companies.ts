import type {
  CheckResult,
  Company,
  CompanyList,
  CompanyStatus,
  JobSystem,
  NewCompany
} from '../../shared/types'
import { sponsorMatches } from '../sponsors/store'
import type { Db } from './db'

interface CompanyRow {
  id: number
  name: string
  list: CompanyList
  focus: string
  hq: string
  priority: string | null
  application_status: string | null
  notes: string | null
  english_only: string | null
  visa_sponsorship: string | null
  careers_url: string | null
  jobs_url: string | null
  job_system: JobSystem | null
  board: string | null
  status: CompanyStatus
  note: string | null
  error: string | null
  checked_at: string | null
  read_at: string | null
  read_error: string | null
  open_jobs: number
}

// lookup_attempts is bookkeeping for the lookup, not part of a Company.
const COLUMNS = `id, name, list, focus, hq, priority, application_status, notes, english_only,
  visa_sponsorship, careers_url, jobs_url, job_system, board, status, note, error, checked_at,
  read_at, read_error,
  (SELECT COUNT(*) FROM jobs WHERE jobs.company_id = companies.id AND jobs.closed_at IS NULL) AS open_jobs`

const NO_ANSWER_NOTE = 'Claude gave no answer for this company'

function toCompany(db: Db, r: CompanyRow): Company {
  return {
    id: r.id,
    name: r.name,
    list: r.list,
    focus: r.focus,
    hq: r.hq,
    priority: r.priority,
    applicationStatus: r.application_status,
    notes: r.notes,
    englishOnly: r.english_only,
    visaSponsorship: r.visa_sponsorship,
    careersUrl: r.careers_url,
    jobsUrl: r.jobs_url,
    jobBoard: r.job_system === null ? null : { system: r.job_system, board: r.board ?? '' },
    status: r.status,
    note: r.note,
    error: r.error,
    checkedAt: r.checked_at,
    readAt: r.read_at,
    readError: r.read_error,
    openJobs: r.open_jobs,
    sponsors: sponsorMatches(db, r.id, r.name)
  }
}

/**
 * Adds companies in one transaction (a bad row adds nothing). Names are trimmed; blank ones are ignored.
 * `skipped` lists the names that were already there, whatever the case, including repeats within `rows`.
 */
export function addCompanies(db: Db, rows: NewCompany[]): { added: number; skipped: string[] } {
  // ON CONFLICT(name), not OR IGNORE: OR IGNORE would also swallow a CHECK failure such as an unknown list.
  const insert = db.prepare(
    `INSERT INTO companies (name, list, focus, hq, priority, application_status, notes, english_only,
       visa_sponsorship, careers_url)
     VALUES (@name, @list, @focus, @hq, @priority, @applicationStatus, @notes, @englishOnly,
       @visaSponsorship, @careersUrl)
     ON CONFLICT(name) DO NOTHING`
  )
  let added = 0
  const skipped: string[] = []
  db.transaction(() => {
    for (const row of rows) {
      const name = row.name.trim()
      if (name === '') continue
      const result = insert.run({
        name,
        list: row.list,
        focus: row.focus ?? '',
        hq: row.hq ?? '',
        priority: row.priority ?? null,
        applicationStatus: row.applicationStatus ?? null,
        notes: row.notes ?? null,
        englishOnly: row.englishOnly ?? null,
        visaSponsorship: row.visaSponsorship ?? null,
        careersUrl: row.careersUrl ?? null
      })
      if (result.changes > 0) added++
      else skipped.push(name)
    }
  })()
  return { added, skipped }
}

export function listCompanies(db: Db): Company[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM companies ORDER BY name COLLATE NOCASE`)
    .all() as CompanyRow[]
  return rows.map((r) => toCompany(db, r))
}

export function getCompany(db: Db, id: number): Company | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM companies WHERE id = ?`).get(id) as
    CompanyRow | undefined
  return row && toCompany(db, row)
}

/** Finds a company by name, ignoring case and surrounding spaces. */
export function findCompany(db: Db, name: string): Company | undefined {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM companies WHERE name = ? COLLATE NOCASE`)
    .get(name.trim()) as CompanyRow | undefined
  return row && toCompany(db, row)
}

export function moveCompany(db: Db, id: number, list: CompanyList): void {
  db.prepare('UPDATE companies SET list = ? WHERE id = ?').run(list, id)
}

export function removeCompany(db: Db, id: number): void {
  db.prepare('DELETE FROM companies WHERE id = ?').run(id)
}

/** Companies the lookup has not settled yet, in the order they were added. */
export function pendingCompanies(db: Db): Company[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM companies WHERE status = 'pending' ORDER BY id`)
    .all() as CompanyRow[]
  return rows.map((r) => toCompany(db, r))
}

/** Stores a lookup result. A result without a board clears any earlier one. */
export function saveCheck(db: Db, id: number, r: CheckResult): void {
  db.prepare(
    `UPDATE companies SET careers_url = @careersUrl, jobs_url = @jobsUrl, status = @status,
       job_system = @jobSystem, board = @board, note = @note, error = @error, checked_at = @checkedAt
     WHERE id = @id`
  ).run({
    id,
    careersUrl: r.careersUrl,
    jobsUrl: r.jobsUrl,
    status: r.status,
    jobSystem: r.jobBoard?.system ?? null,
    board: r.jobBoard?.board ?? null,
    note: r.note,
    error: r.error,
    checkedAt: new Date().toISOString()
  })
}

/** Counts a lookup that gave no answer; at `maxAttempts` the company is given up as not found. */
export function noteFailedLookup(db: Db, id: number, maxAttempts: number): void {
  // In an UPDATE every right-hand side reads the row as it was, so `lookup_attempts + 1` is the new count.
  db.prepare(
    `UPDATE companies SET
       lookup_attempts = lookup_attempts + 1,
       status = CASE WHEN lookup_attempts + 1 >= @maxAttempts THEN 'not_found' ELSE status END,
       note = CASE WHEN lookup_attempts + 1 >= @maxAttempts THEN @note ELSE note END
     WHERE id = @id`
  ).run({ id, maxAttempts, note: NO_ANSWER_NOTE })
}

/** Puts a company back to not checked: everything the lookup stored goes, the owner's fields stay. */
export function resetCompany(db: Db, id: number): void {
  db.prepare(
    `UPDATE companies SET status = 'pending', careers_url = NULL, jobs_url = NULL, job_system = NULL,
       board = NULL, note = NULL, error = NULL, checked_at = NULL, lookup_attempts = 0
     WHERE id = ?`
  ).run(id)
}

/** How many companies are in each status; every status is present, zeros included. */
export function statusCounts(db: Db): Record<CompanyStatus, number> {
  const counts: Record<CompanyStatus, number> = {
    pending: 0,
    direct: 0,
    needs_claude: 0,
    blocked: 0,
    not_found: 0
  }
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM companies GROUP BY status').all() as {
    status: CompanyStatus
    n: number
  }[]
  for (const r of rows) counts[r.status] = r.n
  return counts
}
