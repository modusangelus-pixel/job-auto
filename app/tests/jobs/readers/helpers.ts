import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BlockedError, type FetchResult, type Fetcher } from '../../../src/main/readers/fetcher'

export function fixture(name: string): string {
  return readFileSync(join(__dirname, '../../fixtures/jobs', name), 'utf8')
}

/** A fetcher that serves bodies by URL (a number is an HTTP status with an empty body, null is robots.txt), records the URLs and fails the test on a POST. */
export function fakeFetcher(routes: Record<string, string | number | null>): {
  fetcher: Fetcher
  urls: string[]
} {
  const urls: string[] = []
  const fetcher: Fetcher = {
    async get(url): Promise<FetchResult | null> {
      urls.push(url)
      const r = routes[url]
      if (r === undefined) return { status: 404, body: '', url }
      if (r === null) return null
      if (typeof r === 'number') return { status: r, body: '', url }
      return { status: 200, body: r, url }
    },
    async post(): Promise<FetchResult | null> {
      throw new Error('post must not be called')
    },
    async getBytes() {
      throw new Error('getBytes must not be called')
    },
    // robots.txt forbids an address routed to null; permits is no request, so it is not recorded.
    async permits(url) {
      return routes[url] !== null
    }
  }
  return { fetcher, urls }
}

export async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('expected a rejection')
}

export { BlockedError }
