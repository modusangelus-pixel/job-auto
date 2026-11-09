import type {
  CompanyList,
  Employment,
  FilterSettings,
  Job,
  JobStatus,
  RawJob,
  SponsorMatch
} from '../../shared/types'
import { sponsorMatches } from '../sponsors/store'
import { rulesFor } from '../jobs/filters'
import { placesOf } from '../geo/place'
import type { Db } from './db'

const NEW_FOR_MS = 7 * 24 * 3600 * 1000

interface JobRow {
  id: number
  company_id: number
  company: string
  list: CompanyList
  title: string
  location: string
  countries: string
  employment: Employment
  url: string
  posted_at: string | null
  posted_rough: number
  first_seen: string
  last_seen: string
  closed_at: string | null
  baseline: number
  status: JobStatus | null
  notes: string
}

const splitCountries = (s: string): string[] => (s === '' ? [] : s.split(','))

/**
 * Stores one read of a company's board in one transaction. `board` is `${system}:${board}`.
 * The first read of a board is the baseline: nothing found then is New. Jobs are closed only when the
 * read is complete and the board is the one read last time.
 */
export function saveRead(
  db: Db,
  companyId: number,
  board: string,
  jobs: RawJob[],
  complete: boolean,
  now: Date
): { added: number; closed: number } {
  const stamp = now.toISOString()
  return db.transaction(() => {
    const before = db
      .prepare('SELECT read_board FROM companies WHERE id = ?')
      .pluck()
      .get(companyId) as string | null | undefined
    const sameBoard = before === board
    const find = db.prepare(
      'SELECT id, details_read FROM jobs WHERE company_id = ? AND source_id = ?'
    )
    const insert = db.prepare(
      `INSERT INTO jobs (company_id, source_id, title, location, countries, employment, url, posted_at,
         posted_rough, details_read, first_seen, last_seen, baseline)
       VALUES (@companyId, @sourceId, @title, @location, @countries, @employment, @url, @postedAt,
         @postedRough, @detailsRead, @now, @now, @baseline)`
    )
    const update = db.prepare(
      `UPDATE jobs SET title = @title, location = @location, url = @url, last_seen = @now, closed_at = NULL,
         posted_rough = CASE WHEN @keepDetails THEN posted_rough ELSE @postedRough END,
         countries = CASE WHEN @keepDetails THEN countries ELSE @countries END,
         employment = CASE WHEN @keepDetails THEN employment ELSE @employment END,
         posted_at = CASE WHEN @keepDetails THEN posted_at ELSE @postedAt END,
         details_read = CASE WHEN @needsDetails THEN details_read ELSE 1 END
       WHERE id = @id`
    )
    let added = 0
    const seen = new Set<number>()
    for (const job of jobs) {
      const fields = {
        title: job.title,
        location: job.location,
        url: job.url,
        countries: job.countries.join(','),
        employment: job.employment,
        postedAt: job.postedAt,
        postedRough: job.postedRough ? 1 : 0,
        now: stamp
      }
      const existing = find.get(companyId, job.sourceId) as
        { id: number; details_read: number } | undefined
      if (existing) {
        update.run({
          ...fields,
          id: existing.id,
          keepDetails: existing.details_read === 1 && job.needsDetails ? 1 : 0,
          needsDetails: job.needsDetails ? 1 : 0
        })
        seen.add(existing.id)
      } else {
        const r = insert.run({
          ...fields,
          companyId,
          sourceId: job.sourceId,
          detailsRead: job.needsDetails ? 0 : 1,
          baseline: sameBoard ? 0 : 1
        })
        seen.add(Number(r.lastInsertRowid))
        added++
      }
    }
    let closed = 0
    if (complete && sameBoard) {
      const open = db
        .prepare('SELECT id FROM jobs WHERE company_id = ? AND closed_at IS NULL')
        .pluck()
        .all(companyId) as number[]
      const close = db.prepare('UPDATE jobs SET closed_at = ? WHERE id = ?')
      for (const id of open) {
        if (seen.has(id)) continue
        close.run(stamp, id)
        closed++
      }
    }
    db.prepare(
      'UPDATE companies SET read_at = ?, read_board = ?, read_error = NULL WHERE id = ?'
    ).run(stamp, board, companyId)
    return { added, closed }
  })()
}

/**
 * Records a failed read. Jobs are left alone; `blocked` also marks the company blocked with that error.
 * read_at stays the time of the last good read, so `now` is not used.
 */
export function noteReadFailed(
  db: Db,
  companyId: number,
  error: string,
  blocked: boolean,
  now: Date
): void {
  void now
  if (blocked) {
    db.prepare(
      "UPDATE companies SET read_error = ?, status = 'blocked', error = ? WHERE id = ?"
    ).run(error, error, companyId)
  } else {
    db.prepare('UPDATE companies SET read_error = ? WHERE id = ?').run(error, companyId)
  }
}

/** What an earlier read of the job's own page found, for jobs whose list lacks it. */
export function knownDetails(
  db: Db,
  companyId: number
): Map<string, Pick<RawJob, 'countries' | 'employment' | 'postedAt'>> {
  const rows = db
    .prepare(
      `SELECT source_id, countries, employment, posted_at FROM jobs
       WHERE company_id = ? AND details_read = 1`
    )
    .all(companyId) as {
    source_id: string
    countries: string
    employment: Employment
    posted_at: string | null
  }[]
  return new Map(
    rows.map((r) => [
      r.source_id,
      { countries: splitCountries(r.countries), employment: r.employment, postedAt: r.posted_at }
    ])
  )
}

/** Open jobs, and closed ones the owner has set a status on. The rule fields are filled later. */
export function storedJobs(db: Db, now: Date): Job[] {
  const rows = db
    .prepare(
      `SELECT j.id, j.company_id, c.name AS company, c.list, j.title, j.location, j.countries, j.employment,
         j.url, j.posted_at, j.posted_rough, j.first_seen, j.last_seen, j.closed_at, j.baseline, j.status,
         j.notes
       FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.closed_at IS NULL OR j.status IS NOT NULL
       ORDER BY j.id`
    )
    .all() as JobRow[]
  // The matches belong to the company: worked out once per company, not once per job.
  const sponsors = new Map<number, SponsorMatch[]>()
  const sponsorsOf = (id: number, name: string): SponsorMatch[] => {
    let m = sponsors.get(id)
    if (m === undefined) {
      m = sponsorMatches(db, id, name)
      sponsors.set(id, m)
    }
    return m
  }
  return rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    company: r.company,
    list: r.list,
    title: r.title,
    location: r.location,
    countries: splitCountries(r.countries),
    employment: r.employment,
    url: r.url,
    postedAt: r.posted_at,
    postedRough: r.posted_rough === 1,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    closedAt: r.closed_at,
    isNew:
      r.baseline === 0 &&
      r.status === null &&
      now.getTime() - new Date(r.first_seen).getTime() < NEW_FOR_MS,
    status: r.status,
    notes: r.notes,
    regionGroups: [],
    locationUnclear: false,
    places: placesOf(r.location, splitCountries(r.countries)),
    sponsors: sponsorsOf(r.company_id, r.company)
  }))
}

/** The stored jobs that pass the rule filters, with regionGroups and locationUnclear filled. */
export function fittingJobs(db: Db, f: FilterSettings, now: Date): Job[] {
  const rules = rulesFor(f)
  const out: Job[] = []
  for (const job of storedJobs(db, now)) {
    const r = rules.apply(job)
    if (r.fits)
      out.push({ ...job, regionGroups: r.regionGroups, locationUnclear: r.locationUnclear })
  }
  return out
}

export function setJobStatus(db: Db, id: number, status: JobStatus | null): void {
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id)
}

export function setJobNotes(db: Db, id: number, notes: string): void {
  db.prepare('UPDATE jobs SET notes = ? WHERE id = ?').run(notes, id)
}
