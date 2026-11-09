import { expect, test } from 'vitest'
import { IPC } from '../src/shared/api'

test('test runner works', () => {
  expect(1 + 1).toBe(2)
})

test('the job channels exist', () => {
  expect(IPC).toMatchObject({
    listJobs: 'job-auto:list-jobs',
    setJobStatus: 'job-auto:set-job-status',
    setJobNotes: 'job-auto:set-job-notes',
    jobCheckInfo: 'job-auto:job-check-info',
    startJobCheck: 'job-auto:start-job-check',
    stopJobCheck: 'job-auto:stop-job-check',
    jobCheckProgress: 'job-auto:job-check-progress',
    getFilters: 'job-auto:get-filters',
    saveFilters: 'job-auto:save-filters',
    defaultFilters: 'job-auto:default-filters'
  })
})

test('the sponsor and work-rights channels exist', () => {
  expect(IPC).toMatchObject({
    sponsorLists: 'job-auto:sponsor-lists',
    refreshSponsorLists: 'job-auto:refresh-sponsor-lists',
    rejectSponsor: 'job-auto:reject-sponsor',
    getWorkRights: 'job-auto:get-work-rights',
    saveWorkRights: 'job-auto:save-work-rights'
  })
})

test('every channel name starts with job-auto: and is unique', () => {
  const names = Object.values(IPC)
  for (const name of names) expect(name.startsWith('job-auto:')).toBe(true)
  expect(new Set(names).size).toBe(names.length)
})
