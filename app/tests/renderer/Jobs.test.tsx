// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { dateTime, dayMonth, dayMonthYear, postedText } from '../../src/renderer/src/dates'
import { JOB_STATUS_LABEL, REGION_LABEL } from '../../src/renderer/src/labels'
import { Jobs } from '../../src/renderer/src/screens/Jobs'
import type { JobAutoApi } from '../../src/shared/api'
import { ATTRIBUTION } from '../../src/shared/attribution'
import type {
  Job,
  JobCheckProgress,
  JobStatus,
  Place,
  SponsorCountry,
  SponsorListInfo
} from '../../src/shared/types'

// Only the clock is faked: timers and promises keep running.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 5, 12, 0))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const local = (y: number, m: number, d: number, h = 10, min = 0): string =>
  new Date(y, m - 1, d, h, min).toISOString()

let nextId = 1
function job(over: Partial<Job> = {}): Job {
  const id = nextId++
  return {
    id,
    companyId: 1,
    company: `Company ${id}`,
    list: 'vehicle',
    title: `Job ${id}`,
    location: 'Gothenburg, Sweden',
    countries: ['SE'],
    employment: 'full_time',
    url: `https://example.com/jobs/${id}`,
    postedAt: local(2026, 11, 1),
    postedRough: false,
    firstSeen: local(2026, 11, 2),
    lastSeen: local(2026, 11, 4),
    closedAt: null,
    isNew: false,
    status: null,
    notes: '',
    regionGroups: ['nordics'],
    locationUnclear: false,
    places: [],
    sponsors: [],
    ...over
  }
}

/** The four sponsor lists, the given ones read and the others never read. */
const readLists = (read: SponsorCountry[] = ['GB', 'NL', 'DK', 'CA']): SponsorListInfo[] =>
  (['GB', 'NL', 'DK', 'CA'] as const).map((country) => ({
    country,
    fetchedAt: read.includes(country) ? '2026-11-01T10:00:00.000Z' : null,
    entries: read.includes(country) ? 1000 : 0,
    error: null
  }))

const IDLE: JobCheckProgress = {
  running: false,
  done: 0,
  total: 0,
  current: [],
  lastSummary: null,
  lastCheckAt: null
}

interface MockApi {
  api: { [K in keyof JobAutoApi]: Mock<JobAutoApi[K]> }
  store: Job[]
  unsubscribe: Mock<() => void>
  emit(p: JobCheckProgress): Promise<void>
}

function mockApi(jobs: Job[], progress: JobCheckProgress = IDLE): MockApi {
  const store = jobs.map((j) => ({ ...j }))
  let listener: (p: JobCheckProgress) => void = () => {}
  const unsubscribe = vi.fn()
  const api = {
    listJobs: vi.fn(async () => store.map((j) => ({ ...j }))),
    setJobStatus: vi.fn<JobAutoApi['setJobStatus']>(async () => {}),
    setJobNotes: vi.fn<JobAutoApi['setJobNotes']>(async () => {}),
    jobCheckInfo: vi.fn(async () => progress),
    startJobCheck: vi.fn<JobAutoApi['startJobCheck']>(async () => {}),
    stopJobCheck: vi.fn(async () => {}),
    onJobCheckProgress: vi.fn((cb: (p: JobCheckProgress) => void) => {
      listener = cb
      return unsubscribe
    }),
    openExternal: vi.fn<(url: string) => Promise<void>>(async () => {}),
    getWorkRights: vi.fn<JobAutoApi['getWorkRights']>(async () => []),
    sponsorLists: vi.fn<JobAutoApi['sponsorLists']>(async () => readLists())
  }
  Object.assign(window, { jobAuto: api })
  return { api, store, unsubscribe, emit: (p) => act(async () => listener(p)) }
}

const titles = (): string[] =>
  within(screen.getByRole('list'))
    .getAllByRole('button', { name: /^Job / })
    .map((b) => b.textContent ?? '')

const rowOf = (title: string): HTMLElement => screen.getByText(title).closest('li') as HTMLElement
const tab = (name: RegExp | string): HTMLElement => screen.getByRole('tab', { name })
const pick = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('dates', () => {
  test('format in local time with English month names', () => {
    const iso = local(2026, 11, 5, 9, 5)
    expect(dayMonth(iso)).toBe('5 Nov')
    expect(dayMonthYear(iso)).toBe('5 Nov 2026')
    expect(dateTime(iso)).toBe('5 Nov 2026, 09:05')
  })

  test('days ago count local calendar days, not 24-hour spans', () => {
    const now = new Date(2026, 10, 5, 0, 30)
    expect(postedText(local(2026, 11, 5, 23, 0), now)).toBe('posted today')
    expect(postedText(local(2026, 11, 4, 23, 59), now)).toBe('posted 1 day ago')
    expect(postedText(local(2026, 10, 25, 1, 0), now)).toBe('posted 11 days ago')
  })
})

describe('labels', () => {
  test('use the wording from the spec', () => {
    expect(JOB_STATUS_LABEL).toEqual({
      interested: 'Interested',
      applied: 'Applied',
      interview: 'Interview',
      offer: 'Offer',
      rejected: 'Rejected',
      not_interested: 'Not interested'
    })
    expect(REGION_LABEL).toEqual({
      nordics: 'Nordics',
      europe: 'Rest of Europe',
      usa: 'USA',
      canada: 'Canada',
      australia: 'Australia',
      new_zealand: 'New Zealand',
      turkey: 'Turkey'
    })
  })
})

describe('Jobs', () => {
  test('New jobs come first, then the newest', async () => {
    mockApi([
      job({ title: 'Job old', postedAt: local(2026, 10, 1) }),
      job({ title: 'Job new-older', isNew: true, postedAt: local(2026, 11, 2) }),
      job({ title: 'Job recent', postedAt: local(2026, 11, 4) }),
      job({ title: 'Job new-newer', isNew: true, postedAt: local(2026, 11, 3) }),
      // No posted date: first seen decides.
      job({ title: 'Job undated', postedAt: null, firstSeen: local(2026, 11, 3) })
    ])
    render(<Jobs />)
    await screen.findByRole('list')
    expect(titles()).toEqual([
      'Job new-newer',
      'Job new-older',
      'Job recent',
      'Job undated',
      'Job old'
    ])
    expect(within(rowOf('Job new-newer')).getByText('NEW')).toBeTruthy()
    expect(within(rowOf('Job recent')).queryByText('NEW')).toBeNull()
  })

  test('shows the empty message when nothing passes', async () => {
    mockApi([])
    render(<Jobs />)
    expect(
      await screen.findByText("No jobs to show. Press Check now to read the companies' job lists.")
    ).toBeTruthy()
  })

  test('rows show the dates, the company and the title opens the link', async () => {
    const m = mockApi([
      job({ title: 'Job a', company: 'Volvo', postedAt: local(2026, 11, 5) }),
      job({ title: 'Job b', postedAt: local(2026, 11, 4) }),
      job({ title: 'Job c', postedAt: local(2026, 10, 20) }),
      job({ title: 'Job d', postedAt: null, firstSeen: local(2026, 11, 3) }),
      job({ title: 'Job e', postedAt: local(2026, 10, 6), postedRough: true }),
      job({ title: 'Job f', closedAt: local(2026, 11, 4) })
    ])
    render(<Jobs />)
    await screen.findByRole('list')
    expect(within(rowOf('Job a')).getByText('Volvo')).toBeTruthy()
    expect(within(rowOf('Job a')).getByText('Gothenburg, Sweden')).toBeTruthy()
    expect(within(rowOf('Job a')).getByText('posted today')).toBeTruthy()
    expect(within(rowOf('Job b')).getByText('posted 1 day ago')).toBeTruthy()
    expect(within(rowOf('Job c')).getByText('posted 16 days ago')).toBeTruthy()
    expect(within(rowOf('Job d')).getByText('first seen 3 Nov')).toBeTruthy()
    expect(within(rowOf('Job e')).getByText('posted 30+ days ago')).toBeTruthy()
    expect(within(rowOf('Job f')).getByText('closed on 4 Nov 2026')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Job a' }))
    expect(m.api.openExternal).toHaveBeenCalledWith(expect.stringMatching(/example\.com\/jobs\//))
  })

  test('list tabs and the region and status selects narrow the list, and the counts follow', async () => {
    mockApi([
      job({ title: 'Job v1', list: 'vehicle', regionGroups: ['nordics'], status: 'applied' }),
      job({ title: 'Job v2', list: 'vehicle', regionGroups: ['usa'] }),
      job({ title: 'Job m1', list: 'machinery', regionGroups: ['nordics'] }),
      job({ title: 'Job b1', list: 'both', regionGroups: ['nordics', 'europe'] }),
      job({ title: 'Job u1', list: 'vehicle', regionGroups: [], locationUnclear: true })
    ])
    render(<Jobs />)
    await screen.findByRole('list')
    expect(tab('All (5)')).toBeTruthy()
    expect(tab('Vehicle (3)')).toBeTruthy()
    expect(tab('Machinery (1)')).toBeTruthy()
    // Both is its own list, not the sum of the others.
    expect(tab('Both (1)')).toBeTruthy()

    pick('Region', 'nordics')
    expect(tab('All (3)')).toBeTruthy()
    expect(tab('Vehicle (1)')).toBeTruthy()
    expect(tab('Both (1)')).toBeTruthy()
    expect(titles().sort()).toEqual(['Job b1', 'Job m1', 'Job v1'])

    pick('Status', 'applied')
    expect(titles()).toEqual(['Job v1'])
    expect(tab('All (1)')).toBeTruthy()
    expect(tab('Machinery (0)')).toBeTruthy()

    pick('Status', 'none')
    expect(titles().sort()).toEqual(['Job b1', 'Job m1'])

    pick('Status', 'any')
    fireEvent.click(tab(/^Machinery/))
    expect(titles()).toEqual(['Job m1'])
    expect(tab(/^Machinery/).getAttribute('aria-selected')).toBe('true')
  })

  test('location unclear and fixed-term show', async () => {
    mockApi([
      job({
        title: 'Job u',
        location: '',
        countries: [],
        regionGroups: [],
        locationUnclear: true,
        employment: 'fixed_term'
      }),
      job({
        title: 'Job r',
        location: 'Remote',
        countries: [],
        regionGroups: [],
        locationUnclear: true
      }),
      job({ title: 'Job s' })
    ])
    render(<Jobs />)
    await screen.findByRole('list')
    expect(within(rowOf('Job u')).getByText('location unclear')).toBeTruthy()
    expect(within(rowOf('Job u')).getByText('fixed-term')).toBeTruthy()
    // The location text stays visible, with the note after it.
    expect(within(rowOf('Job r')).getByText('Remote · location unclear')).toBeTruthy()
    expect(within(rowOf('Job s')).getByText('Gothenburg, Sweden')).toBeTruthy()
    expect(within(rowOf('Job s')).queryByText(/location unclear/)).toBeNull()
    expect(within(rowOf('Job s')).queryByText('fixed-term')).toBeNull()

    pick('Region', 'unclear')
    expect(titles().sort()).toEqual(['Job r', 'Job u'])
  })

  test('an open job the last check did not see shows when it was last seen', async () => {
    mockApi(
      [
        job({ title: 'Job stale', lastSeen: local(2026, 11, 3, 10) }),
        job({ title: 'Job late night', lastSeen: local(2026, 11, 4, 23, 59) }),
        job({ title: 'Job seen', lastSeen: local(2026, 11, 5, 0, 10) }),
        job({ title: 'Job closed', lastSeen: local(2026, 11, 3), closedAt: local(2026, 11, 4) })
      ],
      { ...IDLE, lastCheckAt: local(2026, 11, 5, 0, 30) }
    )
    render(<Jobs />)
    expect(await screen.findByText('not seen since 3 Nov')).toBeTruthy()
    expect(within(rowOf('Job stale')).getByText('not seen since 3 Nov')).toBeTruthy()
    // Days are the computer's calendar days, not 24-hour spans.
    expect(within(rowOf('Job late night')).getByText('not seen since 4 Nov')).toBeTruthy()
    expect(within(rowOf('Job seen')).queryByText(/not seen since/)).toBeNull()
    // A closed job says when it closed instead.
    expect(within(rowOf('Job closed')).queryByText(/not seen since/)).toBeNull()
    expect(within(rowOf('Job closed')).getByText('closed on 4 Nov 2026')).toBeTruthy()
  })

  test('with no check yet, no job shows a not-seen line', async () => {
    mockApi([job({ title: 'Job a', lastSeen: local(2026, 10, 1) })])
    render(<Jobs />)
    await screen.findByRole('list')
    expect(screen.getByText('Never checked')).toBeTruthy()
    expect(screen.queryByText(/not seen since/)).toBeNull()
  })

  test('changing status and leaving the notes box save through the API', async () => {
    const m = mockApi([job({ title: 'Job a', notes: 'call Anna' })])
    render(<Jobs />)
    await screen.findByRole('list')
    const id = m.store[0].id

    const status = within(rowOf('Job a')).getByLabelText('Status of Job a') as HTMLSelectElement
    expect(Array.from(status.options).map((o) => o.textContent)).toEqual([
      '—',
      'Interested',
      'Applied',
      'Interview',
      'Offer',
      'Rejected',
      'Not interested'
    ])
    fireEvent.change(status, { target: { value: 'interview' satisfies JobStatus } })
    expect(m.api.setJobStatus).toHaveBeenCalledWith(id, 'interview')
    fireEvent.change(status, { target: { value: '' } })
    expect(m.api.setJobStatus).toHaveBeenLastCalledWith(id, null)

    const notes = within(rowOf('Job a')).getByLabelText('Notes for Job a') as HTMLInputElement
    expect(notes.value).toBe('call Anna')
    fireEvent.change(notes, { target: { value: 'call Anna on Monday' } })
    expect(m.api.setJobNotes).not.toHaveBeenCalled()
    fireEvent.blur(notes)
    expect(m.api.setJobNotes).toHaveBeenCalledWith(id, 'call Anna on Monday')
  })

  test('a rejected status save leaves the stored status shown and the problem visible', async () => {
    const m = mockApi([job({ title: 'Job a', status: 'applied' })])
    m.api.setJobStatus.mockRejectedValue(new Error('Could not save'))
    render(<Jobs />)
    await screen.findByRole('list')
    const select = screen.getByLabelText('Status of Job a') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'offer' } })
    expect(await screen.findByText('Could not save')).toBeTruthy()
    expect(select.value).toBe('applied')
  })

  test('notes reverted to the original text after a save are saved again', async () => {
    const m = mockApi([job({ title: 'Job a', notes: 'a' })])
    render(<Jobs />)
    await screen.findByRole('list')
    const notes = screen.getByLabelText('Notes for Job a') as HTMLInputElement
    const id = m.store[0].id
    fireEvent.change(notes, { target: { value: 'b' } })
    fireEvent.blur(notes)
    await waitFor(() => expect(m.api.setJobNotes).toHaveBeenCalledTimes(1))
    // Let the saved value reach the screen before the next edit.
    await act(async () => {})
    fireEvent.change(notes, { target: { value: 'a' } })
    fireEvent.blur(notes)
    expect(m.api.setJobNotes).toHaveBeenCalledTimes(2)
    expect(m.api.setJobNotes).toHaveBeenLastCalledWith(id, 'a')
  })

  test('with No status selected, giving a job a status removes the row and the counts follow', async () => {
    mockApi([job({ title: 'Job a' }), job({ title: 'Job b' })])
    render(<Jobs />)
    await screen.findByRole('list')
    pick('Status', 'none')
    expect(tab('All (2)')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Status of Job a'), { target: { value: 'applied' } })
    await waitFor(() => expect(titles()).toEqual(['Job b']))
    expect(tab('All (1)')).toBeTruthy()
    expect(tab('Vehicle (1)')).toBeTruthy()
  })

  test('a job listed by several companies on one board shows once, naming them all, under each of their lists', async () => {
    const shared = { title: 'Job shared', url: 'https://jobs.volvogroup.com/job/1/' }
    const m = mockApi([
      job({ ...shared, company: 'Volvo CE', list: 'machinery' }),
      job({ ...shared, company: 'Renault Trucks', list: 'vehicle', isNew: true }),
      job({ title: 'Job other', company: 'Other', list: 'vehicle' })
    ])
    render(<Jobs />)
    await screen.findByRole('list')
    expect(titles().sort()).toEqual(['Job other', 'Job shared'])
    expect(within(rowOf('Job shared')).getByText('Volvo CE, Renault Trucks')).toBeTruthy()
    expect(within(rowOf('Job shared')).getByText('NEW')).toBeTruthy()
    expect(tab('All (2)')).toBeTruthy()
    expect(tab('Vehicle (2)')).toBeTruthy()
    expect(tab('Machinery (1)')).toBeTruthy()

    const [a, b] = m.store
    fireEvent.change(within(rowOf('Job shared')).getByLabelText('Status of Job shared'), {
      target: { value: 'applied' }
    })
    expect(m.api.setJobStatus).toHaveBeenCalledWith(a.id, 'applied')
    expect(m.api.setJobStatus).toHaveBeenCalledWith(b.id, 'applied')
    await waitFor(() =>
      expect(
        (within(rowOf('Job shared')).getByLabelText('Status of Job shared') as HTMLSelectElement)
          .value
      ).toBe('applied')
    )
    const notes = within(rowOf('Job shared')).getByLabelText('Notes for Job shared')
    fireEvent.change(notes, { target: { value: 'ask Anna' } })
    fireEvent.blur(notes)
    expect(m.api.setJobNotes).toHaveBeenCalledWith(a.id, 'ask Anna')
    expect(m.api.setJobNotes).toHaveBeenCalledWith(b.id, 'ask Anna')
  })

  test('Check now starts a check; progress shows; Stop stops it', async () => {
    const m = mockApi([job({ title: 'Job a' })])
    render(<Jobs />)
    await screen.findByRole('list')
    expect(screen.getByText('Never checked')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(m.api.startJobCheck).toHaveBeenCalledTimes(1)

    await m.emit({ ...IDLE, running: true, done: 2, total: 9, current: ['Volvo', 'Scania'] })
    expect(screen.getByText('Checked 2 of 9 · now: Volvo, Scania')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Check now' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(m.api.stopJobCheck).toHaveBeenCalledTimes(1)

    // The check ends: the list is read again and the summary shows.
    m.store.push(job({ title: 'Job fresh', isNew: true }))
    await m.emit({
      ...IDLE,
      done: 9,
      total: 9,
      lastSummary: '1 new job',
      lastCheckAt: local(2026, 11, 5, 9, 5)
    })
    expect(await screen.findByText('Job fresh')).toBeTruthy()
    expect(screen.getByText(/Last check: 5 Nov 2026, 09:05/)).toBeTruthy()
    expect(screen.getByText(/1 new job/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })

  test('picks up a running check on mount and unsubscribes on unmount', async () => {
    const m = mockApi([], { ...IDLE, running: true, done: 1, total: 4, current: ['Volvo'] })
    const { unmount } = render(<Jobs />)
    expect(await screen.findByText('Checked 1 of 4 · now: Volvo')).toBeTruthy()
    unmount()
    expect(m.unsubscribe).toHaveBeenCalledTimes(1)
  })

  test('a failing list read or start shows a problem line', async () => {
    const m = mockApi([])
    m.api.listJobs.mockRejectedValue(new Error('Database is locked'))
    m.api.startJobCheck.mockRejectedValue(new Error('Already running'))
    render(<Jobs />)
    expect(await screen.findByText('Database is locked')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(screen.getByText('Already running')).toBeTruthy())
  })
})

describe('Jobs visa tags and LinkedIn', () => {
  const gb = (over: Partial<Job> = {}): Job =>
    job({
      company: 'Volvo CE',
      title: 'Quality Manager',
      location: 'Glasgow, United Kingdom',
      countries: ['GB'],
      places: [{ city: 'Glasgow', country: 'GB', lat: 55.9, lon: -4.3 }],
      sponsors: [{ country: 'GB', name: 'Volvo CE Ltd', detail: 'Skilled Worker' }],
      ...over
    })

  test('a row shows the visa tag after the location and the three LinkedIn buttons', async () => {
    const m = mockApi([gb()])
    render(<Jobs />)
    const row = rowOf(await screen.findByText('Quality Manager').then((t) => t.textContent!))
    await within(row).findByText('On the UK sponsor list')
    expect(within(row).getByText(/^LinkedIn:/)).toBeTruthy()
    const names = within(row)
      .getAllByRole('button', { name: /Recruiters|managers|People in/ })
      .map((b) => b.textContent)
    expect(names).toEqual(['Recruiters', 'Quality managers', 'People in Glasgow'])
    fireEvent.click(within(row).getByRole('button', { name: 'Quality managers' }))
    expect(m.api.openExternal).toHaveBeenCalledWith(
      'https://www.linkedin.com/search/results/people/?keywords=' +
        encodeURIComponent('"Volvo CE" quality manager')
    )
  })

  test('a job with no city place has no city button; a refused open shows the problem', async () => {
    const m = mockApi([gb({ places: [], sponsors: [] })])
    m.api.openExternal.mockRejectedValueOnce(new Error('Could not open the browser.'))
    render(<Jobs />)
    const row = rowOf(await screen.findByText('Quality Manager').then((t) => t.textContent!))
    await within(row).findByText('No match on the UK sponsor list')
    expect(within(row).queryByRole('button', { name: /^People in/ })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Recruiters' }))
    expect(await screen.findByText('Could not open the browser.')).toBeTruthy()
  })

  test('a shared job is on a list when any of its companies is', async () => {
    const url = 'https://jobs.kiongroup.com/job/1/'
    mockApi([
      gb({ title: 'Job shared', url, company: 'KION Group', sponsors: [] }),
      gb({
        title: 'Job shared',
        url,
        company: 'Linde Material Handling',
        sponsors: [{ country: 'GB', name: 'Linde Material Handling (UK) Ltd', detail: 'x' }]
      })
    ])
    render(<Jobs />)
    const row = rowOf(await screen.findByText('Job shared').then((t) => t.textContent!))
    expect(within(row).getByText('KION Group, Linde Material Handling')).toBeTruthy()
    await within(row).findByText('On the UK sponsor list')
  })

  test('a list not read yet gives no tag; the lists are read again when a check ends', async () => {
    const m = mockApi(
      [
        gb({ sponsors: [] }),
        gb({ title: 'Job nl', location: 'Eindhoven', countries: ['NL'], sponsors: [] })
      ],
      { ...IDLE, running: true }
    )
    m.api.sponsorLists.mockResolvedValue(readLists(['NL']))
    render(<Jobs />)
    await screen.findByText('Job nl')
    await within(rowOf('Job nl')).findByText('No match on the Netherlands sponsor list')
    expect(within(rowOf('Quality Manager')).queryByText(/sponsor list/)).toBeNull()

    m.api.sponsorLists.mockResolvedValue(readLists(['NL', 'GB']))
    await m.emit({ ...IDLE, lastCheckAt: local(2026, 11, 5, 11) })
    await within(rowOf('Quality Manager')).findByText('No match on the UK sponsor list')
    expect(m.api.sponsorLists).toHaveBeenCalledTimes(2)
  })

  test('a country the owner can already work in says no visa is needed', async () => {
    const m = mockApi([gb()])
    m.api.getWorkRights.mockResolvedValue(['UK'])
    render(<Jobs />)
    expect(await screen.findByText('No visa needed')).toBeTruthy()
  })
})

describe('Jobs map', () => {
  const GOTHENBURG: Place = { city: 'Gothenburg', country: 'SE', lat: 57.71, lon: 11.97 }
  const AUSTIN: Place = { city: 'Austin', country: 'US', lat: 30.27, lon: -97.74 }
  const LONDON: Place = { city: 'London', country: 'GB', lat: 51.51, lon: -0.13 }
  const GERMANY: Place = { city: null, country: 'DE', lat: 51.2, lon: 10.4 }

  const dot = (name: string): HTMLElement => screen.getByRole('button', { name })
  const dotNames = (): string[] =>
    screen
      .queryAllByRole('button', { name: /: \d+ jobs?$/ })
      .map((d) => d.getAttribute('aria-label') ?? '')
      .sort()
  const panel = (): HTMLElement => screen.getByRole('region', { name: 'Jobs at this place' })
  const unclear = (): HTMLElement => screen.getByRole('region', { name: /^Location unclear/ })

  async function openMap(): Promise<void> {
    render(<Jobs />)
    await screen.findByRole('list')
    fireEvent.click(screen.getByRole('button', { name: 'Map' }))
  }

  test('switching to Map shows the map; the tabs and selects apply to it', async () => {
    mockApi([
      job({ title: 'Job g', list: 'vehicle', places: [GOTHENBURG] }),
      job({ title: 'Job a', list: 'machinery', regionGroups: ['usa'], places: [AUSTIN] }),
      job({ title: 'Job u', list: 'vehicle', regionGroups: [], locationUnclear: true })
    ])
    await openMap()
    expect(screen.getByRole('button', { name: 'Map' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(ATTRIBUTION)).toBeTruthy()
    expect(dotNames()).toEqual(['Austin: 1 job', 'Gothenburg: 1 job'])
    expect(screen.getByText('Click a dot to see its jobs.')).toBeTruthy()

    pick('Region', 'usa')
    expect(dotNames()).toEqual(['Austin: 1 job'])
    pick('Region', 'all')
    fireEvent.click(tab(/^Vehicle/))
    expect(dotNames()).toEqual(['Gothenburg: 1 job'])
    pick('Status', 'applied')
    expect(dotNames()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.queryByText(ATTRIBUTION)).toBeNull()
    pick('Status', 'any')
    expect(titles().sort()).toEqual(['Job g', 'Job u'])
  })

  test('clicking a dot shows its jobs and the country line; status saves to every copy', async () => {
    const url = 'https://jobs.volvogroup.com/job/7/'
    const m = mockApi([
      job({ title: 'Job shared', url, company: 'Volvo CE', places: [GOTHENBURG] }),
      job({ title: 'Job shared', url, company: 'Renault Trucks', places: [GOTHENBURG] }),
      job({ title: 'Job shared', url, company: 'Mack Trucks', places: [GOTHENBURG] }),
      job({ title: 'Job g2', places: [GOTHENBURG, AUSTIN] }),
      job({ title: 'Job a', regionGroups: ['usa'], places: [AUSTIN] })
    ])
    await openMap()
    // The shared job counts once.
    expect(dotNames()).toEqual(['Austin: 2 jobs', 'Gothenburg: 2 jobs'])

    fireEvent.click(dot('Gothenburg: 2 jobs'))
    expect(
      within(panel()).getByRole('heading', { name: 'Gothenburg, Sweden · 2 jobs' })
    ).toBeTruthy()
    expect(
      within(panel()).getByText(
        'Sweden publishes no sponsor list. After a job offer the employer starts your work permit with the Migration Agency.'
      )
    ).toBeTruthy()
    fireEvent.click(within(panel()).getByRole('button', { name: 'www.migrationsverket.se' }))
    expect(m.api.openExternal).toHaveBeenCalledWith('https://www.migrationsverket.se')
    const rows = within(panel())
      .getAllByRole('button', { name: /^Job / })
      .map((b) => b.textContent)
    expect(rows.sort()).toEqual(['Job g2', 'Job shared'])
    expect(within(panel()).getByText('Volvo CE, Renault Trucks, Mack Trucks')).toBeTruthy()

    fireEvent.change(within(panel()).getByLabelText('Status of Job shared'), {
      target: { value: 'applied' }
    })
    for (const copy of m.store.slice(0, 3)) {
      expect(m.api.setJobStatus).toHaveBeenCalledWith(copy.id, 'applied')
    }
    await waitFor(() =>
      expect(
        (within(panel()).getByLabelText('Status of Job shared') as HTMLSelectElement).value
      ).toBe('applied')
    )

    fireEvent.click(dot('Austin: 2 jobs'))
    expect(
      within(panel()).getByRole('heading', { name: 'Austin, United States · 2 jobs' })
    ).toBeTruthy()
    expect(within(panel()).getByText(/H-1B/)).toBeTruthy()
  })

  test('a country-only place is somewhere in the country; a sponsor-list country has no line', async () => {
    mockApi([
      job({ title: 'Job de', countries: ['DE'], regionGroups: ['europe'], places: [GERMANY] }),
      job({ title: 'Job gb', countries: ['GB'], regionGroups: ['europe'], places: [LONDON] })
    ])
    await openMap()
    fireEvent.click(dot('Somewhere in Germany: 1 job'))
    expect(
      within(panel()).getByRole('heading', { name: 'Somewhere in Germany · 1 job' })
    ).toBeTruthy()
    expect(within(panel()).getByText(/Germany needs no sponsor licence/)).toBeTruthy()
    expect(within(panel()).getByRole('button', { name: 'Job de' })).toBeTruthy()

    fireEvent.click(dot('London: 1 job'))
    expect(
      within(panel()).getByRole('heading', { name: 'London, United Kingdom · 1 job' })
    ).toBeTruthy()
    expect(within(panel()).queryByText(/publishes no sponsor list/)).toBeNull()

    // Clicking the map itself closes the place.
    fireEvent.click(document.querySelector('svg') as SVGSVGElement)
    expect(screen.getByText('Click a dot to see its jobs.')).toBeTruthy()
  })

  test('jobs with no place on the map are listed under it', async () => {
    mockApi([
      job({ title: 'Job g', places: [GOTHENBURG] }),
      job({ title: 'Job u', location: 'Remote', regionGroups: [], locationUnclear: true }),
      // A country the map has no centre point for.
      job({ title: 'Job x', location: 'Somewhere', countries: ['AQ'], regionGroups: [] })
    ])
    await openMap()
    expect(within(unclear()).getByRole('heading', { name: 'Location unclear (2)' })).toBeTruthy()
    const rows = within(unclear())
      .getAllByRole('button', { name: /^Job / })
      .map((b) => b.textContent)
    expect(rows.sort()).toEqual(['Job u', 'Job x'])
    expect(within(unclear()).queryByText('Job g')).toBeNull()

    // None left: no heading.
    pick('Region', 'nordics')
    expect(screen.queryByRole('heading', { name: /^Location unclear/ })).toBeNull()
  })
})
