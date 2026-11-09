import { getText } from '../jobs/readers/http'
import { decode } from '../jobs/readers/util'
import { parseCsv } from './csv'
import { notRecognised, type SponsorEntry, type SponsorReader } from './types'

const PAGE = 'https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers'
const CSV_LINK =
  /href="(https:\/\/assets\.publishing\.service\.gov\.uk\/[^"]*Worker_and_Temporary_Worker[^"]*\.csv)"/i
const HEADER = ['Organisation Name', 'Town/City', 'County', 'Type & Rating', 'Route']
const CSV_TIMEOUT_MS = 180_000

interface Acc {
  routes: string[]
  ratings: string[]
  town: string
}

function add(list: string[], value: string): void {
  if (value !== '' && !list.includes(value)) list.push(value)
}

export const ukReader: SponsorReader = {
  country: 'GB',
  async read(fetcher) {
    const page = await getText(fetcher, PAGE)
    const link = CSV_LINK.exec(page)?.[1]
    if (!link) throw notRecognised(PAGE)
    const url = decode(link)
    const rows = parseCsv(await getText(fetcher, url, { timeoutMs: CSV_TIMEOUT_MS }))
    if (!rows[0] || HEADER.some((h, i) => rows[0][i]?.trim() !== h)) throw notRecognised(url)

    const byName = new Map<string, Acc>()
    for (const row of rows.slice(1)) {
      const name = row[0]?.trim() ?? ''
      if (name === '') continue
      let acc = byName.get(name)
      if (!acc) {
        acc = { routes: [], ratings: [], town: row[1]?.trim() ?? '' }
        byName.set(name, acc)
      }
      add(acc.routes, row[4]?.trim() ?? '')
      add(acc.ratings, /\(([^)]*\brating)\)/i.exec(row[3] ?? '')?.[1].trim() ?? '')
    }
    const entries: SponsorEntry[] = [...byName].map(([name, a]) => ({
      name,
      detail: [a.routes.join(', '), a.ratings.join(', '), a.town]
        .filter((p) => p !== '')
        .join(' · ')
    }))
    return { entries, source: PAGE }
  }
}
