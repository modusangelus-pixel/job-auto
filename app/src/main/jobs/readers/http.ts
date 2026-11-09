import {
  BlockedError,
  type Fetcher,
  type FetchResult,
  type RequestOptions
} from '../../readers/fetcher'

function checked(url: string, r: FetchResult | null): string {
  if (r === null) {
    throw new BlockedError(new URL(url).host, 'robots.txt does not allow reading this page')
  }
  if (r.status >= 400) throw new Error(`HTTP ${r.status} from ${url}`)
  return r.body
}

export async function getText(
  fetcher: Fetcher,
  url: string,
  opts?: RequestOptions
): Promise<string> {
  return checked(url, await fetcher.get(url, opts))
}

/** A file as sent, for downloads such as spreadsheets; robots.txt and HTTP errors are handled as in getText. */
export async function getFile(
  fetcher: Fetcher,
  url: string,
  opts?: RequestOptions
): Promise<Buffer> {
  const r = await fetcher.getBytes(url, opts)
  if (r === null) {
    throw new BlockedError(new URL(url).host, 'robots.txt does not allow reading this page')
  }
  if (r.status >= 400) throw new Error(`HTTP ${r.status} from ${url}`)
  return r.bytes
}

export async function postJson(fetcher: Fetcher, url: string, body: unknown): Promise<unknown> {
  return JSON.parse(checked(url, await fetcher.post(url, body))) as unknown
}
