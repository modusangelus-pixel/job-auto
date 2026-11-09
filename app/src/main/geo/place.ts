import { foldText } from '../jobs/fold'
import { countriesIn, countryCode, isRegionName, placesIn, usStateCode } from '../jobs/location'
import { decode } from '../jobs/readers/util'
import type { Place } from '../../shared/types'
import cityRows from './cities.json'
import countryPoints from './countryPoints.json'

type CityRow = [string, string, number, number, number, string]

const POINTS = countryPoints as unknown as Record<string, [number, number]>

// `name|country` (and `name|country|admin1` for US rows) -> the most populous row; a tie keeps the first.
let index: Map<string, CityRow> | null = null

function cityIndex(): Map<string, CityRow> {
  if (index) return index
  const map = new Map<string, CityRow>()
  const put = (key: string, row: CityRow): void => {
    const old = map.get(key)
    if (!old || row[4] > old[4]) map.set(key, row)
  }
  for (const row of cityRows as CityRow[]) {
    for (const name of row[5].split('|')) {
      put(`${name}|${row[0]}`, row)
      if (row[0] === 'US') put(`${name}|US|${row[1]}`, row)
    }
  }
  index = map
  return map
}

/** Folds a part as the city names are folded: `-` and `'` become spaces. */
function nameKey(part: string): string {
  return foldText(part).replace(/[-']/g, ' ').replace(/\s+/g, ' ').trim()
}

/** A city of a name is clearly in one country when it is at least this many times as big as any other country's. */
const CLEARLY_BIGGER = 3

// Folded city name -> country -> the population of that country's biggest city of the name. Built on first use.
let byName: Map<string, Map<string, number>> | null = null

/**
 * The country whose biggest city of this name is clearly the biggest of all countries' (Dublin: Ireland, though
 * Dublin, California exists); null when no country is clearly first (Cambridge) or the name is unknown. Only the
 * countries the city data covers can be found.
 */
export function countryOfCity(name: string): string | null {
  if (!byName) {
    byName = new Map()
    for (const row of cityRows as CityRow[]) {
      for (const n of row[5].split('|')) {
        const countries = byName.get(n) ?? new Map<string, number>()
        countries.set(row[0], Math.max(countries.get(row[0]) ?? 0, row[4]))
        byName.set(n, countries)
      }
    }
  }
  const countries = byName.get(nameKey(name))
  if (!countries) return null
  const [first, second] = [...countries].sort((a, b) => b[1] - a[1])
  return !second || first[1] >= CLEARLY_BIGGER * second[1] ? first[0] : null
}

// `countries|location` -> its places. The same locations come back on every read of the jobs, so each is worked out
// once per run of the app.
const known = new Map<string, Place[]>()

/** The map places a location text names, within the given countries. [] when countries is empty. */
export function placesOf(location: string, countries: string[]): Place[] {
  if (countries.length === 0) return []
  const key = `${countries.join(',')}|${location}`
  let places = known.get(key)
  if (places === undefined) {
    places = readPlaces(location, countries)
    known.set(key, places)
  }
  return places
}

function readPlaces(location: string, countries: string[]): Place[] {
  const cities = cityIndex()
  const out: Place[] = []
  const seen = new Set<string>()
  const add = (place: Place): void => {
    const key = `${place.city}|${place.country}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(place)
  }
  for (const parts of placesIn(decode(location))) {
    // A place with no letters names nothing: a postcode, or the empty end an undecoded "&hellip;" leaves.
    if (!parts.some((p) => /\p{L}/u.test(p))) continue
    // This place's own countries, kept to the job's; the job's all when the place names none of them.
    // A bare code can be a country or a state (DE: Germany or Delaware), so a part gives both readings
    // and the city lookup below decides between them.
    let own: string[] = []
    for (let i = parts.length - 1; i >= 0 && own.length === 0; i--) {
      const code = countryCode(parts[i])
      own = [...new Set([...(code ? [code] : []), ...countriesIn(parts[i])])].filter((c) =>
        countries.includes(c)
      )
    }
    const here = own.length > 0 ? own : countries
    let state: string | null = null
    for (const part of parts) state = usStateCode(part) ?? state
    let found = false
    for (let i = parts.length - 1; i >= 0 && !found; i--) {
      const name = nameKey(parts[i])
      if (name === '') continue
      // A state, province or country after the city (Dallas, TX, USA) is not a city; the first part still can be
      // (New York, NY).
      if (isRegionName(parts[i]) && parts.slice(0, i).some((p) => nameKey(p) !== '')) continue
      // A bare two-letter state code (NY) is the state, not a city of that name.
      if (here.includes('US') && name.length === 2 && usStateCode(name)) continue
      for (const country of here) {
        const row =
          (country === 'US' && state ? cities.get(`${name}|US|${state}`) : undefined) ??
          cities.get(`${name}|${country}`)
        if (row) {
          add({ city: parts[i].trim(), country, lat: row[2], lon: row[3] })
          found = true
          break
        }
      }
    }
    if (!found) {
      for (const country of here) {
        const point = POINTS[country]
        if (point) add({ city: null, country, lat: point[0], lon: point[1] })
      }
    }
  }
  return out
}
