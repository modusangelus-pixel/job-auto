import type { Job, SponsorCountry } from './types'

export const WORK_RIGHT_GROUPS: { label: string; countries: string[] }[] = [
  {
    label: 'EU/EEA and Switzerland',
    countries:
      'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH'.split(
        ' '
      )
  },
  { label: 'UK', countries: ['GB'] },
  { label: 'USA', countries: ['US'] },
  { label: 'Canada', countries: ['CA'] },
  { label: 'Australia', countries: ['AU'] },
  { label: 'New Zealand', countries: ['NZ'] },
  { label: 'Turkey', countries: ['TR'] }
]

export const SPONSOR_LIST_LABEL: Record<SponsorCountry, string> = {
  GB: 'UK',
  NL: 'Netherlands',
  DK: 'Denmark',
  CA: 'Canada'
}

interface CountryLine {
  text: string
  link: string | null
}

const LINES: Record<string, CountryLine> = {
  SE: {
    text: 'Sweden publishes no sponsor list. After a job offer the employer starts your work permit with the Migration Agency.',
    link: 'https://www.migrationsverket.se'
  },
  NO: {
    text: 'Norway publishes no sponsor list. Skilled workers get a residence permit after a job offer.',
    link: 'https://www.udi.no'
  },
  FI: {
    text: 'Finland publishes no sponsor list. Specialists and workers get a residence permit after a job offer.',
    link: 'https://migri.fi'
  },
  DE: {
    text: 'Germany needs no sponsor licence: an EU Blue Card or a skilled-worker visa follows a job offer.',
    link: 'https://www.make-it-in-germany.com'
  },
  CH: {
    text: 'Switzerland publishes no sponsor list. Hires from outside the EU need a permit within yearly quotas.',
    link: 'https://www.sem.admin.ch'
  },
  IE: {
    text: "Ireland's permits-by-company list can't be read automatically. Most hires use a Critical Skills or General Employment Permit.",
    link: 'https://enterprise.gov.ie'
  },
  US: {
    text: "The USA's H-1B employer data can't be read automatically. Most hires need an H-1B visa, drawn by lottery each spring.",
    link: 'https://www.uscis.gov'
  },
  AU: {
    text: 'Australia publishes no sponsor list. Employers sponsor skilled workers on the Skills in Demand visa.',
    link: 'https://immi.homeaffairs.gov.au'
  },
  NZ: {
    text: 'New Zealand only offers a search: check that the employer is accredited for the Accredited Employer Work Visa.',
    link: 'https://www.immigration.govt.nz'
  },
  TR: {
    text: 'Turkey publishes no sponsor list. The employer applies for your work permit.',
    link: 'https://www.csgb.gov.tr'
  }
}

const OTHER_EU: CountryLine = {
  text: 'No public sponsor list. Employers hire from outside the EU on an EU Blue Card or a national work permit.',
  link: 'https://immigration-portal.ec.europa.eu'
}

const OTHER_EU_COUNTRIES = new Set(
  WORK_RIGHT_GROUPS[0].countries.filter((c) => !(c in LINES) && !isSponsorCountry(c))
)

function isSponsorCountry(code: string): code is SponsorCountry {
  return code in SPONSOR_LIST_LABEL
}

/** The note about hiring from abroad in a country, or null where the app reads a sponsor list. */
export function countryLine(code: string, countryName: string): CountryLine | null {
  if (isSponsorCountry(code)) return null
  const own = LINES[code]
  if (own) return own
  if (OTHER_EU_COUNTRIES.has(code)) return OTHER_EU
  return { text: `${countryName} publishes no sponsor list the app can read.`, link: null }
}

/**
 * A short visa tag for a job row, or null when there is nothing to say. Only lists that have been read
 * (`readLists`) can speak: before its first read a list says nothing rather than "No match".
 */
export function visaTag(
  job: Pick<Job, 'countries' | 'sponsors'>,
  workCountries: string[],
  readLists: SponsorCountry[]
): string | null {
  if (job.countries.some((c) => workCountries.includes(c))) return 'No visa needed'
  const code = job.countries.filter(isSponsorCountry).find((c) => readLists.includes(c))
  if (code === undefined) return null
  const label = SPONSOR_LIST_LABEL[code]
  // Matching is by name, so a company registered under another name is missed: "No match", not "Not on".
  return job.sponsors.some((s) => s.country === code)
    ? `On the ${label} sponsor list`
    : `No match on the ${label} sponsor list`
}
