// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { groupShared, type JobGroup } from '../../src/renderer/src/jobGroups'
import { equalEarth } from '../../src/renderer/src/map/projection'
import { WorldMap } from '../../src/renderer/src/map/WorldMap'
import countries from '../../src/renderer/src/assets/countries.json'
import { ATTRIBUTION } from '../../src/shared/attribution'
import type { Job, Place } from '../../src/shared/types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const GOTHENBURG: Place = { city: 'Gothenburg', country: 'SE', lat: 57.71, lon: 11.97 }
const STOCKHOLM: Place = { city: 'Stockholm', country: 'SE', lat: 59.33, lon: 18.07 }
const SWEDEN: Place = { city: null, country: 'SE', lat: 62.8, lon: 16.7 }
const AUSTIN: Place = { city: 'Austin', country: 'US', lat: 30.27, lon: -97.74 }
const TOKYO: Place = { city: 'Tokyo', country: 'JP', lat: 35.69, lon: 139.69 }

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
    postedAt: null,
    postedRough: false,
    firstSeen: '2026-11-02T09:00:00.000Z',
    lastSeen: '2026-11-04T09:00:00.000Z',
    closedAt: null,
    isNew: false,
    status: null,
    notes: '',
    regionGroups: ['nordics'],
    locationUnclear: false,
    places: [GOTHENBURG],
    sponsors: [],
    ...over
  }
}

const DOT_NAME = /: \d+ jobs?$/
const dots = (): HTMLElement[] => screen.queryAllByRole('button', { name: DOT_NAME })
const dot = (name: string): HTMLElement => screen.getByRole('button', { name })
const labels = (): string[] => dots().map((d) => d.getAttribute('aria-label') ?? '')
const map = (): SVGSVGElement => document.querySelector('svg') as SVGSVGElement
const world = (): string => map().querySelector('g')?.getAttribute('transform') ?? ''
const scaleOf = (transform: string): number => Number(/scale\(([^)]+)\)/.exec(transform)?.[1])

function show(groups: JobGroup[], onPick = vi.fn()): ReturnType<typeof vi.fn> {
  render(<WorldMap groups={groups} onPick={onPick} picked={null} />)
  return onPick
}

/** Every attribute in the map, as text. */
function geometry(): string[] {
  const out: string[] = []
  for (const el of [map(), ...map().querySelectorAll('*')]) {
    for (const a of el.attributes) out.push(a.value)
  }
  return out
}

describe('equalEarth', () => {
  test('puts 0,0 at the origin and the 180th meridian at about 2.7067', () => {
    expect(equalEarth(0, 0)).toEqual([0, 0])
    expect(equalEarth(180, 0)[0]).toBeCloseTo(2.7067, 3)
    expect(equalEarth(-180, 0)[0]).toBeCloseTo(-2.7067, 3)
  })

  test('gives SVG coordinates: north is up', () => {
    expect(equalEarth(0, 90)[1]).toBeCloseTo(-1.3174, 3)
    expect(equalEarth(0, -90)[1]).toBeCloseTo(1.3174, 3)
    expect(equalEarth(11.97, 57.71)[1]).toBeLessThan(0)
  })
})

describe('WorldMap', () => {
  test('draws the countries and the attribution under the map', () => {
    show([])
    // One path per outline (Australia has three).
    expect(map().querySelectorAll('path').length).toBe(countries.length)
    expect(screen.getByText(ATTRIBUTION)).toBeTruthy()
  })

  test('one dot per place; a job with two cities gives two dots', () => {
    show(
      groupShared([
        job({ places: [GOTHENBURG] }),
        job({ places: [GOTHENBURG, STOCKHOLM] }),
        // The same place twice in one job still counts the job once.
        job({ places: [STOCKHOLM, STOCKHOLM] })
      ])
    )
    expect(labels().sort()).toEqual(['Gothenburg: 2 jobs', 'Stockholm: 2 jobs'])
  })

  test('a group shared by 3 companies counts once at its place', () => {
    const url = 'https://jobs.example.com/job/1/'
    const groups = groupShared([
      job({ url, company: 'Volvo CE' }),
      job({ url, company: 'Renault Trucks' }),
      job({ url, company: 'Mack Trucks' })
    ])
    expect(groups).toHaveLength(1)
    show(groups)
    expect(labels()).toEqual(['Gothenburg: 1 job'])
    expect(dot('Gothenburg: 1 job').getAttribute('r')).toBe('7')
  })

  test('size grows with the jobs there; colour is the first region, or grey without one', () => {
    show(
      groupShared([
        job({ places: [SWEDEN], regionGroups: ['nordics', 'europe'] }),
        ...[1, 2, 3, 4].map(() => job({ places: [AUSTIN], regionGroups: ['usa'] })),
        job({ places: [TOKYO], regionGroups: [] })
      ])
    )
    const sweden = dot('Somewhere in Sweden: 1 job')
    expect(sweden.getAttribute('r')).toBe('7')
    expect(sweden.getAttribute('fill')).toBe('#4c8bf5')
    const austin = dot('Austin: 4 jobs')
    // 4 + 3·√4
    expect(austin.getAttribute('r')).toBe('10')
    expect(austin.getAttribute('fill')).toBe('#e5534b')
    expect(dot('Tokyo: 1 job').getAttribute('fill')).toBe('#8b949e')
  })

  test.each([
    ['no jobs', [] as Job[], 0],
    [
      'only unclear locations',
      [
        job({ places: [], locationUnclear: true, regionGroups: [] }),
        job({ places: [], countries: ['AQ'] })
      ],
      0
    ],
    ['one city with 500 jobs', Array.from({ length: 500 }, () => job()), 1]
  ])('%s: no NaN or Infinity in any attribute', (_, jobs, dotCount) => {
    show(groupShared(jobs))
    expect(dots()).toHaveLength(dotCount)
    const bad = geometry().filter((v) => /NaN|Infinity/.test(v))
    expect(bad).toEqual([])
  })

  test('a 500-job dot keeps the formula radius', () => {
    show(groupShared(Array.from({ length: 500 }, () => job())))
    expect(Number(dot('Gothenburg: 500 jobs').getAttribute('r'))).toBeCloseTo(
      4 + 3 * Math.sqrt(500),
      6
    )
  })

  test('the first view fits every dot inside the map, closer than the whole world', () => {
    show([])
    const whole = scaleOf(world())
    cleanup()

    show(groupShared([job({ places: [GOTHENBURG] }), job({ places: [AUSTIN] })]))
    const [, , width, height] = (map().getAttribute('viewBox') ?? '').split(' ').map(Number)
    for (const d of dots()) {
      const cx = Number(d.getAttribute('cx'))
      const cy = Number(d.getAttribute('cy'))
      expect(cx).toBeGreaterThan(0)
      expect(cx).toBeLessThan(width)
      expect(cy).toBeGreaterThan(0)
      expect(cy).toBeLessThan(height)
    }
    expect(scaleOf(world())).toBeGreaterThan(whole)
  })

  test('clicking a dot picks its place; clicking the map clears it', () => {
    const onPick = show(groupShared([job({ places: [GOTHENBURG] }), job({ places: [SWEDEN] })]))
    fireEvent.click(dot('Gothenburg: 1 job'))
    expect(onPick).toHaveBeenLastCalledWith('Gothenburg|SE')
    fireEvent.click(dot('Somewhere in Sweden: 1 job'))
    expect(onPick).toHaveBeenLastCalledWith('|SE')
    expect(onPick).toHaveBeenCalledTimes(2)
    fireEvent.click(map())
    expect(onPick).toHaveBeenLastCalledWith(null)
    fireEvent.keyDown(dot('Gothenburg: 1 job'), { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith('Gothenburg|SE')
  })

  test('the picked dot is marked', () => {
    render(
      <WorldMap
        groups={groupShared([job({ places: [GOTHENBURG] }), job({ places: [STOCKHOLM] })])}
        onPick={vi.fn()}
        picked="Stockholm|SE"
      />
    )
    expect(dot('Stockholm: 1 job').getAttribute('aria-pressed')).toBe('true')
    expect(dot('Gothenburg: 1 job').getAttribute('aria-pressed')).toBe('false')
  })

  test('the wheel zooms about the pointer, dots keep their size, and Whole world resets', () => {
    show([])
    const whole = world()
    cleanup()

    show(groupShared([job({ places: [GOTHENBURG] }), job({ places: [AUSTIN] })]))
    const first = world()
    const r = dot('Gothenburg: 1 job').getAttribute('r')
    const before = dot('Gothenburg: 1 job').getAttribute('cx')

    fireEvent.wheel(map(), { deltaY: -300, clientX: 10, clientY: 10 })
    expect(scaleOf(world())).toBeGreaterThan(scaleOf(first))
    expect(dot('Gothenburg: 1 job').getAttribute('r')).toBe(r)
    expect(dot('Gothenburg: 1 job').getAttribute('cx')).not.toBe(before)

    // Zoom stops at 40 times the whole world.
    for (let i = 0; i < 30; i++) fireEvent.wheel(map(), { deltaY: -1000, clientX: 10, clientY: 10 })
    expect(scaleOf(world()) / scaleOf(whole)).toBeCloseTo(40, 6)

    fireEvent.click(screen.getByRole('button', { name: 'Whole world' }))
    expect(world()).toBe(whole)
    // And never past it.
    fireEvent.wheel(map(), { deltaY: 1000, clientX: 10, clientY: 10 })
    expect(world()).toBe(whole)
  })

  test('dragging pans without picking; a drag ending on a dot does not pick it', () => {
    const onPick = show(groupShared([job({ places: [GOTHENBURG] }), job({ places: [STOCKHOLM] })]))
    const first = world()
    const g = dot('Gothenburg: 1 job')
    fireEvent.pointerDown(g, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(g, { pointerId: 1, clientX: 160, clientY: 130 })
    fireEvent.pointerUp(g, { pointerId: 1, clientX: 160, clientY: 130 })
    fireEvent.click(g)
    expect(world()).not.toBe(first)
    expect(scaleOf(world())).toBe(scaleOf(first))
    expect(onPick).not.toHaveBeenCalled()

    // A plain click still picks.
    fireEvent.pointerDown(g, { pointerId: 2, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(g, { pointerId: 2, clientX: 100, clientY: 100 })
    fireEvent.click(g)
    expect(onPick).toHaveBeenCalledWith('Gothenburg|SE')
  })
})

const LIGHT_LAND = ['#f2d7a6', '#c9e4b8', '#f5c6c6', '#c7d7f0', '#e6d1f2', '#f7e7a1', '#cde8e4']
const DARK_LAND = ['#6b5a3a', '#46613d', '#6e4747', '#3f5373', '#5d4a6b', '#6b6436', '#3e625d']
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** A stand-in for the system's colour scheme, which jsdom doesn't have; `set` switches it as the system would. */
function systemTheme(dark: boolean): { set(dark: boolean): void } {
  const listeners = new Set<() => void>()
  let isDark = dark
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({
      matches: q === DARK_QUERY && isDark,
      addEventListener: (_: string, f: () => void) => listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f)
    }))
  )
  return {
    set(d) {
      isDark = d
      act(() => listeners.forEach((f) => f()))
    }
  }
}

const countryFills = (): string[] =>
  [...map().querySelectorAll('path')].map((p) => p.getAttribute('fill') ?? '')
const expectedFills = (palette: string[]): string[] => countries.map((c) => palette[c.m - 1])
const seaFill = (): string | null | undefined =>
  map().querySelector('.map-sea')?.getAttribute('fill')
const borders = (): string | null | undefined =>
  map().querySelector('.map-countries')?.getAttribute('stroke')

/** A label's text, its lines joined by spaces. */
function textOf(el: Element): string {
  const lines = [...el.querySelectorAll('tspan')].map((t) => t.textContent)
  return lines.length > 0 ? lines.join(' ') : (el.textContent ?? '')
}
const countryLabels = (): string[] => [...map().querySelectorAll('.map-country')].map(textOf)
const cityLabels = (): string[] => [...map().querySelectorAll('.map-city')].map(textOf)
const dotNames = (): string[] => [...map().querySelectorAll('.map-dot-name')].map(textOf)

/** Pixels per projected unit when the whole world just fits the default 800 × 420 map. */
const WHOLE = Math.min(800 / (2 * equalEarth(180, 0)[0]), 420 / (2 * equalEarth(0, -90)[1]))

/** Zooms by `factor` about the point at lon, lat. jsdom puts the map at 0,0, so map pixels are client pixels. */
function zoomAt(lon: number, lat: number, factor: number): void {
  const t = world()
  const [tx, ty] = (/translate\(([^ ]+) ([^)]+)\)/.exec(t) ?? []).slice(1).map(Number)
  const k = scaleOf(t)
  const [x, y] = equalEarth(lon, lat)
  fireEvent.wheel(map(), {
    deltaY: -Math.log(factor) / 0.002,
    clientX: tx + k * x,
    clientY: ty + k * y
  })
}

const LUXEMBOURG: [number, number] = [6.13, 49.61]
const STOCKHOLM_AT: [number, number] = [18.07, 59.33]

describe('WorldMap colours and labels', () => {
  test('light theme: countries in their colour group, a light-blue sea, white borders', () => {
    show([])
    expect(countryFills()).toEqual(expectedFills(LIGHT_LAND))
    expect(seaFill()).toBe('#dcebf7')
    expect(borders()).toBe('#ffffff')
  })

  test('dark theme: the dark colours, and they follow the system when it switches', () => {
    const theme = systemTheme(true)
    show([])
    expect(countryFills()).toEqual(expectedFills(DARK_LAND))
    expect(seaFill()).toBe('#16202b')
    expect(borders()).toBe('#0f1419')
    theme.set(false)
    expect(countryFills()).toEqual(expectedFills(LIGHT_LAND))
    expect(seaFill()).toBe('#dcebf7')
    expect(borders()).toBe('#ffffff')
  })

  test('the whole world names the big countries and no cities', () => {
    show([])
    expect(scaleOf(world())).toBeCloseTo(WHOLE, 6)
    expect(countryLabels()).toContain('Russia')
    expect(countryLabels().some((n) => /^United States/.test(n))).toBe(true)
    expect(countryLabels()).not.toContain('Luxembourg')
    expect(cityLabels()).toEqual([])
  })

  test('at 16 times the world, Luxembourg is named, and so is the city of Stockholm', () => {
    show([])
    zoomAt(...LUXEMBOURG, 16)
    expect(scaleOf(world()) / WHOLE).toBeCloseTo(16, 6)
    expect(countryLabels()).toContain('Luxembourg')
    cleanup()

    show([])
    zoomAt(...STOCKHOLM_AT, 16)
    expect(cityLabels()).toContain('Stockholm')
  })

  test('label text keeps its size at any zoom', () => {
    show([])
    const sizes = (selector: string): string[] =>
      [...map().querySelectorAll(selector)].map((t) => t.getAttribute('font-size') ?? '')
    expect(sizes('.map-country').length).toBeGreaterThan(0)
    expect(new Set(sizes('.map-country'))).toEqual(new Set(['12']))
    zoomAt(...LUXEMBOURG, 16)
    expect(new Set(sizes('.map-country'))).toEqual(new Set(['12']))
    expect(sizes('.map-city').length).toBeGreaterThan(0)
    expect(new Set(sizes('.map-city'))).toEqual(new Set(['11']))
  })

  test("a job dot's city name shows from 3 times the world", () => {
    const place: Place = { city: 'Göteborg', country: 'SE', lat: 57.71, lon: 11.97 }
    show(groupShared([job({ places: [place] }), job({ places: [SWEDEN] })]))
    // The first view comes in to 10 times the world. A dot without a city has no name.
    expect(dotNames()).toEqual(['Göteborg'])
    fireEvent.click(screen.getByRole('button', { name: 'Whole world' }))
    expect(dotNames()).toEqual([])
    expect(screen.queryByText('Göteborg')).toBeNull()
    zoomAt(place.lon, place.lat, 2.9)
    expect(dotNames()).toEqual([])
    zoomAt(place.lon, place.lat, 3.1 / 2.9)
    expect(dotNames()).toEqual(['Göteborg'])
  })

  test('labels are not clickable, and a zoomed view draws only the labels in the frame', () => {
    show([])
    zoomAt(...LUXEMBOURG, 16)
    expect(map().querySelector('.map-labels')?.getAttribute('pointer-events')).toBe('none')
    const texts = [...map().querySelectorAll('.map-labels text')]
    expect(texts.length).toBeGreaterThan(0)
    // About 7,500 names may show at this zoom; only those in the 800 × 420 frame are drawn.
    expect(texts.length).toBeLessThan(300)
    for (const t of texts) {
      const x = Number(t.getAttribute('x'))
      const y = Number(t.getAttribute('y'))
      expect(x).toBeGreaterThan(-300)
      expect(x).toBeLessThan(1100)
      expect(y).toBeGreaterThan(-50)
      expect(y).toBeLessThan(470)
    }
  })

  test('country names at the whole world do not overlap', () => {
    show([])
    // At least half an em per letter and an em per line, centred on x, y.
    const boxes = [...map().querySelectorAll('.map-country')].map((t) => {
      const size = Number(t.getAttribute('font-size'))
      const spans = [...t.querySelectorAll('tspan')]
      const lines = spans.length > 0 ? spans : [t]
      const longest = Math.max(...lines.map((l) => l.textContent?.length ?? 0))
      return {
        name: textOf(t),
        x: Number(t.getAttribute('x')),
        y: Number(t.getAttribute('y')),
        w: (longest * size) / 2,
        h: lines.length * size
      }
    })
    expect(boxes.length).toBeGreaterThan(5)
    const clashes: string[] = []
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2) {
          clashes.push(`${a.name} / ${b.name}`)
        }
      }
    }
    expect(clashes).toEqual([])
  })
})
