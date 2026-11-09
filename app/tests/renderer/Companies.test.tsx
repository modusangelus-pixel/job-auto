// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest'
import { shortLink, STATUS_LABEL, SYSTEM_LABEL } from '../../src/renderer/src/labels'
import { Companies } from '../../src/renderer/src/screens/Companies'
import { cleanName } from '../../src/shared/cleanName'
import type { JobAutoApi } from '../../src/shared/api'
import type {
  Company,
  CompanyList,
  ImportResult,
  LookupProgress,
  SponsorListInfo
} from '../../src/shared/types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

let nextId = 1
function company(over: Partial<Company> = {}): Company {
  const id = nextId++
  return {
    id,
    name: `Company ${id}`,
    list: 'vehicle',
    focus: '',
    hq: '',
    priority: null,
    applicationStatus: null,
    notes: null,
    englishOnly: null,
    visaSponsorship: null,
    careersUrl: null,
    jobsUrl: null,
    jobBoard: null,
    status: 'pending',
    note: null,
    error: null,
    checkedAt: null,
    readAt: null,
    readError: null,
    openJobs: 0,
    sponsors: [],
    ...over
  }
}

const IDLE: LookupProgress = {
  running: false,
  done: 0,
  total: 0,
  current: [],
  step: null,
  lastSummary: null
}

const PICKED = 'C:\\claude.exe'

interface Options {
  claudePath?: string | null
  progress?: LookupProgress
  test?: boolean
  lists?: SponsorListInfo[]
}

interface MockApi {
  api: { [K in keyof JobAutoApi]: Mock<JobAutoApi[K]> }
  /** What the main process holds; the mocked calls change it */
  store: Company[]
  unsubscribe: Mock<() => void>
  /** A progress event from the main process */
  emit(p: LookupProgress): Promise<void>
  /** The lookup run ends: startLookup resolves */
  finishRun(): Promise<void>
}

/** window.jobAuto over a small in-memory company list, so a screen action shows up after the reload. */
function mockApi(companies: Company[], opts: Options = {}): MockApi {
  const store = companies.map((c) => ({ ...c }))
  const find = (id: number): Company => store.find((c) => c.id === id) as Company
  let listener: (p: LookupProgress) => void = () => {}
  let finishRun: () => void = () => {}
  const unsubscribe = vi.fn()
  const api = {
    listCompanies: vi.fn(async () => store.map((c) => ({ ...c }))),
    importTracker: vi.fn(async (): Promise<ImportResult | null> => null),
    addCompany: vi.fn(async (name: string, list: CompanyList, careersUrl: string | null) => {
      const added = company({ name, list, careersUrl })
      store.push(added)
      return { ...added }
    }),
    moveCompany: vi.fn(async (id: number, list: CompanyList) => {
      find(id).list = list
    }),
    removeCompany: vi.fn(async (id: number) => {
      store.splice(store.indexOf(find(id)), 1)
    }),
    pasteCareersLink: vi.fn(async (id: number, url: string) => {
      Object.assign(find(id), { careersUrl: url, status: 'direct', note: 'Link added by you' })
      return { ...find(id) }
    }),
    lookUpAgain: vi.fn(async (id: number) => {
      Object.assign(find(id), { status: 'pending', note: null, error: null })
    }),
    lookupInfo: vi.fn(async () => ({
      claudePath: opts.claudePath === undefined ? PICKED : opts.claudePath,
      progress: opts.progress ?? IDLE
    })),
    startLookup: vi.fn(() => new Promise<void>((resolve) => (finishRun = resolve))),
    stopLookup: vi.fn(async () => {}),
    onLookupProgress: vi.fn((cb: (p: LookupProgress) => void) => {
      listener = cb
      return unsubscribe
    }),
    openExternal: vi.fn<(url: string) => Promise<void>>(async () => {}),
    sponsorLists: vi.fn<JobAutoApi['sponsorLists']>(async () => opts.lists ?? []),
    // A reject hides every spelling of the name in that list, as the app does.
    rejectSponsor: vi.fn<JobAutoApi['rejectSponsor']>(async (id, country, name) => {
      find(id).sponsors = find(id).sponsors.filter(
        (x) => x.country !== country || cleanName(x.name) !== cleanName(name)
      )
    }),
    appInfo: vi.fn(async () => ({
      version: '0.1.0',
      dataPath: 'C:\\data',
      test: opts.test ?? false
    }))
  }
  Object.assign(window, { jobAuto: api })
  return {
    api,
    store,
    unsubscribe,
    emit: (p) => act(async () => listener(p)),
    finishRun: () => act(async () => finishRun())
  }
}

/** The row of one company; the screen shows each company as a list item. */
function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest('li') as HTMLElement
}

function chip(text: string): HTMLButtonElement {
  return screen.getByRole('button', { name: text }) as HTMLButtonElement
}

async function waitForRows(): Promise<void> {
  await screen.findByRole('list')
}

describe('labels', () => {
  test('use the wording from the spec', () => {
    expect(STATUS_LABEL).toEqual({
      pending: 'not checked yet',
      direct: 'read directly',
      needs_claude: 'needs Claude reading',
      blocked: 'blocked',
      not_found: 'not found'
    })
    expect(SYSTEM_LABEL).toEqual({
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
    })
  })
})

describe('shortLink', () => {
  test('shows the host and the path, without the scheme, the query or a trailing slash', () => {
    expect(shortLink('https://waymo.com/careers')).toBe('waymo.com/careers')
    expect(shortLink('https://beta.com/')).toBe('beta.com')
    expect(shortLink('https://beta.com')).toBe('beta.com')
    expect(shortLink('https://boards.greenhouse.io/embed/job_board?for=nuro#x')).toBe(
      'boards.greenhouse.io/embed/job_board'
    )
  })

  test('cuts at 60 characters with …, and shows a non-address as it is', () => {
    const cut = shortLink(`https://acme.com/${'a'.repeat(100)}`)
    expect(cut).toHaveLength(60)
    expect(cut.endsWith('…')).toBe(true)
    // 'acme.com/' is 9 characters, so 51 more make exactly 60: nothing is cut.
    expect(shortLink(`https://acme.com/${'a'.repeat(51)}`)).toBe(`acme.com/${'a'.repeat(51)}`)
    expect(shortLink(`https://acme.com/${'a'.repeat(52)}`)).toBe(`acme.com/${'a'.repeat(50)}…`)
    expect(shortLink('not an address')).toBe('not an address')
  })
})

describe('Companies', () => {
  test('with no companies it offers the tracker import and reports the result', async () => {
    const m = mockApi([])
    m.api.importTracker.mockImplementation(async () => {
      m.store.push(company({ name: 'Acme Cars' }))
      return {
        added: 255,
        skipped: 0,
        errors: ['Row 4 (Acme): the list is not Vehicle, Machinery or Both']
      }
    })
    render(<Companies />)
    fireEvent.click(await screen.findByText('Import your company tracker (.xlsx)'))
    expect(await screen.findByText('Added 255 companies. 0 were already in the app.')).toBeTruthy()
    expect(screen.getByText(/Row 4 \(Acme\)/)).toBeTruthy()
    expect(m.api.importTracker).toHaveBeenCalledTimes(1)
    // The list is read again, so the imported companies show.
    expect(await screen.findByText('Acme Cars')).toBeTruthy()
  })

  test('every import error is on its own line', async () => {
    const m = mockApi([company()])
    m.api.importTracker.mockResolvedValue({
      added: 2,
      skipped: 1,
      errors: ['Row 3 (A): bad', 'Row 9 (B): worse']
    })
    render(<Companies />)
    fireEvent.click(await screen.findByText('Import your company tracker (.xlsx)'))
    expect(await screen.findByText('Added 2 companies. 1 were already in the app.')).toBeTruthy()
    const first = screen.getByText('Row 3 (A): bad')
    const second = screen.getByText('Row 9 (B): worse')
    expect(first).not.toBe(second)
    expect(first.parentElement).toBe(second.parentElement)
  })

  test('the import button stays after the first import, and a cancelled dialog shows nothing', async () => {
    const m = mockApi([company({ name: 'Waymo' })])
    render(<Companies />)
    expect(await screen.findByText('Waymo')).toBeTruthy()
    fireEvent.click(screen.getByText('Import your company tracker (.xlsx)'))
    await waitFor(() => expect(m.api.importTracker).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(screen.queryByText(/Added \d+ companies/)).toBeNull()
    expect(screen.getByText('Import your company tracker (.xlsx)')).toBeTruthy()
    // Nothing was imported, so the list is not read again.
    expect(m.api.listCompanies).toHaveBeenCalledTimes(1)
  })

  test('an import that fails shows its message', async () => {
    const m = mockApi([])
    m.api.importTracker.mockRejectedValue(new Error('The file could not be read'))
    render(<Companies />)
    fireEvent.click(await screen.findByText('Import your company tracker (.xlsx)'))
    expect(await screen.findByText('The file could not be read')).toBeTruthy()
  })

  test('tabs show Vehicle, Machinery and Both with their counts; Vehicle first', async () => {
    mockApi([
      company({ name: 'Waymo', list: 'vehicle' }),
      company({ name: 'Aurora', list: 'vehicle' }),
      company({ name: 'Caterpillar', list: 'machinery' }),
      company({ name: 'Bosch', list: 'both' })
    ])
    render(<Companies />)
    await waitForRows()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Vehicle (2)', 'Machinery (1)', 'Both (1)'])
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    expect(screen.getByText('Waymo')).toBeTruthy()
    expect(screen.getByText('Aurora')).toBeTruthy()
    expect(screen.queryByText('Caterpillar')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Machinery (1)' }))
    expect(screen.getByRole('tab', { name: 'Machinery (1)' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(screen.getByText('Caterpillar')).toBeTruthy()
    expect(screen.queryByText('Waymo')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Both (1)' }))
    expect(screen.getByText('Bosch')).toBeTruthy()
    expect(screen.queryByText('Caterpillar')).toBeNull()
  })

  test('status chips count each status and filter the rows', async () => {
    mockApi([
      company({ name: 'Waymo', status: 'pending' }),
      company({ name: 'Aurora', status: 'pending' }),
      company({ name: 'Zoox', status: 'direct' }),
      company({ name: 'Nuro', status: 'needs_claude' }),
      company({ name: 'Wayve', status: 'not_found' }),
      company({ name: 'Caterpillar', list: 'machinery', status: 'blocked' })
    ])
    render(<Companies />)
    await waitForRows()
    // One chip per status, zeros included, counted within the current tab.
    const chips = within(screen.getByRole('group', { name: 'Filter by status' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(chips).toEqual([
      'All (5)',
      'not checked yet (2)',
      'read directly (1)',
      'needs Claude reading (1)',
      'blocked (0)',
      'not found (1)'
    ])
    expect(chip('All (5)').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(chip('not checked yet (2)'))
    expect(chip('not checked yet (2)').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Waymo')).toBeTruthy()
    expect(screen.getByText('Aurora')).toBeTruthy()
    expect(screen.queryByText('Zoox')).toBeNull()
    expect(screen.queryByText('Nuro')).toBeNull()

    fireEvent.click(chip('blocked (0)'))
    expect(screen.queryByRole('listitem')).toBeNull()

    // The filter stays when the tab changes.
    fireEvent.click(screen.getByRole('tab', { name: 'Machinery (1)' }))
    expect(chip('blocked (1)').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Caterpillar')).toBeTruthy()

    fireEvent.click(chip('All (1)'))
    fireEvent.click(screen.getByRole('tab', { name: 'Vehicle (5)' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  test('a row shows the job system, the status, the link, and the note or error', async () => {
    const m = mockApi([
      company({
        name: 'Waymo',
        hq: 'Mountain View',
        focus: 'Robotaxi',
        status: 'direct',
        jobBoard: { system: 'greenhouse', board: 'waymo' },
        jobsUrl: 'https://boards.greenhouse.io/waymo',
        careersUrl: 'https://waymo.com/careers',
        note: 'Jobs read from the Greenhouse board'
      }),
      company({
        name: 'Aurora',
        status: 'not_found',
        careersUrl: 'https://aurora.tech/careers',
        error: 'The page was not found (404)'
      }),
      company({ name: 'Zoox', status: 'blocked' })
    ])
    render(<Companies />)
    await waitForRows()

    const waymo = within(rowOf('Waymo'))
    expect(waymo.getByText('Mountain View · Robotaxi').className).toContain('muted')
    // The job system comes with its board, so the owner can see which one was detected.
    expect(waymo.getByText('Greenhouse · waymo')).toBeTruthy()
    expect(waymo.getByText('read directly')).toBeTruthy()
    expect(waymo.getByText('Jobs read from the Greenhouse board').className).toContain('muted')

    // No jobs link: only the careers link, and it opens. No job system: a dash.
    const aurora = within(rowOf('Aurora'))
    expect(aurora.getByText('—')).toBeTruthy()
    expect(aurora.getByText('not found')).toBeTruthy()
    expect(aurora.getByText('The page was not found (404)').className).toContain('muted')
    expect(aurora.getByText('aurora.tech/careers')).toBeTruthy()
    expect(aurora.queryByRole('button', { name: 'Open jobs page' })).toBeNull()
    fireEvent.click(aurora.getByRole('button', { name: 'Open careers page' }))
    expect(m.api.openExternal).toHaveBeenLastCalledWith('https://aurora.tech/careers')

    // No link at all: no link text and no link button.
    const zoox = within(rowOf('Zoox'))
    expect(zoox.getByText('blocked')).toBeTruthy()
    expect(zoox.queryByRole('button', { name: /^Open / })).toBeNull()
    expect(m.api.openExternal).toHaveBeenCalledTimes(1)
  })

  test('a read company shows its open jobs and read time; a failed read shows the error', async () => {
    const readAt = new Date(2026, 10, 5, 9, 5).toISOString()
    mockApi([
      company({ name: 'Read Co', status: 'direct', openJobs: 12, readAt }),
      company({ name: 'Never Co', status: 'direct' }),
      company({
        name: 'Failed Co',
        status: 'direct',
        openJobs: 3,
        readAt,
        readError: 'The board answered 500'
      }),
      company({ name: 'Blocked Co', status: 'blocked' }),
      company({ name: 'One Co', status: 'direct', openJobs: 1, readAt })
    ])
    render(<Companies />)
    await waitForRows()

    expect(within(rowOf('Read Co')).getByText('12 open jobs · read 5 Nov 09:05')).toBeTruthy()
    expect(within(rowOf('One Co')).getByText('1 open job · read 5 Nov 09:05')).toBeTruthy()
    expect(within(rowOf('Read Co')).queryByText(/Last read failed/)).toBeNull()
    expect(within(rowOf('Never Co')).getByText('not read yet')).toBeTruthy()
    const failed = within(rowOf('Failed Co'))
    expect(failed.getByText('3 open jobs · read 5 Nov 09:05')).toBeTruthy()
    expect(failed.getByText('Last read failed: The board answered 500')).toBeTruthy()
    // Only companies read directly or as pages have jobs to show.
    expect(within(rowOf('Blocked Co')).queryByText(/open jobs|not read yet/)).toBeNull()
  })

  test('a company read as a page with Claude shows its jobs and its last failure too', async () => {
    const readAt = new Date(2026, 10, 5, 9, 5).toISOString()
    mockApi([
      company({ name: 'Page Co', status: 'needs_claude', openJobs: 4, readAt }),
      company({ name: 'Waiting Co', status: 'needs_claude' }),
      company({
        name: 'Failed Page Co',
        status: 'needs_claude',
        readError: 'Claude: usage limit reached'
      })
    ])
    render(<Companies />)
    await waitForRows()
    expect(
      within(rowOf('Page Co')).getByText('4 open jobs · read as a page 5 Nov 09:05')
    ).toBeTruthy()
    expect(within(rowOf('Waiting Co')).getByText('not read yet')).toBeTruthy()
    expect(
      within(rowOf('Failed Page Co')).getByText('Last read failed: Claude: usage limit reached')
    ).toBeTruthy()
  })

  test('a row shows its careers link and its jobs link, each as short text with its own open button', async () => {
    const m = mockApi([
      company({
        name: 'Waymo',
        status: 'direct',
        jobBoard: { system: 'greenhouse', board: 'waymo' },
        careersUrl: 'https://waymo.com/careers',
        jobsUrl: 'https://boards.greenhouse.io/waymo'
      }),
      company({ name: 'Wayve', jobsUrl: 'https://jobs.ashbyhq.com/wayve' })
    ])
    render(<Companies />)
    await waitForRows()

    const waymo = within(rowOf('Waymo'))
    expect(waymo.getByText('waymo.com/careers')).toBeTruthy()
    expect(waymo.getByText('boards.greenhouse.io/waymo')).toBeTruthy()
    fireEvent.click(waymo.getByRole('button', { name: 'Open careers page' }))
    expect(m.api.openExternal).toHaveBeenLastCalledWith('https://waymo.com/careers')
    fireEvent.click(waymo.getByRole('button', { name: 'Open jobs page' }))
    expect(m.api.openExternal).toHaveBeenLastCalledWith('https://boards.greenhouse.io/waymo')
    expect(m.api.openExternal).toHaveBeenCalledTimes(2)

    // A jobs link alone gets only the jobs button.
    const wayve = within(rowOf('Wayve'))
    expect(wayve.getByText('jobs.ashbyhq.com/wayve')).toBeTruthy()
    expect(wayve.queryByRole('button', { name: 'Open careers page' })).toBeNull()
    fireEvent.click(wayve.getByRole('button', { name: 'Open jobs page' }))
    expect(m.api.openExternal).toHaveBeenLastCalledWith('https://jobs.ashbyhq.com/wayve')
  })

  test('when the careers link and the jobs link are the same, it is shown once, as the careers page', async () => {
    const m = mockApi([
      company({
        name: 'Acme',
        careersUrl: 'https://acme.com/careers',
        jobsUrl: 'https://acme.com/careers'
      })
    ])
    render(<Companies />)
    await waitForRows()

    const acme = within(rowOf('Acme'))
    expect(acme.getAllByText('acme.com/careers')).toHaveLength(1)
    expect(acme.getAllByRole('button', { name: /^Open / })).toHaveLength(1)
    expect(acme.queryByRole('button', { name: 'Open jobs page' })).toBeNull()
    fireEvent.click(acme.getByRole('button', { name: 'Open careers page' }))
    expect(m.api.openExternal).toHaveBeenCalledExactlyOnceWith('https://acme.com/careers')
  })

  test('a long link is cut to about 60 characters with …, and a short one is left alone', async () => {
    const long = `https://www.acme.com/en/company/careers/open-positions/engineering/${'x'.repeat(40)}?ref=1`
    mockApi([
      company({ name: 'Acme', careersUrl: long }),
      company({ name: 'Beta', careersUrl: 'https://beta.com/' })
    ])
    render(<Companies />)
    await waitForRows()

    const text = within(rowOf('Acme')).getByText(/^www\.acme\.com\/en\/company/)
    expect(text.textContent).toBe(
      `www.acme.com/en/company/careers/open-positions/engineering/${'x'.repeat(40)}`.slice(0, 59) +
        '…'
    )
    expect(text.textContent).toHaveLength(60)
    // The whole address stays one hover away.
    expect(text.getAttribute('title')).toBe(long)
    expect(within(rowOf('Beta')).getByText('beta.com')).toBeTruthy()
  })

  test('without Claude Code the lookup button is off and says why', async () => {
    mockApi([company({ name: 'Waymo' })], { claudePath: null })
    render(<Companies />)
    expect(await screen.findByText('Needs Claude Code on this computer, signed in.')).toBeTruthy()
    const button = screen.getByRole('button', {
      name: 'Find careers pages (1 to check)'
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  test('when asking about Claude Code fails, the message shows and the lookup button stays off', async () => {
    const m = mockApi([company({ name: 'Waymo' })])
    m.api.lookupInfo.mockRejectedValue(new Error('The connection to the app was lost'))
    render(<Companies />)
    // The list loads fine meanwhile; that must not wipe the message.
    expect(await screen.findByText('Waymo')).toBeTruthy()
    expect(await screen.findByText('The connection to the app was lost')).toBeTruthy()
    expect(screen.getByText('Needs Claude Code on this computer, signed in.')).toBeTruthy()
    const button = screen.getByRole('button', {
      name: 'Find careers pages (1 to check)'
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  test('when asking about the app fails, the message shows and the rest of the screen works', async () => {
    const m = mockApi([company({ name: 'Waymo' })])
    m.api.appInfo.mockRejectedValue(new Error('No app info'))
    render(<Companies />)
    expect(await screen.findByText('No app info')).toBeTruthy()
    expect(screen.getByText('Waymo')).toBeTruthy()
    const button = screen.getByRole('button', {
      name: 'Find careers pages (1 to check)'
    }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
  })

  test('a list that could not be read shows why, and the next successful read clears it', async () => {
    const m = mockApi([company({ name: 'Waymo' })])
    m.api.listCompanies.mockRejectedValueOnce(new Error('The database is locked'))
    render(<Companies />)
    expect(await screen.findByText('The database is locked')).toBeTruthy()
    expect(screen.queryByText('Waymo')).toBeNull()

    // Any later read of the list is a retry: here, the end of a lookup run triggers one.
    await m.emit({ running: true, done: 1, total: 1, current: [], step: null, lastSummary: null })
    expect(await screen.findByText('Waymo')).toBeTruthy()
    expect(screen.queryByText('The database is locked')).toBeNull()
  })

  test('with Claude Code the lookup button is on and counts the companies to check across the lists', async () => {
    mockApi([
      company({ name: 'Waymo', list: 'vehicle' }),
      company({ name: 'Caterpillar', list: 'machinery' }),
      company({ name: 'Zoox', status: 'direct' })
    ])
    render(<Companies />)
    const button = (await screen.findByRole('button', {
      name: 'Find careers pages (2 to check)'
    })) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    expect(screen.queryByText('Needs Claude Code on this computer, signed in.')).toBeNull()
  })

  test('Find careers pages shows progress and a Stop button while running', async () => {
    const m = mockApi([
      company({ name: 'Waymo' }),
      ...Array.from({ length: 11 }, (_, i) => company({ name: `Maker ${i}` }))
    ])
    render(<Companies />)
    const start = (await screen.findByText('Find careers pages (12 to check)')) as HTMLButtonElement
    await waitFor(() => expect(start.disabled).toBe(false))
    expect(screen.queryByText('Stop')).toBeNull()

    fireEvent.click(start)
    expect(m.api.startLookup).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Stop')).toBeTruthy()
    // A second run would only join this one, so the button is off.
    expect(start.disabled).toBe(true)

    const before = m.api.listCompanies.mock.calls.length
    await m.emit({
      running: true,
      done: 3,
      total: 12,
      current: ['Waymo'],
      step: 'Searching the web: Waymo careers',
      lastSummary: null
    })
    expect(
      screen.getByText('Checked 3 of 12 · now: Waymo · Searching the web: Waymo careers')
    ).toBeTruthy()
    // done changed, so the list is read again ...
    await waitFor(() => expect(m.api.listCompanies.mock.calls.length).toBe(before + 1))

    // ... and with only the step changing it is not.
    await m.emit({
      running: true,
      done: 3,
      total: 12,
      current: ['Waymo', 'Zoox'],
      step: null,
      lastSummary: null
    })
    expect(screen.getByText('Checked 3 of 12 · now: Waymo, Zoox')).toBeTruthy()
    await act(async () => {})
    expect(m.api.listCompanies.mock.calls.length).toBe(before + 1)

    await m.emit({ running: true, done: 4, total: 12, current: [], step: null, lastSummary: null })
    expect(screen.getByText('Checked 4 of 12')).toBeTruthy()
    await waitFor(() => expect(m.api.listCompanies.mock.calls.length).toBe(before + 2))

    fireEvent.click(screen.getByText('Stop'))
    expect(m.api.stopLookup).toHaveBeenCalledTimes(1)
  })

  test('a lookup that is already running when the window opens shows its progress and its end', async () => {
    const m = mockApi([company({ name: 'Waymo' })], {
      progress: {
        running: true,
        done: 7,
        total: 20,
        current: ['Zoox'],
        step: null,
        lastSummary: null
      }
    })
    render(<Companies />)
    expect(await screen.findByText('Checked 7 of 20 · now: Zoox')).toBeTruthy()
    expect(screen.getByText('Stop')).toBeTruthy()
    const start = screen.getByRole('button', { name: /^Find careers pages/ }) as HTMLButtonElement
    expect(start.disabled).toBe(true)

    // This screen did not start the run, so the end event alone brings the list up to date.
    const before = m.api.listCompanies.mock.calls.length
    await m.emit({
      running: false,
      done: 7,
      total: 20,
      current: [],
      step: null,
      lastSummary: 'Stopped.'
    })
    expect(screen.getByText('Stopped.')).toBeTruthy()
    expect(screen.queryByText('Stop')).toBeNull()
    expect(start.disabled).toBe(false)
    await waitFor(() => expect(m.api.listCompanies.mock.calls.length).toBe(before + 1))
  })

  test('a failed run shows its summary', async () => {
    const m = mockApi([company({ name: 'Waymo' })])
    render(<Companies />)
    const start = (await screen.findByText('Find careers pages (1 to check)')) as HTMLButtonElement
    await waitFor(() => expect(start.disabled).toBe(false))
    fireEvent.click(start)
    await screen.findByText('Stop')
    await m.emit({
      running: true,
      done: 0,
      total: 1,
      current: ['Waymo'],
      step: null,
      lastSummary: null
    })
    expect(screen.queryByText('Not logged in')).toBeNull()

    const before = m.api.listCompanies.mock.calls.length
    await m.emit({
      running: false,
      done: 0,
      total: 1,
      current: [],
      step: null,
      lastSummary: 'Not logged in'
    })
    await m.finishRun()
    expect(screen.getByText('Not logged in')).toBeTruthy()
    expect(screen.queryByText('Stop')).toBeNull()
    expect(screen.queryByText(/^Checked /)).toBeNull()
    expect(start.disabled).toBe(false)
    // The end of the run reads the list again.
    expect(m.api.listCompanies.mock.calls.length).toBeGreaterThan(before)
  })

  test('pasting a link updates the row, and a refused link shows the message', async () => {
    const m = mockApi([company({ name: 'Waymo' }), company({ name: 'Aurora' })])
    render(<Companies />)
    await waitForRows()
    const waymo = within(rowOf('Waymo'))
    expect(screen.queryByLabelText('Careers page link for Waymo')).toBeNull()

    fireEvent.click(waymo.getByRole('button', { name: 'Paste link' }))
    const input = waymo.getByLabelText('Careers page link for Waymo')
    // Only the row that asked has an input.
    expect(screen.queryByLabelText('Careers page link for Aurora')).toBeNull()

    m.api.pasteCareersLink.mockRejectedValueOnce(
      new Error("Use the company's own careers page, not a job board")
    )
    fireEvent.change(input, { target: { value: 'https://www.linkedin.com/company/waymo/jobs' } })
    fireEvent.click(waymo.getByRole('button', { name: 'Check' }))
    expect(
      await waymo.findByText("Use the company's own careers page, not a job board")
    ).toBeTruthy()
    expect(waymo.getByText('not checked yet')).toBeTruthy()
    expect(waymo.getByLabelText('Careers page link for Waymo')).toBeTruthy()

    fireEvent.change(waymo.getByLabelText('Careers page link for Waymo'), {
      target: { value: ' https://waymo.com/careers ' }
    })
    fireEvent.click(waymo.getByRole('button', { name: 'Check' }))
    expect(await waymo.findByText('read directly')).toBeTruthy()
    expect(m.api.pasteCareersLink).toHaveBeenLastCalledWith(
      m.store[0].id,
      'https://waymo.com/careers'
    )
    expect(waymo.queryByText("Use the company's own careers page, not a job board")).toBeNull()
    expect(waymo.queryByLabelText('Careers page link for Waymo')).toBeNull()
    expect(waymo.getByText('Link added by you')).toBeTruthy()
    expect(waymo.getByRole('button', { name: 'Open careers page' })).toBeTruthy()
  })

  test('move to another list, remove after confirm, and add a company', async () => {
    const m = mockApi([company({ name: 'Waymo' }), company({ name: 'Aurora' })])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Companies />)
    await waitForRows()
    const [waymoId, auroraId] = m.store.map((c) => c.id)

    // Move: the company leaves this tab and the counts follow.
    fireEvent.change(within(rowOf('Waymo')).getByLabelText('List for Waymo'), {
      target: { value: 'machinery' }
    })
    await waitFor(() => expect(screen.queryByText('Waymo')).toBeNull())
    expect(m.api.moveCompany).toHaveBeenCalledWith(waymoId, 'machinery')
    expect(screen.getByRole('tab', { name: 'Vehicle (1)' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Machinery (1)' })).toBeTruthy()

    // Remove: nothing happens when the owner says no.
    fireEvent.click(within(rowOf('Aurora')).getByRole('button', { name: 'Remove' }))
    expect(confirm).toHaveBeenLastCalledWith(
      'Remove Aurora? Its jobs, statuses and notes are removed too.'
    )
    await act(async () => {})
    expect(m.api.removeCompany).not.toHaveBeenCalled()
    expect(screen.getByText('Aurora')).toBeTruthy()

    confirm.mockReturnValue(true)
    fireEvent.click(within(rowOf('Aurora')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByText('Aurora')).toBeNull())
    expect(m.api.removeCompany).toHaveBeenCalledWith(auroraId)

    // Add: a name, a list and a link.
    fireEvent.change(screen.getByLabelText('New company name'), { target: { value: ' Komatsu ' } })
    fireEvent.change(screen.getByLabelText('New company list'), { target: { value: 'machinery' } })
    fireEvent.change(screen.getByLabelText('New company careers page link (optional)'), {
      target: { value: 'https://komatsu.com/careers' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(m.api.addCompany).toHaveBeenLastCalledWith(
        'Komatsu',
        'machinery',
        'https://komatsu.com/careers'
      )
    )
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Machinery (2)' })).toBeTruthy())
    // The form is empty again.
    expect((screen.getByLabelText('New company name') as HTMLInputElement).value).toBe('')
    expect(
      (screen.getByLabelText('New company careers page link (optional)') as HTMLInputElement).value
    ).toBe('')

    // The list stays as it was set, and without a link null is passed.
    fireEvent.change(screen.getByLabelText('New company name'), { target: { value: 'Liebherr' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(m.api.addCompany).toHaveBeenLastCalledWith('Liebherr', 'machinery', null)
    )
  })

  test('a refused add shows the message and keeps what was typed', async () => {
    const m = mockApi([company({ name: 'Waymo' })])
    m.api.addCompany.mockRejectedValueOnce(new Error('Waymo is already in the app.'))
    render(<Companies />)
    await waitForRows()
    fireEvent.change(screen.getByLabelText('New company name'), { target: { value: 'Waymo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('Waymo is already in the app.')).toBeTruthy()
    expect((screen.getByLabelText('New company name') as HTMLInputElement).value).toBe('Waymo')
  })

  test('a refused move shows the message under that company', async () => {
    const m = mockApi([company({ name: 'Waymo' })])
    m.api.moveCompany.mockRejectedValueOnce(new Error('That company is no longer in the list'))
    render(<Companies />)
    await waitForRows()
    fireEvent.change(within(rowOf('Waymo')).getByLabelText('List for Waymo'), {
      target: { value: 'both' }
    })
    expect(
      await within(rowOf('Waymo')).findByText('That company is no longer in the list')
    ).toBeTruthy()
  })

  test('Look up again puts a company back to not checked yet', async () => {
    const m = mockApi([
      company({ name: 'Waymo', status: 'not_found', error: 'The page was not found (404)' }),
      company({ name: 'Aurora', status: 'direct' })
    ])
    render(<Companies />)
    await waitForRows()
    const waymo = within(rowOf('Waymo'))
    expect(waymo.getByText('not found')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Find careers pages (0 to check)' })).toBeTruthy()

    fireEvent.click(waymo.getByRole('button', { name: 'Look up again' }))
    await waitFor(() => expect(within(rowOf('Waymo')).getByText('not checked yet')).toBeTruthy())
    expect(m.api.lookUpAgain).toHaveBeenCalledWith(m.store[0].id)
    expect(within(rowOf('Waymo')).queryByText('The page was not found (404)')).toBeNull()
    expect(within(rowOf('Aurora')).getByText('read directly')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Find careers pages (1 to check)' })).toBeTruthy()
  })

  test('a test run says so', async () => {
    mockApi([company()], { test: true })
    render(<Companies />)
    expect(await screen.findByText('Test run: working on a copy of your data.')).toBeTruthy()
  })

  test('a normal run does not', async () => {
    const m = mockApi([company()])
    render(<Companies />)
    await waitForRows()
    await waitFor(() => expect(m.api.appInfo).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByText('Test run: working on a copy of your data.')).toBeNull()
  })

  test('it stops listening to progress when it goes away', async () => {
    const m = mockApi([company()])
    const { unmount } = render(<Companies />)
    await waitForRows()
    expect(m.api.onLookupProgress).toHaveBeenCalledTimes(1)
    unmount()
    expect(m.unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('Companies sponsor lines', () => {
  const list = (country: 'GB' | 'NL' | 'DK' | 'CA', fetchedAt: string | null): SponsorListInfo => ({
    country,
    fetchedAt,
    entries: 1,
    error: null
  })

  test('a match shows its list, the detail, and Not this company rejects it', async () => {
    const c = company({
      name: 'Volvo Cars',
      status: 'direct',
      sponsors: [
        { country: 'GB', name: 'Volvo Cars UK Ltd', detail: 'Skilled Worker · A rating' },
        { country: 'NL', name: 'Volvo Cars', detail: 'Recognised sponsor (work)' }
      ]
    })
    const m = mockApi([c], { lists: [list('GB', '2026-11-01T10:00:00.000Z')] })
    render(<Companies />)
    await waitForRows()
    const row = rowOf('Volvo Cars')
    expect(within(row).getByText(/^Sponsor lists:/)).toBeTruthy()
    expect(within(row).getByText('UK (Volvo Cars UK Ltd)').getAttribute('title')).toBe(
      'Skilled Worker · A rating'
    )
    expect(within(row).getByText('Netherlands').getAttribute('title')).toBe(
      'Recognised sponsor (work)'
    )
    fireEvent.click(within(row).getAllByRole('button', { name: 'Not this company' })[0])
    await waitFor(() =>
      expect(m.api.rejectSponsor).toHaveBeenCalledWith(c.id, 'GB', 'Volvo Cars UK Ltd')
    )
    await waitFor(() => expect(within(rowOf('Volvo Cars')).queryByText(/^UK/)).toBeNull())
  })

  test('several names in one list show the list once, each name with its own button', async () => {
    const error = vi.spyOn(console, 'error')
    const c = company({
      name: 'Denso',
      status: 'direct',
      sponsors: [
        // Two spellings of one name are one item.
        { country: 'GB', name: 'DENSO LIMITED', detail: 'Skilled Worker · A rating · Telford' },
        { country: 'GB', name: 'Denso Ltd', detail: 'Skilled Worker · A rating · Swindon' },
        { country: 'NL', name: 'Denso Europe B.V.', detail: 'Recognised sponsor (work)' },
        {
          country: 'NL',
          name: 'Denso International Europe B.V.',
          detail: 'Recognised sponsor (work)'
        }
      ]
    })
    const m = mockApi([c], { lists: [list('GB', '2026-11-01T10:00:00.000Z')] })
    render(<Companies />)
    await waitForRows()
    const row = rowOf('Denso')
    expect(within(row).getByText('UK').getAttribute('title')).toBe(
      'Skilled Worker · A rating · Telford\nSkilled Worker · A rating · Swindon'
    )
    expect(within(row).getByText('Netherlands (Denso Europe B.V.)')).toBeTruthy()
    expect(within(row).getByText('(Denso International Europe B.V.)')).toBeTruthy()
    const buttons = within(row).getAllByRole('button', { name: 'Not this company' })
    expect(buttons).toHaveLength(3)
    expect(error).not.toHaveBeenCalled()

    fireEvent.click(buttons[2])
    await waitFor(() =>
      expect(m.api.rejectSponsor).toHaveBeenCalledWith(
        c.id,
        'NL',
        'Denso International Europe B.V.'
      )
    )
    await waitFor(() =>
      expect(within(rowOf('Denso')).queryByText('(Denso International Europe B.V.)')).toBeNull()
    )
    expect(within(rowOf('Denso')).getByText('Netherlands (Denso Europe B.V.)')).toBeTruthy()
  })

  test('with no match, the fetched lists are named', async () => {
    mockApi([company({ name: 'Acme' })], {
      lists: [
        list('GB', '2026-11-01T10:00:00.000Z'),
        list('NL', '2026-11-01T10:00:00.000Z'),
        list('DK', null),
        list('CA', '2026-11-01T10:00:00.000Z')
      ]
    })
    render(<Companies />)
    await waitForRows()
    expect(
      await within(rowOf('Acme')).findByText(
        'No match on the UK, Netherlands or Canada sponsor lists'
      )
    ).toBeTruthy()
  })

  test('with one list fetched, it is named alone', async () => {
    mockApi([company({ name: 'Acme' })], {
      lists: [list('GB', '2026-11-01T10:00:00.000Z'), list('NL', null)]
    })
    render(<Companies />)
    await waitForRows()
    expect(await within(rowOf('Acme')).findByText('No match on the UK sponsor list')).toBeTruthy()
  })

  test('with no list fetched, nothing is said', async () => {
    const m = mockApi([company({ name: 'Acme' })], { lists: [list('GB', null)] })
    render(<Companies />)
    await waitForRows()
    await waitFor(() => expect(m.api.sponsorLists).toHaveBeenCalled())
    expect(within(rowOf('Acme')).queryByText(/sponsor list/)).toBeNull()
  })
})
