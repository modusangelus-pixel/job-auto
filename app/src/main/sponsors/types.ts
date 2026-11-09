import type { SponsorCountry } from '../../shared/types'
import type { Fetcher } from '../readers/fetcher'

export interface SponsorEntry {
  name: string
  detail: string
}

export interface SponsorReader {
  country: SponsorCountry
  /** Downloads the country's list; `source` is the page the list was read from. */
  read(fetcher: Fetcher): Promise<{ entries: SponsorEntry[]; source: string }>
}

export function notRecognised(url: string): Error {
  return new Error(`Sponsor list not recognised on ${url}`)
}
