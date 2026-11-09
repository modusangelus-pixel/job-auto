// Live check of the four sponsor-list readers on the real sites, with the app's own fetcher (its User-Agent,
// robots.txt, 1.5 s between requests to a host, 20 s for open.canada.ca). Each list is read once. It only runs when
// asked (JOB_AUTO_LIVE=1), so `npm test` skips it. It writes nothing.
//
//   JOB_AUTO_LIVE=1 npx vitest run tests/live/sponsors.live.test.ts
import { expect, test } from 'vitest'
import { createFetcher } from '../../src/main/readers/fetcher'
import { SPONSOR_READERS } from '../../src/main/sponsors'
import { cleanName } from '../../src/main/sponsors/match'
import type { SponsorCountry } from '../../src/shared/types'

const LIVE = process.env.JOB_AUTO_LIVE === '1'
const TEN_MINUTES = 10 * 60_000

// The fewest entries each list must give; fewer means the page was misread.
const MINIMUM: Record<SponsorCountry, number> = { GB: 50000, NL: 5000, DK: 300, CA: 5000 }

test.skipIf(!LIVE).each(SPONSOR_READERS.map((reader) => [reader.country, reader] as const))(
  'the %s sponsor list is read',
  async (country, reader) => {
    const { entries } = await reader.read(createFetcher())
    expect(entries.length).toBeGreaterThanOrEqual(MINIMUM[country])
    for (const entry of entries) expect(entry.name.trim()).not.toBe('')
    if (country === 'GB') expect(entries.some((e) => cleanName(e.name) === 'abb')).toBe(true)
  },
  TEN_MINUTES
)
