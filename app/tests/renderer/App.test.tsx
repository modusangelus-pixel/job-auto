// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/renderer/src/App'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mockWindow(): void {
  const idleJobs = {
    running: false,
    done: 0,
    total: 0,
    current: [],
    lastSummary: null,
    lastCheckAt: null
  }
  Object.assign(window, {
    jobAuto: {
      listJobs: vi.fn(async () => []),
      jobCheckInfo: vi.fn(async () => idleJobs),
      onJobCheckProgress: vi.fn(() => () => {}),
      listCompanies: vi.fn(async () => []),
      lookupInfo: vi.fn(async () => ({
        claudePath: null,
        progress: {
          running: false,
          done: 0,
          total: 0,
          current: [],
          step: null,
          lastSummary: null
        }
      })),
      onLookupProgress: vi.fn(() => () => {}),
      getWorkRights: vi.fn(async () => []),
      getReadPages: vi.fn(async () => true),
      sponsorLists: vi.fn(async () => []),
      getFilters: vi.fn(async () => ({
        regions: {
          nordics: true,
          europe: true,
          usa: true,
          canada: true,
          australia: true,
          new_zealand: true,
          turkey: true
        },
        keep: [],
        engineer: [],
        level: [],
        type: []
      })),
      appInfo: vi.fn(async () => ({ version: '0.1.0', dataPath: 'C:\\data', test: false }))
    }
  })
}

describe('App', () => {
  test('the sidebar opens Jobs at start and switches screens', async () => {
    mockWindow()
    render(<App />)
    const nav = screen.getByRole('navigation')
    const items = Array.from(nav.querySelectorAll('button')).map((b) =>
      b.textContent?.replace(/^[^A-Za-z]+/, '')
    )
    expect(items).toEqual(['Jobs', 'Companies', 'Settings'])
    expect(screen.getByRole('button', { name: /Jobs/ }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByRole('heading', { name: 'Jobs' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Companies' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Companies/ }))
    expect(await screen.findByRole('heading', { name: 'Companies' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Companies/ }).getAttribute('aria-current')).toBe(
      'page'
    )
    expect(screen.getByRole('button', { name: /Jobs/ }).getAttribute('aria-current')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Settings/ }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Settings/ }).getAttribute('aria-current')).toBe(
      'page'
    )
    expect(screen.queryByRole('heading', { name: 'Companies' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Jobs/ }))
    expect(await screen.findByRole('heading', { name: 'Jobs' })).toBeTruthy()
  })
})
