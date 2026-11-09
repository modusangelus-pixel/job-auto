import { getText } from '../jobs/readers/http'
import { cellText, uniqueNamed } from './text'
import { notRecognised, type SponsorEntry, type SponsorReader } from './types'

const PAGE = 'https://www.nyidanmark.dk/en-GB/Words-and-concepts/SIRI/Certified-companies'

/** The first cell of each row of the table whose first row starts with "Name of company". */
function companyNames(html: string): string[] | null {
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const cells = (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map(
      (tr) => /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/i.exec(tr)?.[1] ?? ''
    )
    if (cells.length > 0 && /^name of company$/i.test(cellText(cells[0]))) {
      return cells.slice(1).map(cellText)
    }
  }
  return null
}

export const dkReader: SponsorReader = {
  country: 'DK',
  async read(fetcher) {
    const names = companyNames(await getText(fetcher, PAGE))
    if (names === null) throw notRecognised(PAGE)
    const entries: SponsorEntry[] = uniqueNamed(
      names.map((name) => ({ name, detail: 'Fast-track certified' }))
    )
    return { entries, source: PAGE }
  }
}
