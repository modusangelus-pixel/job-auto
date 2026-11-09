/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain .mjs script, no type annotations */
// Builds the map's built-in geo data. Run from JOB-AUTO/app with `npm run geo-data`.
//   src/main/geo/cities.json                 city positions (GeoNames cities1000, via the npm package cities-with-1000)
//   src/main/geo/countryPoints.json          one label point per country (Natural Earth)
//   src/renderer/src/assets/countries.json   country outlines, names, colours, label ranks and points (Natural Earth)
//   src/renderer/src/assets/places.json      major cities for map labels (Natural Earth populated places)
// City data is read from node_modules only: nothing is requested from download.geonames.org.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { fields, file } = require('cities-with-1000')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const USER_AGENT = 'JOB-AUTO/0.1 (personal job search)'
const NE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson'
const PLACES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_populated_places_simple.geojson'

// Copy of the union of REGION_COUNTRIES in src/main/jobs/location.ts (this script cannot import
// TypeScript). tests/geo/data.test.ts checks that cities.json covers exactly these countries.
const REGION_COUNTRIES = new Set(
  (
    'SE NO FI DK ' +
    'AL AD AT BE BA BG HR CY CZ EE FR DE GR HU IS IE IT XK LV LI LT LU MT MD MC ME NL MK PL PT RO ' +
    'SM RS SK SI ES UA GB CH VA ' +
    'US CA AU NZ TR'
  ).split(' ')
)

// Same steps as foldText in src/shared/fold.ts: İ/I/ı become i, lower-case, ø æ œ ß ł đ ð þ spelled out,
// NFD and drop combining marks. tests/geo/data.test.ts checks every stored name is unchanged by foldText.
const SPELLED = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th' }
function fold(s) {
  return s
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .replace(/[øæœßłđðþ]/g, (c) => SPELLED[c])
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

function cleanName(raw) {
  const name = fold(raw).replace(/[-']/g, ' ').replace(/ +/g, ' ').trim()
  return /^[a-z0-9 .]+$/.test(name) ? name : null
}

const round2 = (n) => Math.round(n * 100) / 100 + 0 // + 0 turns -0 into 0

function buildCities() {
  const idx = Object.fromEntries(fields.map((f, i) => [f, i]))
  const rows = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    const f = line.split('\t')
    const country = f[idx.country]
    if (!REGION_COUNTRIES.has(country)) continue
    const raw = [f[idx.name], f[idx.asciiname], ...f[idx.alternativeNames].split(',')]
    const names = [...new Set(raw.map(cleanName).filter((n) => n))]
    if (names.length === 0) continue
    rows.push([
      country,
      f[idx.adminCode],
      round2(Number(f[idx.lat])),
      round2(Number(f[idx.lon])),
      Number(f[idx.population]),
      names.join('|')
    ])
  }
  return rows
}

// Rounds a ring to 2 decimals and drops consecutive repeats; null when fewer than 4 points remain.
function roundRing(ring) {
  const out = []
  for (const [x, y] of ring) {
    const p = [round2(x), round2(y)]
    const last = out[out.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  return out.length >= 4 ? out : null
}

function roundPolygon(rings) {
  const [outer, ...holes] = rings.map(roundRing)
  return outer ? [outer, ...holes.filter((r) => r)] : null
}

async function fetchGeoJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`Natural Earth download failed: HTTP ${res.status}`)
  return res.json()
}

async function buildPlaces() {
  const geo = await fetchGeoJson(PLACES_URL)
  return geo.features.map((f) => [
    f.properties.name,
    round2(f.geometry.coordinates[0]),
    round2(f.geometry.coordinates[1]),
    f.properties.scalerank
  ])
}

async function buildCountries() {
  const geo = await fetchGeoJson(NE_URL)
  const points = {}
  const outlines = []
  for (const feature of geo.features) {
    const p = feature.properties
    const code = p.ISO_A2_EH
    if (!/^[A-Z]{2}$/.test(code)) continue // -99: not a country with a code
    const { type, coordinates } = feature.geometry
    const polygons = (type === 'Polygon' ? [coordinates] : coordinates)
      .map(roundPolygon)
      .filter((poly) => poly)
    if (polygons.length === 0) continue
    // A code can occur twice (Australia's territories): its outline is kept, its first point wins.
    if (!(code in points)) points[code] = [round2(p.LABEL_Y), round2(p.LABEL_X)]
    outlines.push({
      c: code,
      g: type === 'Polygon' ? polygons[0] : polygons,
      n: p.NAME_EN || p.NAME,
      m: p.MAPCOLOR7,
      r: p.MIN_LABEL,
      p: [round2(p.LABEL_Y), round2(p.LABEL_X)]
    })
  }
  return { points, outlines }
}

const write = (path, data) => writeFileSync(join(root, path), JSON.stringify(data) + '\n')

const cities = buildCities()
const { points, outlines } = await buildCountries()
const places = await buildPlaces()
write('src/main/geo/cities.json', cities)
write('src/main/geo/countryPoints.json', points)
write('src/renderer/src/assets/countries.json', outlines)
write('src/renderer/src/assets/places.json', places)
console.log(
  `cities: ${cities.length}, country points: ${Object.keys(points).length}, outlines: ${outlines.length}, places: ${places.length}`
)
