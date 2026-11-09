import type {
  Company,
  CompanyList,
  FilterSettings,
  ImportResult,
  Job,
  JobCheckProgress,
  JobStatus,
  LookupProgress,
  SponsorCountry,
  SponsorListInfo
} from './types'

export interface JobAutoApi {
  listCompanies(): Promise<Company[]>
  /** Asks for the tracker file (.xlsx); null when the dialog is cancelled. */
  importTracker(): Promise<ImportResult | null>
  /** With a link, the link is checked at once. */
  addCompany(name: string, list: CompanyList, careersUrl: string | null): Promise<Company>
  moveCompany(id: number, list: CompanyList): Promise<void>
  removeCompany(id: number): Promise<void>
  /** Rejects with a message the screen shows as it is. */
  pasteCareersLink(id: number, url: string): Promise<Company>
  /** Back to "not checked yet", so the next lookup includes it. */
  lookUpAgain(id: number): Promise<void>
  lookupInfo(): Promise<{ claudePath: string | null; progress: LookupProgress }>
  /** Resolves when the run ends. */
  startLookup(): Promise<void>
  stopLookup(): Promise<void>
  onLookupProgress(cb: (p: LookupProgress) => void): () => void
  /** The jobs that pass the saved filters. */
  listJobs(): Promise<Job[]>
  setJobStatus(id: number, status: JobStatus | null): Promise<void>
  setJobNotes(id: number, notes: string): Promise<void>
  jobCheckInfo(): Promise<JobCheckProgress>
  /** Resolves when the check ends; never rejects. */
  startJobCheck(): Promise<void>
  stopJobCheck(): Promise<void>
  onJobCheckProgress(cb: (p: JobCheckProgress) => void): () => void
  getFilters(): Promise<FilterSettings>
  saveFilters(f: FilterSettings): Promise<void>
  /** A fresh copy of the built-in filters. */
  defaultFilters(): Promise<FilterSettings>
  sponsorLists(): Promise<SponsorListInfo[]>
  /** Reads every list again; resolves when done and never rejects. */
  refreshSponsorLists(): Promise<void>
  /** Hides a wrong sponsor match for this company. */
  rejectSponsor(companyId: number, country: SponsorCountry, name: string): Promise<void>
  getWorkRights(): Promise<string[]>
  saveWorkRights(labels: string[]): Promise<void>
  /** Settings → Reading: whether script-built careers pages are read with Claude, weekly. */
  getReadPages(): Promise<boolean>
  saveReadPages(on: boolean): Promise<void>
  openExternal(url: string): Promise<void>
  appInfo(): Promise<{ version: string; dataPath: string; test: boolean }>
}

export const IPC = {
  listCompanies: 'job-auto:list-companies',
  importTracker: 'job-auto:import-tracker',
  addCompany: 'job-auto:add-company',
  moveCompany: 'job-auto:move-company',
  removeCompany: 'job-auto:remove-company',
  pasteCareersLink: 'job-auto:paste-careers-link',
  lookUpAgain: 'job-auto:look-up-again',
  lookupInfo: 'job-auto:lookup-info',
  startLookup: 'job-auto:start-lookup',
  stopLookup: 'job-auto:stop-lookup',
  lookupProgress: 'job-auto:lookup-progress',
  listJobs: 'job-auto:list-jobs',
  setJobStatus: 'job-auto:set-job-status',
  setJobNotes: 'job-auto:set-job-notes',
  jobCheckInfo: 'job-auto:job-check-info',
  startJobCheck: 'job-auto:start-job-check',
  stopJobCheck: 'job-auto:stop-job-check',
  jobCheckProgress: 'job-auto:job-check-progress',
  getFilters: 'job-auto:get-filters',
  saveFilters: 'job-auto:save-filters',
  defaultFilters: 'job-auto:default-filters',
  sponsorLists: 'job-auto:sponsor-lists',
  refreshSponsorLists: 'job-auto:refresh-sponsor-lists',
  rejectSponsor: 'job-auto:reject-sponsor',
  getWorkRights: 'job-auto:get-work-rights',
  saveWorkRights: 'job-auto:save-work-rights',
  getReadPages: 'job-auto:get-read-pages',
  saveReadPages: 'job-auto:save-read-pages',
  openExternal: 'job-auto:open-external',
  appInfo: 'job-auto:app-info'
} as const
