import { gunzipSync } from 'node:zlib'
import robotsParser from 'robots-parser'

export const USER_AGENT = 'JOB-AUTO/0.1 (personal job search)'
const DEFAULT_DELAY_MS = 1500
const DEFAULT_TIMEOUT_MS = 30_000

// Challenge interstitials are small pages, so markers are only checked on short bodies. Normal pages often load
// reCAPTCHA for a form, so bare "captcha" is no marker; nor is Cloudflare's "challenge-platform", whose
// bot-detection script Cloudflare also adds to normal pages (its challenge pages set _cf_chl_opt).
const CHALLENGE_MARKERS = [
  'px-captcha',
  'cf-challenge',
  '_cf_chl_opt',
  'captcha-delivery',
  '_abck',
  'are you a robot'
]
const CHALLENGE_MAX_BODY = 50_000
// Job feeds and Workday details are JSON, never a challenge page.
const LOOKS_LIKE_JSON = /^\s*[[{]/

export class BlockedError extends Error {
  constructor(
    public host: string,
    public reason: string
  ) {
    super(`${host} blocked: ${reason}`)
    this.name = 'BlockedError'
  }
}

export interface FetchResult {
  status: number
  body: string
  /** The address the response came from, after any redirects. */
  url: string
}

export interface BytesResult {
  status: number
  bytes: Buffer
  /** The address the response came from, after any redirects. */
  url: string
}

/** `timeoutMs` replaces the fetcher's default wait for this one request. */
export interface RequestOptions {
  timeoutMs?: number
}

export interface Fetcher {
  /** null = disallowed by robots.txt */
  get(url: string, opts?: RequestOptions): Promise<FetchResult | null>
  /** Sends `json` as the request body. null = disallowed by robots.txt */
  post(url: string, json: unknown): Promise<FetchResult | null>
  /** A file as sent: no gunzip, no text decoding, no challenge-page check. null = disallowed by robots.txt */
  getBytes(url: string, opts?: RequestOptions): Promise<BytesResult | null>
  /**
   * For a page loaded outside the fetcher (the hidden window): false when robots.txt forbids it; otherwise waits
   * for the host's pace slot, books it and returns true. Fails when robots.txt can't be read.
   */
  permits(url: string): Promise<boolean>
}

interface RequestInitLite {
  method?: string
  headers?: Record<string, string>
  body?: string
}

interface Robots {
  isAllowed(url: string, ua?: string): boolean | undefined
  getCrawlDelay(ua?: string): number | undefined
}

// Requests under way in this thread, by URL, with their start time: the refresh log reports them, so a stalled
// refresh shows what it is waiting for.
const inFlight = new Map<string, number>()

/** A response as text; sitemaps are often .gz files sent as plain bytes rather than gzip-encoded responses. */
function bodyText(bytes: Buffer): string {
  return (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString('utf8')
}

/** Requests under way right now and how many seconds each has been waiting. */
export function requestsInFlight(): { url: string; seconds: number }[] {
  return [...inFlight].map(([url, start]) => ({
    url,
    seconds: Math.round((Date.now() - start) / 1000)
  }))
}

export function createFetcher(opts?: {
  delayMs?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): Fetcher {
  const delayMs = opts?.delayMs ?? DEFAULT_DELAY_MS
  const defaultTimeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = opts?.fetchImpl ?? fetch
  const now = opts?.now ?? Date.now
  const sleep = opts?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const lastRequestAt = new Map<string, number>()
  const robotsByHost = new Map<string, Promise<Robots | null>>()
  // A host whose robots.txt asks for a longer Crawl-delay gets that pause instead.
  const delayByHost = new Map<string, number>()

  /** Waits for the host's next pace slot. The time is booked before waiting, so requests made side by side still
   * reach a host a delay apart. */
  async function waitForSlot(host: string): Promise<void> {
    const last = lastRequestAt.get(host)
    const slot =
      last === undefined ? now() : Math.max(now(), last + (delayByHost.get(host) ?? delayMs))
    lastRequestAt.set(host, slot)
    const wait = slot - now()
    if (wait > 0) await sleep(wait)
  }

  async function politeRequest(
    url: string,
    init?: RequestInitLite,
    timeoutMs: number = defaultTimeoutMs
  ): Promise<BytesResult> {
    await waitForSlot(new URL(url).host)
    // A hung connection, or a body that stops arriving, must not stall a whole shop refresh. A plain timer
    // aborts the request and stops waiting for it: a refresh in the app once hung with AbortSignal.timeout alone.
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error(`${url} timed out after ${timeoutMs / 1000} s`))
      }, timeoutMs)
    })
    inFlight.set(url, Date.now())
    const request = (async (): Promise<BytesResult> => {
      const res = await fetchImpl(url, {
        method: init?.method,
        headers: { 'user-agent': USER_AGENT, ...init?.headers },
        body: init?.body,
        signal: controller.signal
      })
      return {
        status: res.status,
        bytes: Buffer.from(await res.arrayBuffer()),
        url: res.url || url
      }
    })()
    // The request may still reject after the deadline won; that rejection is expected and ignored.
    request.catch(() => {})
    try {
      return await Promise.race([request, deadline])
    } finally {
      clearTimeout(timer)
      inFlight.delete(url)
    }
  }

  /**
   * The host's robots.txt; null when it has none (a 4xx answer), which allows everything. A robots.txt that
   * can't be reached (network error, timeout or 5xx) allows nothing (RFC 9309): the request fails, and the next
   * request asks for robots.txt again.
   */
  function robotsFor(url: string): Promise<Robots | null> {
    const u = new URL(url)
    let p = robotsByHost.get(u.host)
    if (!p) {
      const robotsUrl = `${u.protocol}//${u.host}/robots.txt`
      const unreadable = (): Error => new Error(`robots.txt could not be read for ${u.host}`)
      const asked: Promise<Robots | null> = politeRequest(robotsUrl).then(
        (r) => {
          if (r.status >= 500) throw unreadable()
          if (r.status !== 200) return null
          const robots = robotsParser(robotsUrl, bodyText(r.bytes)) as Robots
          const crawlDelay = robots.getCrawlDelay(USER_AGENT)
          if (crawlDelay) delayByHost.set(u.host, Math.max(delayMs, crawlDelay * 1000))
          return robots
        },
        () => {
          throw unreadable()
        }
      )
      asked.catch(() => {
        if (robotsByHost.get(u.host) === asked) robotsByHost.delete(u.host)
      })
      robotsByHost.set(u.host, asked)
      p = asked
    }
    return p
  }

  function checkBlocked(url: string, status: number): void {
    if (status === 403 || status === 429)
      throw new BlockedError(new URL(url).host, `HTTP ${status}`)
  }

  function checkChallenge(url: string, body: string): void {
    if (body.length > CHALLENGE_MAX_BODY || LOOKS_LIKE_JSON.test(body)) return
    const lower = body.toLowerCase()
    const marker = CHALLENGE_MARKERS.find((m) => lower.includes(m))
    if (marker) throw new BlockedError(new URL(url).host, `challenge page (${marker})`)
  }

  /** Both reading modes share this: robots, pace, one retry, BlockedError on 403/429. */
  async function request(
    url: string,
    init?: RequestInitLite,
    timeoutMs?: number,
    // For text, a challenge page is a block too, and is checked on the first answer and on the retry.
    isChallenge?: (r: BytesResult) => void
  ): Promise<BytesResult | null> {
    const robots = await robotsFor(url)
    if (robots && robots.isAllowed(url, USER_AGENT) === false) return null
    let r: BytesResult
    try {
      r = await politeRequest(url, init, timeoutMs)
    } catch {
      await sleep(delayMs)
      r = await politeRequest(url, init, timeoutMs)
    }
    checkBlocked(url, r.status)
    isChallenge?.(r)
    if (r.status >= 500) {
      await sleep(delayMs)
      r = await politeRequest(url, init, timeoutMs)
      checkBlocked(url, r.status)
      isChallenge?.(r)
    }
    return r
  }

  async function requestText(
    url: string,
    init?: RequestInitLite,
    timeoutMs?: number
  ): Promise<FetchResult | null> {
    let body = ''
    const r = await request(url, init, timeoutMs, (x) => {
      body = bodyText(x.bytes)
      checkChallenge(url, body)
    })
    return r && { status: r.status, body, url: r.url }
  }

  return {
    get: (url, o) => requestText(url, undefined, o?.timeoutMs),
    post: (url, json) =>
      requestText(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(json)
      }),
    getBytes: (url, o) => request(url, undefined, o?.timeoutMs),
    async permits(url) {
      const robots = await robotsFor(url)
      if (robots && robots.isAllowed(url, USER_AGENT) === false) return false
      await waitForSlot(new URL(url).host)
      return true
    }
  }
}
