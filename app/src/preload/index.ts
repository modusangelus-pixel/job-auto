import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type JobAutoApi } from '../shared/api'
import type { JobCheckProgress, LookupProgress } from '../shared/types'

// Electron rejects an invoke with "Error invoking remote method '<channel>': Error: <message>". The screen shows
// err.message as it is, so only the message is kept.
const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']*': (?:Error: )?/

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (err) {
    const message = String((err as Error)?.message ?? err).replace(REMOTE_ERROR_PREFIX, '')
    throw new Error(message, { cause: err })
  }
}

const api: JobAutoApi = {
  listCompanies: () => invoke(IPC.listCompanies),
  importTracker: () => invoke(IPC.importTracker),
  addCompany: (name, list, careersUrl) => invoke(IPC.addCompany, name, list, careersUrl),
  moveCompany: (id, list) => invoke(IPC.moveCompany, id, list),
  removeCompany: (id) => invoke(IPC.removeCompany, id),
  pasteCareersLink: (id, url) => invoke(IPC.pasteCareersLink, id, url),
  lookUpAgain: (id) => invoke(IPC.lookUpAgain, id),
  lookupInfo: () => invoke(IPC.lookupInfo),
  startLookup: () => invoke(IPC.startLookup),
  stopLookup: () => invoke(IPC.stopLookup),
  onLookupProgress(cb) {
    const listener = (_e: Electron.IpcRendererEvent, p: LookupProgress): void => cb(p)
    ipcRenderer.on(IPC.lookupProgress, listener)
    return () => ipcRenderer.removeListener(IPC.lookupProgress, listener)
  },
  listJobs: () => invoke(IPC.listJobs),
  setJobStatus: (id, status) => invoke(IPC.setJobStatus, id, status),
  setJobNotes: (id, notes) => invoke(IPC.setJobNotes, id, notes),
  jobCheckInfo: () => invoke(IPC.jobCheckInfo),
  startJobCheck: () => invoke(IPC.startJobCheck),
  stopJobCheck: () => invoke(IPC.stopJobCheck),
  onJobCheckProgress(cb) {
    const listener = (_e: Electron.IpcRendererEvent, p: JobCheckProgress): void => cb(p)
    ipcRenderer.on(IPC.jobCheckProgress, listener)
    return () => ipcRenderer.removeListener(IPC.jobCheckProgress, listener)
  },
  getFilters: () => invoke(IPC.getFilters),
  saveFilters: (f) => invoke(IPC.saveFilters, f),
  defaultFilters: () => invoke(IPC.defaultFilters),
  sponsorLists: () => invoke(IPC.sponsorLists),
  refreshSponsorLists: () => invoke(IPC.refreshSponsorLists),
  rejectSponsor: (companyId, country, name) => invoke(IPC.rejectSponsor, companyId, country, name),
  getWorkRights: () => invoke(IPC.getWorkRights),
  saveWorkRights: (labels) => invoke(IPC.saveWorkRights, labels),
  getReadPages: () => invoke(IPC.getReadPages),
  saveReadPages: (on) => invoke(IPC.saveReadPages, on),
  openExternal: (url) => invoke(IPC.openExternal, url),
  appInfo: () => invoke(IPC.appInfo)
}

contextBridge.exposeInMainWorld('jobAuto', api)
