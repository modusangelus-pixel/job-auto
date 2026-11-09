export type CompanyList = 'vehicle' | 'machinery' | 'both'
export type CompanyStatus = 'pending' | 'direct' | 'needs_claude' | 'blocked' | 'not_found'
export type JobSystem =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'smartrecruiters'
  | 'workable'
  | 'recruitee'
  | 'personio'
  | 'workday'
  | 'successfactors'
  | 'icims'
  | 'oracle'
  | 'comeet'
  | 'eightfold'
  | 'avature'
  | 'radancy'
export interface JobBoard {
  system: JobSystem
  board: string
}
export interface Company {
  id: number
  name: string
  list: CompanyList
  focus: string
  hq: string
  priority: string | null
  applicationStatus: string | null
  notes: string | null
  englishOnly: string | null
  visaSponsorship: string | null
  careersUrl: string | null
  jobsUrl: string | null
  jobBoard: JobBoard | null
  status: CompanyStatus
  note: string | null
  error: string | null
  checkedAt: string | null
  /** When the jobs were last read successfully, and why the latest read failed (null when it did not). */
  readAt: string | null
  readError: string | null
  /** Jobs of this company that are still open. */
  openJobs: number
  /** Entries of the official sponsor lists that match this company's name, minus the ones the owner rejected. */
  sponsors: SponsorMatch[]
}
export type NewCompany = Pick<Company, 'name' | 'list'> &
  Partial<
    Pick<
      Company,
      | 'focus'
      | 'hq'
      | 'priority'
      | 'applicationStatus'
      | 'notes'
      | 'englishOnly'
      | 'visaSponsorship'
      | 'careersUrl'
    >
  >
export interface CheckResult {
  careersUrl: string | null
  jobsUrl: string | null
  status: Exclude<CompanyStatus, 'pending'>
  jobBoard: JobBoard | null
  note: string | null
  error: string | null
}
export interface ImportResult {
  added: number
  skipped: number
  errors: string[]
}
export interface LookupProgress {
  running: boolean
  done: number
  total: number
  current: string[]
  step: string | null
  lastSummary: string | null
}

export interface JobCheckProgress {
  running: boolean
  done: number
  total: number
  current: string[]
  lastSummary: string | null
  lastCheckAt: string | null
}

export type Employment = 'full_time' | 'part_time' | 'intern' | 'fixed_term' | 'unknown'
export type JobStatus =
  'interested' | 'applied' | 'interview' | 'offer' | 'rejected' | 'not_interested'
export type RegionGroup =
  'nordics' | 'europe' | 'usa' | 'canada' | 'australia' | 'new_zealand' | 'turkey'
export interface FilterSettings {
  regions: Record<RegionGroup, boolean>
  keep: string[]
  engineer: string[]
  level: string[]
  type: string[]
}
/** One job as a reader found it. countries: ISO alpha-2 codes, [] when the location gives none. */
export interface RawJob {
  sourceId: string
  title: string
  location: string
  countries: string[]
  employment: Employment
  url: string
  postedAt: string | null
  postedRough: boolean
  /** Workday: the list lacks country and job type until the job's own page is read. */
  needsDetails: boolean
}
/** A spot on the world map: a city, or a country's centre when the job names no city. */
export interface Place {
  city: string | null
  country: string
  lat: number
  lon: number
}

/** A stored job as the Jobs screen gets it; the rule fields are filled by applyRules (Task 5). */
export interface Job {
  id: number
  companyId: number
  company: string
  list: CompanyList
  title: string
  location: string
  countries: string[]
  employment: Employment
  url: string
  postedAt: string | null
  postedRough: boolean
  firstSeen: string
  lastSeen: string
  closedAt: string | null
  isNew: boolean
  status: JobStatus | null
  notes: string
  regionGroups: RegionGroup[]
  locationUnclear: boolean
  places: Place[]
  /** The company's sponsor matches. */
  sponsors: SponsorMatch[]
}

/** Countries whose official visa sponsor list the app reads. */
export type SponsorCountry = 'GB' | 'NL' | 'DK' | 'CA'

export interface SponsorMatch {
  country: SponsorCountry
  name: string
  detail: string
}

export interface SponsorListInfo {
  country: SponsorCountry
  fetchedAt: string | null
  entries: number
  error: string | null
}
