import type { SponsorCountry, SponsorListInfo, SponsorMatch } from '../../shared/types'
import type { Db } from '../db/db'
import { cleanName, matchesCompany } from './match'
import type { SponsorEntry } from './types'

const COUNTRIES: SponsorCountry[] = ['GB', 'NL', 'DK', 'CA']

/** Replaces a country's entries with a fresh read, in one transaction. */
export function saveSponsorList(
  db: Db,
  country: SponsorCountry,
  entries: SponsorEntry[],
  source: string,
  now: Date
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM sponsor_entries WHERE country = ?').run(country)
    const insert = db.prepare(
      'INSERT INTO sponsor_entries (country, name, norm, detail) VALUES (?, ?, ?, ?)'
    )
    for (const e of entries) insert.run(country, e.name, cleanName(e.name), e.detail)
    db.prepare(
      `INSERT INTO sponsor_lists (country, fetched_at, source, entries, error)
       VALUES (@country, @fetchedAt, @source, @entries, NULL)
       ON CONFLICT(country) DO UPDATE SET fetched_at = @fetchedAt, source = @source, entries = @entries,
         error = NULL`
    ).run({ country, fetchedAt: now.toISOString(), source, entries: entries.length })
  })()
}

/** Records why a read failed. The stored entries and their date stay. */
export function noteSponsorListFailed(db: Db, country: SponsorCountry, error: string): void {
  db.prepare(
    `INSERT INTO sponsor_lists (country, error) VALUES (@country, @error)
     ON CONFLICT(country) DO UPDATE SET error = @error`
  ).run({ country, error })
}

/** One row per country; a list never fetched has zero entries and no date. */
export function sponsorLists(db: Db): SponsorListInfo[] {
  const rows = db
    .prepare('SELECT country, fetched_at, entries, error FROM sponsor_lists')
    .all() as {
    country: SponsorCountry
    fetched_at: string | null
    entries: number
    error: string | null
  }[]
  return COUNTRIES.map((country) => {
    const r = rows.find((x) => x.country === country)
    return {
      country,
      fetchedAt: r?.fetched_at ?? null,
      entries: r?.entries ?? 0,
      error: r?.error ?? null
    }
  })
}

// SQLite's LIKE ignores case, so it alone cannot use the BINARY index on norm. The range can: cleaned names hold
// no character below '!' except the space, so [norm, norm + '!') is exactly "norm, or norm and a space after it".
// A reject holds the cleaned name, so every spelling of a rejected name stays hidden.
export const SPONSOR_MATCH_SQL = `SELECT country, name, norm, detail FROM sponsor_entries
  WHERE norm LIKE ? || '%' AND norm >= ? AND norm < ?
    AND NOT EXISTS (
      SELECT 1 FROM sponsor_rejects r
      WHERE r.company_id = ? AND r.country = sponsor_entries.country AND r.name = sponsor_entries.norm)
  ORDER BY country, name`

/** The list entries that are this company, minus the ones the owner rejected. */
export function sponsorMatches(db: Db, companyId: number, companyName: string): SponsorMatch[] {
  const norm = cleanName(companyName)
  if (norm.length < 3) return []
  const rows = db
    .prepare(SPONSOR_MATCH_SQL)
    .all(norm, norm, norm + '!', companyId) as (SponsorMatch & { norm: string })[]
  return rows
    .filter((r) => matchesCompany(r.norm, norm))
    .map((r) => ({ country: r.country, name: r.name, detail: r.detail }))
}

/**
 * Hides a wrong match for this company, by its cleaned name: it stays hidden when the list is read again, also when
 * the list spells it differently then (ABB LIMITED, Abb Limited).
 */
export function rejectSponsor(
  db: Db,
  companyId: number,
  country: SponsorCountry,
  name: string
): void {
  db.prepare(
    'INSERT OR IGNORE INTO sponsor_rejects (company_id, country, name) VALUES (?, ?, ?)'
  ).run(companyId, country, cleanName(name))
}
