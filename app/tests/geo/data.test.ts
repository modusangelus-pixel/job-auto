import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { foldText } from '../../src/main/jobs/fold'
import { REGION_COUNTRIES } from '../../src/main/jobs/location'
import { ATTRIBUTION } from '../../src/shared/attribution'

type City = [string, string, number, number, number, string]
type Country = { c: string; g: unknown; n: string; m: number; r: number; p: [number, number] }
type Place = [string, number, number, number]

const root = join(__dirname, '..', '..')
const read = <T>(path: string): T => JSON.parse(readFileSync(join(root, path), 'utf8')) as T

const cities = read<City[]>('src/main/geo/cities.json')
const points = read<Record<string, [number, number]>>('src/main/geo/countryPoints.json')
const countries = read<Country[]>('src/renderer/src/assets/countries.json')
const places = read<Place[]>('src/renderer/src/assets/places.json')

describe('cities.json', () => {
  test('has more than 50000 rows', () => {
    expect(cities.length).toBeGreaterThan(50000)
  })

  test('has Gothenburg under both names near its position', () => {
    const row = cities.find(
      (c) =>
        c[0] === 'SE' &&
        c[5].split('|').includes('goteborg') &&
        c[5].split('|').includes('gothenburg') &&
        Math.abs(c[2] - 57.71) <= 0.05 &&
        Math.abs(c[3] - 11.97) <= 0.05
    )
    expect(row).toBeDefined()
  })

  test('has Køge, Sønderborg, Tromsø and Wrocław under their spelled-out names', () => {
    const has = (country: string, name: string): boolean =>
      cities.some((c) => c[0] === country && c[5].split('|').includes(name))
    expect(has('DK', 'koge')).toBe(true)
    expect(has('DK', 'sonderborg')).toBe(true)
    expect(has('NO', 'tromso')).toBe(true)
    expect(has('PL', 'wroclaw')).toBe(true)
  })

  test('has Poway in California', () => {
    expect(
      cities.some((c) => c[0] === 'US' && c[1] === 'CA' && c[5].split('|').includes('poway'))
    ).toBe(true)
  })

  test('covers exactly the countries of REGION_COUNTRIES', () => {
    const wanted = new Set(Object.values(REGION_COUNTRIES).flat())
    expect(new Set(cities.map((c) => c[0]))).toEqual(wanted)
  })

  test('every stored name is already folded and has no dash or apostrophe', () => {
    const bad: string[] = []
    for (const c of cities) {
      for (const name of c[5].split('|')) {
        if (!/^[a-z0-9 .]+$/.test(name) || foldText(name) !== name || /[-']/.test(name))
          bad.push(name)
      }
    }
    expect(bad.slice(0, 10)).toEqual([])
  })

  test('rounds positions to 2 decimals', () => {
    const bad = cities.filter(
      (c) => Math.round(c[2] * 100) / 100 !== c[2] || Math.round(c[3] * 100) / 100 !== c[3]
    )
    expect(bad.length).toBe(0)
  })
})

describe('countryPoints.json', () => {
  test('has FR, NO, XK and SE as [lat, lon]', () => {
    for (const code of ['FR', 'NO', 'XK', 'SE']) {
      expect(points[code]).toHaveLength(2)
    }
  })
})

describe('countries.json', () => {
  test('has more than 200 features with upper-case two-letter codes', () => {
    expect(countries.length).toBeGreaterThan(200)
    for (const f of countries) expect(f.c).toMatch(/^[A-Z]{2}$/)
  })

  test('every country has a name, a colour 1-7, a label rank and a label point', () => {
    for (const f of countries) {
      expect(f.n.length).toBeGreaterThan(0)
      expect(Number.isInteger(f.m) && f.m >= 1 && f.m <= 7).toBe(true)
      expect(typeof f.r).toBe('number')
      expect(f.p).toHaveLength(2)
      expect(f.p.every((v) => typeof v === 'number')).toBe(true)
    }
  })

  test('Sweden is named and coloured differently from Norway and Finland', () => {
    const get = (c: string): Country => countries.find((f) => f.c === c) as Country
    expect(get('SE').n).toBe('Sweden')
    expect(get('SE').m).not.toBe(get('NO').m)
    expect(get('SE').m).not.toBe(get('FI').m)
  })
})

describe('places.json', () => {
  test('has more than 5000 rows including Stockholm', () => {
    expect(places.length).toBeGreaterThan(5000)
    const s = places.find((p) => p[0] === 'Stockholm')
    expect(s).toBeDefined()
    expect(Math.abs((s as Place)[2] - 59.33)).toBeLessThan(0.1)
    expect(Math.abs((s as Place)[1] - 18.07)).toBeLessThan(0.1)
  })
})

test('ATTRIBUTION is the exact text', () => {
  expect(ATTRIBUTION).toBe('City positions: GeoNames (CC BY 4.0) · Country outlines: Natural Earth')
})
