import { getText } from '../jobs/readers/http'
import { cellText, uniqueNamed } from './text'
import { notRecognised, type SponsorReader } from './types'

const PAGE = 'https://ind.nl/en/public-register-recognised-sponsors/public-register-work'
const HEAD = /<th[^>]*scope="col"[^>]*>\s*Organisation\s*<\/th>/i
const ROW = /<tr[^>]*>\s*<th[^>]*scope="row"[^>]*>([\s\S]*?)<\/th>/gi

export const nlReader: SponsorReader = {
  country: 'NL',
  async read(fetcher) {
    const html = await getText(fetcher, PAGE)
    if (!HEAD.test(html)) throw notRecognised(PAGE)
    const entries = uniqueNamed(
      [...html.matchAll(ROW)].map((m) => ({
        name: cellText(m[1]),
        detail: 'Recognised sponsor (work)'
      }))
    )
    if (entries.length === 0) throw notRecognised(PAGE)
    return { entries, source: PAGE }
  }
}
