import type { SponsorCountry } from '../../shared/types'
import type { Db } from '../db/db'
import type { Fetcher } from '../readers/fetcher'
import { SPONSOR_READERS, type SponsorReader } from './index'
import { noteSponsorListFailed, saveSponsorList, sponsorLists } from './store'

const STALE_MS = 7 * 24 * 3600 * 1000

/** Fewer entries than this means the page was misread, not that the list shrank. */
const MINIMUM: Record<SponsorCountry, number> = { GB: 50000, NL: 5000, DK: 300, CA: 5000 }

export interface RefreshDeps {
  db: Db
  fetcher: Fetcher
  log: (line: string) => void
  readers?: SponsorReader[]
  now?: () => Date
  /** Read every list, not only the stale ones. */
  force?: boolean
}

let inFlight: Promise<void> | null = null

/**
 * Reads, one after another, each list that was never read or is older than a week (all of them when `force`).
 * A list is replaced only by a read that reaches its minimum; any failure keeps the old list. Never rejects.
 * A call while a refresh is running joins it, so the opening refresh and a forced one never download twice.
 */
export function refreshSponsorLists(deps: RefreshDeps): Promise<void> {
  if (inFlight === null) {
    inFlight = run(deps).finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

async function run(deps: RefreshDeps): Promise<void> {
  const { db, fetcher } = deps
  const log = (line: string): void => {
    try {
      deps.log(line)
    } catch {
      // A broken log must not stop the refresh.
    }
  }
  try {
    const readers = deps.readers ?? SPONSOR_READERS
    const now = deps.now ?? ((): Date => new Date())
    const infos = sponsorLists(db)
    for (const reader of readers) {
      const info = infos.find((i) => i.country === reader.country)
      const stale =
        info?.fetchedAt == null || now().getTime() - new Date(info.fetchedAt).getTime() > STALE_MS
      if (!deps.force && !stale) continue
      try {
        const { entries, source } = await reader.read(fetcher)
        const min = MINIMUM[reader.country]
        if (entries.length < min) {
          throw new Error(
            `Read ${entries.length} entries, expected at least ${min}; kept the previous list`
          )
        }
        saveSponsorList(db, reader.country, entries, source, now())
        log(`sponsor list ${reader.country}: ${entries.length} entries`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log(`sponsor list ${reader.country} failed: ${message}`)
        noteSponsorListFailed(db, reader.country, message)
      }
    }
  } catch (err) {
    log(`sponsor lists failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
