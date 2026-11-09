const A1 = 1.340264
const A2 = -0.081106
const A3 = 0.000893
const A4 = 0.003796
const M = Math.sqrt(3) / 2
const RADIANS = Math.PI / 180

/**
 * The Equal Earth projection (Šavrič, Patterson and Jenny, 2018) of a point in degrees, on a unit sphere and in
 * SVG orientation: x grows east, y grows south. The world spans about ±2.7067 across and ±1.3174 down.
 */
export function equalEarth(lon: number, lat: number): [number, number] {
  const l = lon * RADIANS
  const t = Math.asin(M * Math.sin(lat * RADIANS))
  const t2 = t * t
  const t6 = t2 * t2 * t2
  const x = (l * Math.cos(t)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)))
  const y = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))
  // `0 - y` rather than `-y`, so the equator is 0 and not -0.
  return [x, 0 - y]
}
