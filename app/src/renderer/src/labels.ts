import type {
  CompanyList,
  CompanyStatus,
  JobStatus,
  JobSystem,
  RegionGroup
} from '../../shared/types'

export const STATUS_LABEL: Record<CompanyStatus, string> = {
  pending: 'not checked yet',
  direct: 'read directly',
  needs_claude: 'needs Claude reading',
  blocked: 'blocked',
  not_found: 'not found'
}

export const SYSTEM_LABEL: Record<JobSystem, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
  recruitee: 'Recruitee',
  personio: 'Personio',
  workday: 'Workday',
  successfactors: 'SuccessFactors',
  icims: 'iCIMS',
  oracle: 'Oracle',
  comeet: 'Comeet',
  eightfold: 'Eightfold',
  avature: 'Avature',
  radancy: 'Radancy'
}

const LINK_TEXT_MAX = 60

/** A link as short text for a row: the host and the path, no scheme, query or trailing slash, cut with … past 60. */
export function shortLink(url: string): string {
  let text = url
  try {
    const u = new URL(url)
    text = u.host + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    // Not an address after all: show it as it is.
  }
  return text.length > LINK_TEXT_MAX ? `${text.slice(0, LINK_TEXT_MAX - 1)}…` : text
}

export const LIST_LABEL: Record<CompanyList, string> = {
  vehicle: 'Vehicle',
  machinery: 'Machinery',
  both: 'Both'
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  interested: 'Interested',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  not_interested: 'Not interested'
}

export const REGION_LABEL: Record<RegionGroup, string> = {
  nordics: 'Nordics',
  europe: 'Rest of Europe',
  usa: 'USA',
  canada: 'Canada',
  australia: 'Australia',
  new_zealand: 'New Zealand',
  turkey: 'Turkey'
}

const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' })

/** A country's English name from its ISO alpha-2 code; the code itself when there is none. */
export function countryName(code: string): string {
  try {
    return REGION_NAMES.of(code) ?? code
  } catch {
    return code
  }
}

export const jobCount = (n: number): string => `${n} ${n === 1 ? 'job' : 'jobs'}`

export const FIXED_TERM_LABEL = 'fixed-term'
export const LOCATION_UNCLEAR_LABEL = 'location unclear'
