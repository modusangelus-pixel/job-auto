import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  BytesResult,
  FetchResult,
  Fetcher,
  RequestOptions
} from '../../src/main/readers/fetcher'

export function fixture(name: string): Buffer {
  return readFileSync(join(__dirname, '../fixtures/sponsors', name))
}

export function fixtureText(name: string): string {
  return fixture(name).toString('utf8')
}

export interface Call {
  method: 'get' | 'getBytes'
  url: string
  timeoutMs: number | undefined
}

/** A fetcher that serves text (get) and files (getBytes) by URL, records every call, and fails the test on a POST. */
export function fakeFetcher(routes: Record<string, string | Buffer>): {
  fetcher: Fetcher
  calls: Call[]
} {
  const calls: Call[] = []
  const fetcher: Fetcher = {
    async get(url: string, opts?: RequestOptions): Promise<FetchResult | null> {
      calls.push({ method: 'get', url, timeoutMs: opts?.timeoutMs })
      const r = routes[url]
      if (r === undefined) return { status: 404, body: '', url }
      return { status: 200, body: r.toString(), url }
    },
    async post(): Promise<FetchResult | null> {
      throw new Error('post must not be called')
    },
    async getBytes(url: string, opts?: RequestOptions): Promise<BytesResult | null> {
      calls.push({ method: 'getBytes', url, timeoutMs: opts?.timeoutMs })
      const r = routes[url]
      if (r === undefined) return { status: 404, bytes: Buffer.alloc(0), url }
      return { status: 200, bytes: Buffer.from(r), url }
    }
  }
  return { fetcher, calls }
}
