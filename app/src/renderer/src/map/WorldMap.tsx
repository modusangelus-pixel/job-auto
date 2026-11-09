import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import { ATTRIBUTION } from '../../../shared/attribution'
import type { Place, RegionGroup } from '../../../shared/types'
import countries from '../assets/countries.json'
import places from '../assets/places.json'
import { placeKey, type JobGroup, type PlaceKey } from '../jobGroups'
import { countryName, jobCount } from '../labels'
import { equalEarth } from './projection'

/** The map's colours in one theme. */
interface Palette {
  /** Land by colour group (Natural Earth's MAPCOLOR7, 1–7), so neighbours differ. */
  land: readonly string[]
  /** The sea, which is also the halo around every name. */
  sea: string
  border: string
  country: string
  /** City names and their marks. */
  city: string
  /** The city names of job dots. */
  dotName: string
}

const LIGHT: Palette = {
  land: ['#f2d7a6', '#c9e4b8', '#f5c6c6', '#c7d7f0', '#e6d1f2', '#f7e7a1', '#cde8e4'],
  sea: '#dcebf7',
  border: '#ffffff',
  country: '#45454d',
  city: '#55555d',
  dotName: '#1c1c1e'
}

const DARK: Palette = {
  land: ['#6b5a3a', '#46613d', '#6e4747', '#3f5373', '#5d4a6b', '#6b6436', '#3e625d'],
  sea: '#16202b',
  border: '#0f1419',
  country: '#e2e2e8',
  city: '#c4c4cc',
  dotName: '#ffffff'
}

const DARK_QUERY = '(prefers-color-scheme: dark)'
/** The system's dark-mode query; none in tests (jsdom), which reads as light. */
const darkQuery = (): MediaQueryList | null =>
  typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null
const onThemeChange = (changed: () => void): (() => void) => {
  const query = darkQuery()
  query?.addEventListener('change', changed)
  return () => query?.removeEventListener('change', changed)
}
const isDark = (): boolean => darkQuery()?.matches ?? false

/** Dot colours by the first region of the job. */
const REGION_COLOUR: Record<RegionGroup, string> = {
  nordics: '#4c8bf5',
  europe: '#9b6bd6',
  usa: '#e5534b',
  canada: '#f0883e',
  australia: '#d4a72c',
  new_zealand: '#3fb950',
  turkey: '#db61a2'
}
const NO_REGION_COLOUR = '#8b949e'

/** Zoom is relative to the whole world just fitting the map. */
const MAX_ZOOM = 40
/** The first view comes no closer than this, so a lone city shows the region around it. */
const FIT_MAX_ZOOM = 10
/** Room around the dots in the first view, as a share of their spread, on each side. */
const FIT_PADDING = 0.1
/** Wheel zoom per pixel scrolled. */
const WHEEL_STEP = 0.002
/** A press that moves less than this many pixels is a click, not a drag. */
const DRAG_START = 4

/** Name sizes in screen pixels, at any zoom. */
const COUNTRY_SIZE = 12
const CITY_SIZE = 11
/** Job dots name their city from this zoom. */
const DOT_NAME_ZOOM = 3
/** Countries of this rank or less are named at the whole world, and before the job dots' names. */
const WORLD_RANK = 2
/** Pixels between a dot's edge, or a city's mark, and its name. */
const NAME_GAP = 3
const CITY_MARK = 2
/** Country names longer than this go on two lines. */
const WRAP_AT = 16
/** Line height, and a generous average letter width, in ems: names are kept apart by this estimate. */
const LINE_EM = 1.15
const LETTER_EM = 0.55
/** Room kept clear around each name, in pixels. */
const NAME_ROOM = 2

interface Size {
  width: number
  height: number
}

/** Until the map is measured, and wherever it can't be. */
const DEFAULT_SIZE: Size = { width: 800, height: 420 }

/** The projected point at the centre of the map, and the zoom (1: the whole world fits). */
interface View {
  x: number
  y: number
  zoom: number
}

const WORLD_VIEW: View = { x: 0, y: 0, zoom: 1 }
const [WORLD_LEFT] = equalEarth(-180, 0)
const [WORLD_RIGHT] = equalEarth(180, 0)
const [, WORLD_TOP] = equalEarth(0, 90)
const [, WORLD_BOTTOM] = equalEarth(0, -90)

interface Dot {
  key: PlaceKey
  place: Place
  /** Groups with a job here, each counted once. */
  n: number
  colour: string
  /** Projected position. */
  x: number
  y: number
}

/** A press on the map that may become a drag. */
interface Press {
  id: number
  x: number
  y: number
  view: View
}

type Ring = [number, number][]
/** countries.json has no type tag: a MultiPolygon is nested one level deeper than a Polygon. */
interface Outline {
  c: string
  g: Ring[] | Ring[][]
  /** The name, its colour group (1–7), its label rank (smaller shows sooner) and its label point as lat, lon. */
  n: string
  m: number
  r: number
  p: [number, number]
}

/** places.json: name, lon, lat, rank (smaller shows sooner). */
type PlaceRow = [string, number, number, number]

/** A name that may show on the map, at its projected point. */
interface Name {
  key: string
  text: string
  rank: number
  x: number
  y: number
}

const clamp = (v: number, low: number, high: number): number =>
  Number.isNaN(v) ? low : Math.min(high, Math.max(low, v))

const coords = ([lon, lat]: [number, number]): string => {
  const [x, y] = equalEarth(lon, lat)
  return `${Math.round(x * 1e4) / 1e4},${Math.round(y * 1e4) / 1e4}`
}
const ringPath = (ring: Ring): string => `M${ring.map(coords).join('L')}Z`

/** Projected area of a ring, any winding. */
function ringArea(ring: Ring): number {
  let twice = 0
  let [px, py] = equalEarth(...ring[ring.length - 1])
  for (const point of ring) {
    const [x, y] = equalEarth(...point)
    twice += px * y - x * py
    px = x
    py = y
  }
  return Math.abs(twice) / 2
}

interface Shape {
  d: string
  /** Colour group, 1–7. */
  m: number
}

const rings = (g: Ring[] | Ring[][]): Ring[] =>
  Array.isArray(g[0][0][0]) ? (g as Ring[][]).flat() : (g as Ring[])

let countryShapes: Shape[] | null = null

/** One path per outline in countries.json (Australia has three), built on first use. */
function shapes(): Shape[] {
  countryShapes ??= (countries as unknown as Outline[]).map(({ g, m }) => ({
    d: rings(g).map(ringPath).join(''),
    m
  }))
  return countryShapes
}

let countryNames: Name[] | null = null

/** Country names, the ones that show soonest first, then the biggest countries. */
function countryLabels(): Name[] {
  countryNames ??= (countries as unknown as Outline[])
    .map(({ g, n, r, p: [lat, lon] }, i) => {
      const [x, y] = equalEarth(lon, lat)
      const area = rings(g).reduce((sum, ring) => sum + ringArea(ring), 0)
      return { name: { key: `c${i}`, text: n, rank: r, x, y }, area }
    })
    .sort((a, b) => a.name.rank - b.name.rank || b.area - a.area)
    .map(({ name }) => name)
  return countryNames
}

let cityNames: Name[] | null = null

/** City names, the ones that show soonest first. */
function cityLabels(): Name[] {
  cityNames ??= (places as unknown as PlaceRow[])
    .map(([text, lon, lat, rank], i) => {
      const [x, y] = equalEarth(lon, lat)
      return { key: `p${i}`, text, rank, x, y }
    })
    .sort((a, b) => a.rank - b.rank)
  return cityNames
}

/** The world in projected units: drawn once per theme, then only moved and scaled. */
const Land = memo(function Land({ palette }: { palette: Palette }): React.JSX.Element {
  return (
    <g className="map-countries" stroke={palette.border}>
      {shapes().map(({ d, m }, i) => (
        <path key={i} className="map-land" d={d} fill={palette.land[m - 1]} />
      ))}
    </g>
  )
})

/** One dot per place. A group counts once at each of its places. */
function dotsOf(groups: JobGroup[]): Dot[] {
  const byKey = new Map<PlaceKey, Dot>()
  for (const g of groups) {
    const counted = new Set<PlaceKey>()
    for (const place of g.job.places) {
      const key = placeKey(place)
      if (counted.has(key)) continue
      counted.add(key)
      const dot = byKey.get(key)
      if (dot) {
        dot.n++
        continue
      }
      const region = g.job.regionGroups[0]
      const [x, y] = equalEarth(place.lon, place.lat)
      byKey.set(key, {
        key,
        place,
        n: 1,
        colour: region ? REGION_COLOUR[region] : NO_REGION_COLOUR,
        x,
        y
      })
    }
  }
  // Big dots first, so the small ones stay on top and can be clicked.
  return [...byKey.values()].sort((a, b) => b.n - a.n)
}

const radius = (n: number): number => 4 + 3 * Math.sqrt(n)

const dotLabel = (d: Dot): string =>
  `${d.place.city ?? `Somewhere in ${countryName(d.place.country)}`}: ${jobCount(d.n)}`

/** A long name on two lines, split at the space that best balances them. */
function linesOf(name: string): string[] {
  let best = [name]
  if (name.length <= WRAP_AT) return best
  let longest = name.length
  for (let i = name.indexOf(' '); i >= 0; i = name.indexOf(' ', i + 1)) {
    const lines = [name.slice(0, i), name.slice(i + 1)]
    const length = Math.max(lines[0].length, lines[1].length)
    if (length < longest) {
      best = lines
      longest = length
    }
  }
  return best
}

/** Which point of the text x is: its start, middle or end. */
type Anchor = 'start' | 'middle' | 'end'

/** A name placed on screen. A city's mark is at mx, my. */
interface Label {
  key: string
  kind: 'country' | 'city' | 'dot'
  lines: string[]
  x: number
  y: number
  anchor: Anchor
  mx?: number
  my?: number
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Where a name's text would sit, estimated from its letters, with room around it. */
function boxOf({ lines, x, y, anchor }: Label, size: number): Box {
  const width = Math.max(...lines.map((l) => l.length)) * size * LETTER_EM
  const height = lines.length * size * LINE_EM
  const left = anchor === 'start' ? x : anchor === 'middle' ? x - width / 2 : x - width
  return {
    left: left - NAME_ROOM,
    top: y - height / 2 - NAME_ROOM,
    right: left + width + NAME_ROOM,
    bottom: y + height / 2 + NAME_ROOM
  }
}

const overlap = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/**
 * The names to show in this view, placed in this order:
 * 1. the countries named at the whole world;
 * 2. job dots' cities, from DOT_NAME_ZOOM, right of the dot or else left of it;
 * 3. the other countries by rank;
 * 4. cities by rank.
 * A country name that is in the way moves a line down or up. A name outside the frame, or one that would still
 * cover a name already placed, is left out.
 */
function labelsFor(zoom: number, k: number, tx: number, ty: number, s: Size, dots: Dot[]): Label[] {
  const frame: Box = { left: 0, top: 0, right: s.width, bottom: s.height }
  const taken: Box[] = []
  const out: Label[] = []
  /** Places the first spot that is free. */
  const place = (spots: [Label, Box][]): void => {
    for (const [label, box] of spots) {
      if (!overlap(box, frame) || taken.some((t) => overlap(t, box))) continue
      taken.push(box)
      out.push(label)
      return
    }
  }

  const countries = countryLabels()
  const countryRank = WORLD_RANK + 2 * Math.log2(zoom)
  let next = 0
  const placeCountries = (upTo: number): void => {
    for (; next < countries.length && countries[next].rank <= upTo; next++) {
      const c = countries[next]
      const label: Label = {
        key: c.key,
        kind: 'country',
        lines: linesOf(c.text),
        x: tx + k * c.x,
        y: ty + k * c.y,
        anchor: 'middle'
      }
      const step = COUNTRY_SIZE * LINE_EM
      place(
        [label, { ...label, y: label.y + step }, { ...label, y: label.y - step }].map((l) => [
          l,
          boxOf(l, COUNTRY_SIZE)
        ])
      )
    }
  }

  placeCountries(Math.min(WORLD_RANK, countryRank))

  if (zoom >= DOT_NAME_ZOOM) {
    for (const d of dots) {
      if (d.place.city === null) continue
      const cx = tx + k * d.x
      const away = radius(d.n) + NAME_GAP
      const right: Label = {
        key: `d${d.key}`,
        kind: 'dot',
        lines: [d.place.city],
        x: cx + away,
        y: ty + k * d.y,
        anchor: 'start'
      }
      const left: Label = { ...right, x: cx - away, anchor: 'end' }
      place([right, left].map((l) => [l, boxOf(l, CITY_SIZE)]))
    }
  }

  placeCountries(countryRank)

  // The whole world names no city: by the rank rule alone it would name the 27 of rank 0.
  const cityRank = zoom > 1 ? 2 * Math.log2(zoom) : -1
  for (const c of cityLabels()) {
    if (c.rank > cityRank) break
    const mx = tx + k * c.x
    const my = ty + k * c.y
    const label: Label = {
      key: c.key,
      kind: 'city',
      lines: [c.text],
      x: mx + CITY_MARK + NAME_GAP,
      y: my,
      anchor: 'start',
      mx,
      my
    }
    place([[label, { ...boxOf(label, CITY_SIZE), left: mx - CITY_MARK }]])
  }
  return out
}

/** Names at a fixed size, drawn over the dots so a dot never hides one; clicks pass through them to the dots. */
function Labels({ labels, palette }: { labels: Label[]; palette: Palette }): React.JSX.Element {
  return (
    <g className="map-labels" stroke={palette.sea} pointerEvents="none" aria-hidden="true">
      {labels.map((l) => {
        if (l.kind === 'country') {
          const { lines, x } = l
          return (
            <text
              key={l.key}
              className="map-country"
              x={x}
              y={l.y}
              textAnchor={l.anchor}
              fontSize={COUNTRY_SIZE}
              fill={palette.country}
            >
              {lines.length === 1
                ? lines[0]
                : lines.map((line, i) => (
                    <tspan
                      key={i}
                      x={x}
                      dy={`${i === 0 ? (-(lines.length - 1) * LINE_EM) / 2 : LINE_EM}em`}
                    >
                      {line}
                    </tspan>
                  ))}
            </text>
          )
        }
        const city = l.kind === 'city'
        return (
          <g key={l.key}>
            {city && (
              <circle
                className="map-city-mark"
                cx={l.mx}
                cy={l.my}
                r={CITY_MARK}
                fill={palette.city}
              />
            )}
            <text
              className={city ? 'map-city' : 'map-dot-name'}
              x={l.x}
              y={l.y}
              textAnchor={l.anchor}
              fontSize={CITY_SIZE}
              fill={city ? palette.city : palette.dotName}
            >
              {l.lines[0]}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/** Pixels per projected unit when the whole world just fits. */
const fitScale = (s: Size): number =>
  Math.min(s.width / (WORLD_RIGHT - WORLD_LEFT), s.height / (WORLD_BOTTOM - WORLD_TOP))

/** The zoom within bounds; along a side the world doesn't fill it is centred, along one it does it stays on. */
function clampView(v: View, s: Size): View {
  const zoom = clamp(v.zoom, 1, MAX_ZOOM)
  const k = fitScale(s) * zoom
  const along = (c: number, low: number, high: number, pixels: number): number => {
    const half = pixels / (2 * k)
    return high - low <= 2 * half ? (low + high) / 2 : clamp(c, low + half, high - half)
  }
  return {
    x: along(v.x, WORLD_LEFT, WORLD_RIGHT, s.width),
    y: along(v.y, WORLD_TOP, WORLD_BOTTOM, s.height),
    zoom
  }
}

/** Every dot with 10% room around them; the whole world when there are none. */
function fitView(points: [number, number][], s: Size): View {
  if (points.length === 0) return WORLD_VIEW
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const [left, right] = [Math.min(...xs), Math.max(...xs)]
  const [top, bottom] = [Math.min(...ys), Math.max(...ys)]
  const width = (right - left) * (1 + 2 * FIT_PADDING)
  const height = (bottom - top) * (1 + 2 * FIT_PADDING)
  // Dots in one row or column set no limit along that side.
  const k = Math.min(
    width > 0 ? s.width / width : Infinity,
    height > 0 ? s.height / height : Infinity
  )
  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    zoom: Math.min(k / fitScale(s), FIT_MAX_ZOOM)
  }
}

/** Zoomed by `factor`, keeping the point under the pointer (px, py on the map) where it is. */
function zoomAbout(v: View, s: Size, px: number, py: number, factor: number): View {
  const k = fitScale(s) * v.zoom
  const dx = px - s.width / 2
  const dy = py - s.height / 2
  const zoom = clamp(v.zoom * factor, 1, MAX_ZOOM)
  const k2 = fitScale(s) * zoom
  return clampView({ x: v.x + dx / k - dx / k2, y: v.y + dy / k - dy / k2, zoom }, s)
}

/** Dragged by dx, dy pixels. */
function panned(v: View, s: Size, dx: number, dy: number): View {
  const k = fitScale(s) * v.zoom
  return clampView({ ...v, x: v.x - dx / k, y: v.y - dy / k }, s)
}

export function WorldMap({
  groups,
  onPick,
  picked
}: {
  groups: JobGroup[]
  onPick(place: PlaceKey | null): void
  picked: PlaceKey | null
}): React.JSX.Element {
  const svg = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState<Size>(DEFAULT_SIZE)
  const dots = useMemo(() => dotsOf(groups), [groups])
  // The first view fits the dots there were when the map opened, so a save that removes one doesn't move it.
  const [firstDots] = useState(() => dots.map((d): [number, number] => [d.x, d.y]))
  // Null until the owner zooms or drags: until then the first view follows the map's size.
  const [moved, setMoved] = useState<View | null>(null)
  const view = clampView(moved ?? fitView(firstDots, size), size)
  // The view on screen, for wheel steps that come faster than renders.
  const shown = useRef(view)
  const press = useRef<Press | null>(null)
  const dragged = useRef(false)

  useLayoutEffect(() => {
    shown.current = view
  })

  useLayoutEffect(() => {
    const el = svg.current
    if (!el) return
    const measure = (): void => {
      const r = el.getBoundingClientRect()
      // Not laid out (hidden, or in tests): keep the size there is.
      if (!(r.width > 0 && r.height > 0)) return
      setSize((s) =>
        s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // A native listener: React's wheel listener is passive, so it can't stop the page from scrolling.
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      const before = shown.current
      // Scrolling out of the whole world scrolls the page instead.
      if (e.deltaY > 0 && before.zoom <= 1) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const next = zoomAbout(
        before,
        size,
        e.clientX - r.left,
        e.clientY - r.top,
        Math.exp(-e.deltaY * WHEEL_STEP)
      )
      shown.current = next
      setMoved(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [size])

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return
    dragged.current = false
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, view }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (!dragged.current) {
      if (Math.hypot(dx, dy) < DRAG_START) return
      dragged.current = true
      // Captured only once it is a drag, so a plain click still reaches its dot.
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    setMoved(panned(p.view, size, dx, dy))
  }

  const onPointerEnd = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (press.current?.id === e.pointerId) press.current = null
  }

  // The click that ends a drag picks nothing.
  const pick = (key: PlaceKey | null): void => {
    if (!dragged.current) onPick(key)
  }

  const k = fitScale(size) * view.zoom
  const tx = size.width / 2 - k * view.x
  const ty = size.height / 2 - k * view.y
  const pickedDot = dots.find((d) => d.key === picked)
  const palette = useSyncExternalStore(onThemeChange, isDark) ? DARK : LIGHT
  const labels = useMemo(
    () => labelsFor(view.zoom, k, tx, ty, size, dots),
    [view.zoom, k, tx, ty, size, dots]
  )

  return (
    <div className="world-map">
      <div className="map-frame">
        <svg
          ref={svg}
          viewBox={`0 0 ${size.width} ${size.height}`}
          role="group"
          aria-label="World map of the jobs"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClick={() => pick(null)}
        >
          <rect className="map-sea" width={size.width} height={size.height} fill={palette.sea} />
          <g transform={`translate(${tx} ${ty}) scale(${k})`}>
            <Land palette={palette} />
          </g>
          {dots.map((d) => {
            const label = dotLabel(d)
            return (
              <circle
                key={d.key}
                className="map-dot"
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-pressed={d.key === picked}
                cx={tx + k * d.x}
                cy={ty + k * d.y}
                r={radius(d.n)}
                fill={d.colour}
                onClick={(e) => {
                  e.stopPropagation()
                  pick(d.key)
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  onPick(d.key)
                }}
              >
                <title>{label}</title>
              </circle>
            )
          })}
          <Labels labels={labels} palette={palette} />
          {/* A ring over the picked dot, on top of any dot that covers it. */}
          {pickedDot && (
            <circle
              className="map-picked"
              cx={tx + k * pickedDot.x}
              cy={ty + k * pickedDot.y}
              r={radius(pickedDot.n) + 3}
            />
          )}
        </svg>
        <button className="secondary map-reset" onClick={() => setMoved(WORLD_VIEW)}>
          Whole world
        </button>
      </div>
      <p className="map-credit">{ATTRIBUTION}</p>
    </div>
  )
}
