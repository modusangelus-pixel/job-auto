// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest'
import { dayMonthYear } from '../../src/renderer/src/dates'
import { Settings } from '../../src/renderer/src/screens/Settings'
import type { JobAutoApi } from '../../src/shared/api'
import type { FilterSettings, SponsorListInfo } from '../../src/shared/types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const ALL_ON: FilterSettings['regions'] = {
  nordics: true,
  europe: true,
  usa: true,
  canada: true,
  australia: true,
  new_zealand: true,
  turkey: true
}

const SAVED: FilterSettings = {
  regions: { ...ALL_ON, usa: false },
  keep: ['mechanical', 'hydraul*'],
  engineer: ['software'],
  level: ['senior', 'lead'],
  type: ['intern']
}

const DEFAULTS: FilterSettings = {
  regions: ALL_ON,
  keep: ['design'],
  engineer: ['sales'],
  level: ['principal'],
  type: ['trainee']
}

const LISTS: SponsorListInfo[] = [
  { country: 'GB', fetchedAt: '2026-11-01T10:00:00.000Z', entries: 120000, error: null },
  { country: 'NL', fetchedAt: null, entries: 0, error: 'The page changed.' }
]

function mockApi(saveFilters: () => Promise<void> = async () => {}): {
  saveFilters: Mock<() => Promise<void>>
  saveWorkRights: Mock<JobAutoApi['saveWorkRights']>
  sponsorLists: Mock<JobAutoApi['sponsorLists']>
  refreshSponsorLists: Mock<JobAutoApi['refreshSponsorLists']>
  saveReadPages: Mock<JobAutoApi['saveReadPages']>
} {
  const api = {
    getWorkRights: vi.fn(async () => ['UK']),
    saveWorkRights: vi.fn<JobAutoApi['saveWorkRights']>(async () => {}),
    sponsorLists: vi.fn<JobAutoApi['sponsorLists']>(async () => LISTS),
    refreshSponsorLists: vi.fn<JobAutoApi['refreshSponsorLists']>(async () => {}),
    getFilters: vi.fn(async () => SAVED),
    saveFilters: vi.fn(saveFilters),
    defaultFilters: vi.fn(async () => DEFAULTS),
    getReadPages: vi.fn(async () => true),
    saveReadPages: vi.fn<JobAutoApi['saveReadPages']>(async () => {})
  }
  Object.assign(window, { jobAuto: api })
  return api
}

const regions = (): HTMLElement => screen.getByRole('group', { name: 'Regions' })
const box = (label: string): HTMLTextAreaElement =>
  screen.getByLabelText(label) as HTMLTextAreaElement

describe('Settings', () => {
  test('shows the saved filters', async () => {
    mockApi()
    render(<Settings />)
    await waitFor(() => expect(box('Keep titles with').value).toBe('mechanical\nhydraul*'))
    expect(box('Drop engineer titles with').value).toBe('software')
    expect(box('Drop senior titles with').value).toBe('senior\nlead')
    expect(box('Drop job types with').value).toBe('intern')
    expect((within(regions()).getByLabelText('USA') as HTMLInputElement).checked).toBe(false)
    expect((within(regions()).getByLabelText('Rest of Europe') as HTMLInputElement).checked).toBe(
      true
    )
    expect(within(regions()).getAllByRole('checkbox')).toHaveLength(7)
    expect(
      screen.getByText(
        "One word or phrase per line. End a word with * to match every word that starts with it. Upper and lower case, and accents, don't matter."
      )
    ).toBeTruthy()
  })

  test('saving sends trimmed lists without blank lines and the region switches', async () => {
    const api = mockApi()
    render(<Settings />)
    await waitFor(() => expect(box('Keep titles with').value).not.toBe(''))
    fireEvent.change(box('Keep titles with'), {
      target: { value: '  design \n\n  test*  \n   \n' }
    })
    fireEvent.change(box('Drop job types with'), { target: { value: '' } })
    fireEvent.click(within(regions()).getByLabelText('Turkey'))
    fireEvent.click(within(regions()).getByLabelText('USA'))
    fireEvent.click(screen.getByRole('button', { name: 'Save filters' }))
    expect(await screen.findByText('Saved. The Jobs list uses these filters now.')).toBeTruthy()
    expect(api.saveFilters).toHaveBeenCalledWith({
      regions: { ...ALL_ON, turkey: false },
      keep: ['design', 'test*'],
      engineer: ['software'],
      level: ['senior', 'lead'],
      type: []
    })
    fireEvent.change(box('Drop engineer titles with'), { target: { value: 'software\nsales' } })
    expect(screen.queryByText('Saved. The Jobs list uses these filters now.')).toBeNull()
  })

  test('commas separate words as new lines do', async () => {
    const api = mockApi()
    render(<Settings />)
    await waitFor(() => expect(box('Keep titles with').value).not.toBe(''))
    fireEvent.change(box('Keep titles with'), {
      target: { value: 'design, test*,,\n quality ,  continuous improvement' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save filters' }))
    await waitFor(() =>
      expect(api.saveFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          keep: ['design', 'test*', 'quality', 'continuous improvement']
        })
      )
    )
  })

  test('a failed save shows the problem instead of Saved', async () => {
    mockApi(async () => {
      throw new Error('Could not save the filters.')
    })
    render(<Settings />)
    await waitFor(() => expect(box('Keep titles with').value).not.toBe(''))
    fireEvent.click(screen.getByRole('button', { name: 'Save filters' }))
    expect(await screen.findByText('Could not save the filters.')).toBeTruthy()
    expect(screen.queryByText(/^Saved\./)).toBeNull()
  })

  test('reset fills the defaults and saves nothing until Save', async () => {
    const api = mockApi()
    render(<Settings />)
    await waitFor(() => expect(box('Keep titles with').value).not.toBe(''))
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    await waitFor(() => expect(box('Keep titles with').value).toBe('design'))
    expect(box('Drop senior titles with').value).toBe('principal')
    expect((within(regions()).getByLabelText('USA') as HTMLInputElement).checked).toBe(true)
    expect(api.saveFilters).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save filters' }))
    await waitFor(() => expect(api.saveFilters).toHaveBeenCalledWith(DEFAULTS))
  })

  test('Visa: work rights load, save, and the lists show with a refresh', async () => {
    const api = mockApi()
    render(<Settings />)
    const group = await screen.findByRole('group', { name: 'Countries I can already work in' })
    await waitFor(() =>
      expect((within(group).getByLabelText('UK') as HTMLInputElement).checked).toBe(true)
    )
    expect(within(group).getAllByRole('checkbox')).toHaveLength(7)
    fireEvent.click(within(group).getByLabelText('Turkey'))
    fireEvent.click(screen.getByRole('button', { name: 'Save visa settings' }))
    await waitFor(() => expect(api.saveWorkRights).toHaveBeenCalledWith(['UK', 'Turkey']))

    const table = await screen.findByRole('table')
    expect(
      within(table).getByText(`updated ${dayMonthYear(LISTS[0].fetchedAt as string)}`)
    ).toBeTruthy()
    expect(within(table).getByText('120000')).toBeTruthy()
    expect(within(table).getByText('never')).toBeTruthy()
    expect(within(table).getByText('The page changed.')).toBeTruthy()

    let finish: () => void = () => {}
    api.refreshSponsorLists.mockImplementation(() => new Promise<void>((r) => (finish = r)))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh lists now' }))
    const busy = await screen.findByRole('button', { name: 'Refreshing…' })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    api.sponsorLists.mockResolvedValue([
      { ...LISTS[1], fetchedAt: '2026-11-05T10:00:00.000Z', error: null }
    ])
    finish()
    await screen.findByRole('button', { name: 'Refresh lists now' })
    await waitFor(() => expect(api.sponsorLists).toHaveBeenCalledTimes(2))
  })

  test('Reading: page reading is on as saved, and switching it saves at once', async () => {
    const api = mockApi()
    render(<Settings />)
    const box = (await screen.findByLabelText(
      'Read script-built careers pages with Claude (weekly)'
    )) as HTMLInputElement
    await waitFor(() => expect(box.checked).toBe(true))
    fireEvent.click(box)
    await waitFor(() => expect(api.saveReadPages).toHaveBeenCalledWith(false))
    expect(box.checked).toBe(false)
    expect(await screen.findByText('Saved.')).toBeTruthy()
  })
})
