import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '../shared/api'
import type { CompanyList, FilterSettings, JobStatus, SponsorCountry } from '../shared/types'
import { findClaude } from './careers/claude'
import { loadReadPages, saveReadPages } from './db/settings'
import { makeAskClaude } from './pages/claudeJobs'
import { createPageCapture } from './pages/capture'
import { addCompany, checkLink, createLookup, makeRunBatch, type Lookup } from './careers/lookup'
import { DB_FILE, type DataPlace } from './dataDir'
import { listCompanies, moveCompany, removeCompany, resetCompany } from './db/companies'
import type { Db } from './db/db'
import { fittingJobs, setJobNotes, setJobStatus } from './db/jobs'
import { checkIsDue, createJobCheck } from './jobs/check'
import { loadWorkRights, saveWorkRights } from './db/workRights'
import { DEFAULT_FILTERS, loadFilters, saveFilters } from './jobs/filters'
import { createFetcher } from './readers/fetcher'
import { refreshSponsorLists } from './sponsors/refresh'
import { rejectSponsor, sponsorLists } from './sponsors/store'
import { importTracker } from './tracker/importTracker'

const LOOKUP_TIMEOUT_MS = 15 * 60_000
/** One careers page read by Claude, which has no tools to wait on. */
const PAGE_READ_TIMEOUT_MS = 5 * 60_000

/** Everything the window can ask for. `stop` ends a lookup that is running, for when the app closes. */
export function registerIpc(
  db: Db,
  place: DataPlace,
  log: (line: string) => void
): { stop(): void; checkOnOpen(): Promise<void>; refreshOnOpen(): Promise<void> } {
  const fetcher = createFetcher()
  // The lookup and Claude's runner need each other: the runner reports what Claude is doing to the lookup, which
  // passes it on to the window.
  const lookup: Lookup = createLookup({
    db,
    fetcher,
    log,
    runBatch: makeRunBatch({
      findClaudePath: findClaude,
      // An empty folder of its own, so no project settings or CLAUDE.md are picked up.
      cwd: join(place.dir, 'claude'),
      timeoutMs: LOOKUP_TIMEOUT_MS,
      onStep: (step) => lookup.step(step)
    }),
    onProgress: (p) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC.lookupProgress, p)
      }
    }
  })

  // Same fetcher as the lookup, so the per-host pace is shared.
  const jobCheck = createJobCheck({
    db,
    fetcher,
    log,
    // Script-built careers pages: loaded in a hidden window, read by Claude in its own empty folder.
    pages: {
      capture: createPageCapture(fetcher),
      claudePath: findClaude,
      ask: makeAskClaude({ cwd: join(place.dir, 'claude'), timeoutMs: PAGE_READ_TIMEOUT_MS })
    },
    onProgress: (p) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC.jobCheckProgress, p)
      }
    }
  })

  ipcMain.handle(IPC.listCompanies, () => listCompanies(db))
  ipcMain.handle(IPC.importTracker, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = {
      title: 'Pick your company tracker',
      properties: ['openFile' as const],
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
    }
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (picked.canceled || picked.filePaths.length === 0) return null
    return importTracker(db, picked.filePaths[0])
  })
  ipcMain.handle(IPC.addCompany, (_e, name: string, list: CompanyList, careersUrl: string | null) =>
    addCompany(db, fetcher, name, list, careersUrl)
  )
  ipcMain.handle(IPC.moveCompany, (_e, id: number, list: CompanyList) => moveCompany(db, id, list))
  ipcMain.handle(IPC.removeCompany, (_e, id: number) => removeCompany(db, id))
  ipcMain.handle(IPC.pasteCareersLink, (_e, id: number, url: string) =>
    checkLink(db, fetcher, id, url)
  )
  ipcMain.handle(IPC.lookUpAgain, (_e, id: number) => resetCompany(db, id))

  ipcMain.handle(IPC.lookupInfo, () => ({ claudePath: findClaude(), progress: lookup.progress() }))
  // The window gets the run's progress as it goes, and a failed run ends up in it, so this never rejects.
  ipcMain.handle(IPC.startLookup, () => lookup.start())
  ipcMain.handle(IPC.stopLookup, () => lookup.stop())

  ipcMain.handle(IPC.listJobs, () => fittingJobs(db, loadFilters(db), new Date()))
  ipcMain.handle(IPC.setJobStatus, (_e, id: number, status: JobStatus | null) =>
    setJobStatus(db, id, status)
  )
  ipcMain.handle(IPC.setJobNotes, (_e, id: number, notes: string) => setJobNotes(db, id, notes))
  ipcMain.handle(IPC.jobCheckInfo, () => jobCheck.progress())
  // Progress and failures reach the window through the progress events, so this never rejects.
  ipcMain.handle(IPC.startJobCheck, () => jobCheck.start())
  ipcMain.handle(IPC.stopJobCheck, () => jobCheck.stop())
  ipcMain.handle(IPC.getFilters, () => loadFilters(db))
  ipcMain.handle(IPC.saveFilters, (_e, f: FilterSettings) => saveFilters(db, f))
  ipcMain.handle(IPC.defaultFilters, (): FilterSettings => structuredClone(DEFAULT_FILTERS))

  ipcMain.handle(IPC.sponsorLists, () => sponsorLists(db))
  // Failures are logged and kept in each list's info, so this never rejects.
  ipcMain.handle(IPC.refreshSponsorLists, () =>
    refreshSponsorLists({ db, fetcher, log, force: true })
  )
  ipcMain.handle(
    IPC.rejectSponsor,
    (_e, companyId: number, country: SponsorCountry, name: string) =>
      rejectSponsor(db, companyId, country, name)
  )
  ipcMain.handle(IPC.getWorkRights, () => loadWorkRights(db))
  ipcMain.handle(IPC.saveWorkRights, (_e, labels: string[]) => saveWorkRights(db, labels))
  ipcMain.handle(IPC.getReadPages, () => loadReadPages(db))
  ipcMain.handle(IPC.saveReadPages, (_e, on: boolean) => saveReadPages(db, on === true))

  ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  })
  const dataPath = join(place.dir, DB_FILE)
  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    dataPath,
    test: place.test
  }))

  return {
    stop: () => {
      lookup.stop()
      jobCheck.stop()
    },
    // Starts the job check when none ran today and there is a company to read directly. Never rejects: a database
    // error is logged and the app goes on without the automatic check.
    checkOnOpen: async () => {
      try {
        if (checkIsDue(jobCheck.progress().lastCheckAt, listCompanies(db), new Date())) {
          await jobCheck.start()
        }
      } catch (err) {
        log(`job check on opening failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    // Reads the sponsor lists that were never read or are over a week old. Never rejects.
    refreshOnOpen: async () => {
      try {
        await refreshSponsorLists({ db, fetcher, log })
      } catch (err) {
        log(
          `sponsor refresh on opening failed: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }
}
