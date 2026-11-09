import { countryCode } from '../location'

/** An ISO string for a date value (text or epoch ms), null when it is missing or not a date. */
export function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Unique alpha-2 codes from country names or codes, in order; values countryCode can't map are dropped. */
export function codesFrom(values: unknown[]): string[] {
  const out: string[] = []
  for (const v of values) {
    if (typeof v !== 'string') continue
    const code = countryCode(v)
    if (code && !out.includes(code)) out.push(code)
  }
  return out
}

/** A field as trimmed text; '' when it is neither text nor a number. */
export function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str).filter((s) => s !== '') : []
}

export function unique(values: string[]): string[] {
  return [...new Set(values)]
}

/** A JSON feed body parsed; anything that is not JSON means the feed was not understood. */
export function parseFeed(body: string, url: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`Job list not recognised on ${url}`)
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

/**
 * The JSON array or object that starts at `start` (a `[` or `{`) in a page's script, found by matching brackets
 * outside strings; null when there is none there or it doesn't parse.
 */
export function jsonAt(text: string, start: number): unknown {
  const open = text[start]
  if (open !== '[' && open !== '{') return null
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '[' || c === '{') depth++
    else if ((c === ']' || c === '}') && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1)) as unknown
      } catch {
        return null
      }
    }
  }
  return null
}

/** The text of an HTML fragment: tags dropped, entities decoded, runs of white space made one space. */
export function htmlText(html: string): string {
  return decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** HTML/XML entities decoded in one pass, so "&amp;apos;" becomes "&apos;"; unknown ones are left as they are. */
export function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1].toLowerCase() === 'x'
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}
