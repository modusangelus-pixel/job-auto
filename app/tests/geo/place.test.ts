import { describe, expect, test } from 'vitest'
import { countryOfCity, placesOf } from '../../src/main/geo/place'

const near = (p: { lat: number; lon: number }, lat: number, lon: number): void => {
  expect(Math.abs(p.lat - lat)).toBeLessThanOrEqual(0.1)
  expect(Math.abs(p.lon - lon)).toBeLessThanOrEqual(0.1)
}

describe('placesOf reads each location shape', () => {
  test('Göteborg, SE, 417 56', () => {
    const p = placesOf('Göteborg, SE, 417 56', ['SE'])
    expect(p).toHaveLength(1)
    expect(p[0].city).toBe('Göteborg')
    near(p[0], 57.71, 11.97)
  })
  test('Saint Priest, FR, 69800', () => {
    const p = placesOf('Saint Priest, FR, 69800', ['FR'])
    expect(p).toHaveLength(1)
    expect(p[0].city).toBe('Saint Priest')
    near(p[0], 45.7, 4.94)
  })
  test('Poway, CA', () => {
    const p = placesOf('Poway, CA', ['US'])
    expect(p[0].city).toBe('Poway')
    near(p[0], 32.96, -117.04)
  })
  test('Portland, OR', () => {
    const p = placesOf('Portland, OR', ['US'])
    expect(p).toHaveLength(1)
    near(p[0], 45.52, -122.68)
  })
  test('Portland, ME', () => {
    const p = placesOf('Portland, ME', ['US'])
    expect(p).toHaveLength(1)
    near(p[0], 43.66, -70.26)
  })
  test('San Francisco, CA; New York, NY', () => {
    const p = placesOf('San Francisco, CA; New York, NY', ['US'])
    expect(p.map((x) => x.city)).toEqual(['San Francisco', 'New York'])
  })
  test('Germany', () => {
    const p = placesOf('Germany', ['DE'])
    expect(p).toHaveLength(1)
    expect(p[0].city).toBeNull()
    expect(p[0].country).toBe('DE')
  })
  test('Remote', () => {
    expect(placesOf('Remote', [])).toEqual([])
  })
  test('each place is read in its own country', () => {
    const a = placesOf('Austin, TX; Paris, FR', ['US', 'FR'])
    expect(a.map((x) => [x.city, x.country])).toEqual([
      ['Austin', 'US'],
      ['Paris', 'FR']
    ])
    near(a[1], 48.86, 2.35)
    const b = placesOf('Remote - US; Berlin, DE', ['US', 'DE'])
    const berlin = b.filter((x) => x.city === 'Berlin')
    expect(berlin).toHaveLength(1)
    expect(berlin[0].country).toBe('DE')
    near(berlin[0], 52.52, 13.4)
  })
  test('Paris', () => {
    const p = placesOf('Paris', ['FR'])
    expect(p[0].city).toBe('Paris')
    near(p[0], 48.86, 2.35)
  })
})

describe('a state, province or country after a city is not read as a city', () => {
  test.each([
    ['Dallas, TX, USA', 'US', 'Dallas', 32.78, -96.81],
    ['Seattle, Washington, United States', 'US', 'Seattle', 47.61, -122.33],
    ['San Jose, California, United States', 'US', 'San Jose', 37.34, -121.89],
    ['Miramar, Florida', 'US', 'Miramar', 25.99, -80.23],
    ['Richmond, Virginia', 'US', 'Richmond', 37.55, -77.46],
    ['Cardiff, Wales', 'GB', 'Cardiff', 51.48, -3.18],
    ['Montréal, QC', 'CA', 'Montréal', 45.51, -73.59],
    ['Saint-Laurent, Quebec', 'CA', 'Saint-Laurent', 45.5, -73.67]
  ])('%s', (location, country, city, lat, lon) => {
    const p = placesOf(location, [country])
    expect(p.map((x) => [x.city, x.country])).toEqual([[city, country]])
    near(p[0], lat, lon)
  })

  test.each([
    ['New York, NY', 'US', 'New York', 40.71, -74.01],
    ['Washington, DC', 'US', 'Washington', 38.9, -77.04],
    ['Quebec, QC', 'CA', 'Quebec', 46.81, -71.21]
  ])('the first part can still be one: %s', (location, country, city, lat, lon) => {
    const p = placesOf(location, [country])
    expect(p.map((x) => x.city)).toEqual([city])
    near(p[0], lat, lon)
  })
})

describe('placesOf skips what is not a place', () => {
  test('a truncated list with an undecoded &hellip; makes no extra country dot', () => {
    const p = placesOf('Arvika, SE, 671 30 +6 more&hellip;', ['SE'])
    expect(p.map((x) => x.city)).toEqual(['Arvika'])
  })
  test('a place with no letters is skipped', () => {
    expect(placesOf('Göteborg; 417 56', ['SE']).map((x) => x.city)).toEqual(['Göteborg'])
  })
  test('entities are decoded before the text is split', () => {
    const p = placesOf('G&#246;teborg, SE', ['SE'])
    expect(p.map((x) => x.city)).toEqual(['Göteborg'])
    near(p[0], 57.71, 11.97)
  })
  test('one location read for different countries gives each its own answer', () => {
    expect(placesOf('Paris', ['FR'])[0].lat).toBeCloseTo(48.86, 1)
    expect(placesOf('Paris', ['US'])[0].country).toBe('US')
  })
})

describe('ø, æ, ß and ł', () => {
  test.each([
    ['Køge', 'DK', 55.46, 12.18],
    ['Sønderborg', 'DK', 54.91, 9.79],
    ['Tromsø', 'NO', 69.65, 18.96],
    ['Wrocław', 'PL', 51.1, 17.03]
  ])('%s lands at its city', (location, country, lat, lon) => {
    const p = placesOf(location, [country])
    expect(p.map((x) => x.city)).toEqual([location])
    near(p[0], lat, lon)
  })
})

describe('countryOfCity names the country of the biggest city of a name, when that is clear', () => {
  test.each([
    ['Dublin', 'IE'],
    ['Vancouver', 'CA'],
    ['Kista', 'SE'],
    ['Munich', 'DE'],
    ['Porto Salvo', 'PT']
  ])('%s is in %s', (name, country) => expect(countryOfCity(name)).toBe(country))

  test.each([
    // Cambridge (GB), Cambridge (Canada) and Cambridge (US) are about as big.
    ['Cambridge'],
    // Outside the countries the city data covers.
    ['Bengaluru'],
    ['']
  ])('%s is unclear', (name) => expect(countryOfCity(name)).toBeNull())
})
