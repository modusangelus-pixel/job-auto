import { gzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { BlockedError, createFetcher, USER_AGENT } from '../../src/main/readers/fetcher'

type Route = { status: number; body: string | Uint8Array } | Error

function fakeFetch(routes: Record<string, Route | Route[]>): {
  fetchImpl: typeof fetch
  calls: { url: string; ua: string | null }[]
} {
  const calls: { url: string; ua: string | null }[] = []
  const queues = new Map(
    Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]])
  )
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    calls.push({ url, ua: headers.get('user-agent') })
    const q = queues.get(url)
    if (!q || q.length === 0) return new Response('', { status: 404 })
    const r = q.length > 1 ? q.shift()! : q[0]
    if (r instanceof Error) throw r
    return new Response(r.body as BodyInit, { status: r.status })
  }) as typeof fetch
  return { fetchImpl, calls }
}

const ROBOTS_OK = { status: 200, body: 'User-agent: *\nDisallow: /koszyk\n' }
const PAGE = { status: 200, body: '<html><body>product</body></html>' }

describe('polite fetcher', () => {
  test('disallowed by robots returns null and never requests the page', async () => {
    const { fetchImpl, calls } = fakeFetch({ 'https://shop.test/robots.txt': ROBOTS_OK })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    expect(await f.get('https://shop.test/koszyk/1')).toBeNull()
    expect(calls.map((c) => c.url)).toEqual(['https://shop.test/robots.txt'])
  })

  test('two requests to same host are spaced by delayMs', async () => {
    const { fetchImpl } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a': PAGE,
      'https://shop.test/b': PAGE
    })
    const sleeps: number[] = []
    let clock = 0
    const f = createFetcher({
      fetchImpl,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock += ms
      }
    })
    await f.get('https://shop.test/a')
    await f.get('https://shop.test/b')
    expect(Math.max(...sleeps)).toBeGreaterThanOrEqual(1500)
  })

  test('requests to one host made at the same time still go out delayMs apart', async () => {
    const { fetchImpl } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a': PAGE,
      'https://shop.test/b': PAGE,
      'https://shop.test/c': PAGE
    })
    const sleeps: number[] = []
    // The clock stands still, so each wait shows how far behind the robots.txt request that page was put.
    const f = createFetcher({
      fetchImpl,
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms)
      }
    })
    await Promise.all(['a', 'b', 'c'].map((p) => f.get(`https://shop.test/${p}`)))
    expect(sleeps.sort((x, y) => x - y)).toEqual([1500, 3000, 4500])
  })

  test("a robots.txt Crawl-delay for every bot spaces that host's requests further apart; another bot's does not", async () => {
    const run = async (robots: string): Promise<number> => {
      const { fetchImpl } = fakeFetch({
        'https://shop.test/robots.txt': { status: 200, body: robots },
        'https://shop.test/a': PAGE,
        'https://shop.test/b': PAGE
      })
      const sleeps: number[] = []
      let clock = 0
      const f = createFetcher({
        fetchImpl,
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms)
          clock += ms
        }
      })
      await f.get('https://shop.test/a')
      await f.get('https://shop.test/b')
      return Math.max(...sleeps)
    }
    expect(await run('User-agent: *\nCrawl-delay: 10\nDisallow: /koszyk\n')).toBe(10_000)
    expect(
      await run('User-agent: *\nDisallow: /koszyk\n\nUser-agent: MJ12Bot\nCrawl-delay: 30\n')
    ).toBe(1500)
  })

  test('a .gz sitemap sent as plain bytes comes back as its text', async () => {
    const xml =
      '<?xml version="1.0"?><urlset><url><loc>https://shop.test/pl/pl/kobieta</loc></url></urlset>'
    const calls: string[] = []
    const fetchImpl = (async (input: string | URL) => {
      calls.push(String(input))
      return String(input).endsWith('.gz')
        ? new Response(gzipSync(xml), { status: 200 })
        : new Response('', { status: 404 })
    }) as typeof fetch
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    expect((await f.get('https://shop.test/categories.xml.gz'))?.body).toBe(xml)
  })

  test('403 throws BlockedError', async () => {
    const { fetchImpl } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a': { status: 403, body: 'Forbidden' }
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    await expect(f.get('https://shop.test/a')).rejects.toBeInstanceOf(BlockedError)
  })

  test('429 throws BlockedError without retrying', async () => {
    const { fetchImpl, calls } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a': { status: 429, body: '' }
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    await expect(f.get('https://shop.test/a')).rejects.toBeInstanceOf(BlockedError)
    expect(calls.filter((c) => c.url === 'https://shop.test/a')).toHaveLength(1)
  })

  test('200 with captcha page throws BlockedError', async () => {
    const { fetchImpl } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a': { status: 200, body: '<html><div id="px-captcha"></div></html>' }
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    await expect(f.get('https://shop.test/a')).rejects.toBeInstanceOf(BlockedError)
  })

  test('large normal page mentioning recaptcha is not treated as blocked', async () => {
    const big = {
      status: 200,
      body: '<html>' + 'x'.repeat(60_000) + '<script src="recaptcha.js"></script></html>'
    }
    const { fetchImpl } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a': big
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    expect(await f.get('https://shop.test/a')).toEqual({ ...big, url: 'https://shop.test/a' })
  })

  test('a small page that loads recaptcha for a form is not blocked', async () => {
    const page = {
      status: 200,
      body: '<html><script>window.ENV={"GOOGLE_RECAPTCHA_SITE_KEY":"x"}</script><script src="https://www.google.com/recaptcha/api.js"></script><div class="g-recaptcha"></div>"jobPosts":{}</html>'
    }
    const { fetchImpl } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a': page
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    expect(await f.get('https://shop.test/a')).toEqual({ ...page, url: 'https://shop.test/a' })
  })

  test('a small JSON feed mentioning captcha is not blocked', async () => {
    const feed = {
      status: 200,
      body: ' \n[{"title":"Captcha solver are you a robot","note":"px-captcha"}]'
    }
    const { fetchImpl } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/feed': feed
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    expect(await f.get('https://shop.test/feed')).toEqual({
      ...feed,
      url: 'https://shop.test/feed'
    })
  })

  test("a small page carrying Cloudflare's bot-detection script is not blocked", async () => {
    const page = {
      status: 200,
      body: `<html><body>Careers<script>(function(){var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.head.appendChild(a)})();</script></body></html>`
    }
    const { fetchImpl } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a': page
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    expect(await f.get('https://shop.test/a')).toEqual({ ...page, url: 'https://shop.test/a' })
  })

  test.each([
    ['cf-challenge', '<div id="cf-challenge-running"></div>'],
    ['_cf_chl_opt', `<script>window._cf_chl_opt={cType:'managed'};</script>`],
    ['captcha-delivery', '<script src="https://ct.captcha-delivery.com/c.js"></script>'],
    ['are you a robot', '<h1>Are you a robot?</h1>']
  ])('a small challenge page (%s) throws BlockedError', async (marker, html) => {
    const { fetchImpl } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a': { status: 200, body: `<html>${html}</html>` }
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    const e = await f.get('https://shop.test/a').catch((err: unknown) => err)
    expect(e).toBeInstanceOf(BlockedError)
    expect((e as BlockedError).reason).toBe(`challenge page (${marker})`)
  })

  test('a robots.txt that answers 5xx fails the request, not as a block, and is asked for again next time', async () => {
    const { fetchImpl, calls } = fakeFetch({
      'https://shop.test/robots.txt': [{ status: 503, body: '' }, ROBOTS_OK],
      'https://shop.test/a': PAGE
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    const e = await f.get('https://shop.test/a').catch((err: unknown) => err)
    expect(e).toBeInstanceOf(Error)
    expect(e).not.toBeInstanceOf(BlockedError)
    expect((e as Error).message).toBe('robots.txt could not be read for shop.test')
    expect(calls.map((c) => c.url)).toEqual(['https://shop.test/robots.txt'])
    // The next request asks for robots.txt again, and this time it is read and obeyed.
    expect(await f.get('https://shop.test/a')).toEqual({ ...PAGE, url: 'https://shop.test/a' })
    expect(await f.get('https://shop.test/koszyk/1')).toBeNull()
    expect(calls.map((c) => c.url)).toEqual([
      'https://shop.test/robots.txt',
      'https://shop.test/robots.txt',
      'https://shop.test/a'
    ])
  })

  test('a robots.txt that cannot be reached fails the request and is asked for again next time', async () => {
    const { fetchImpl, calls } = fakeFetch({
      'https://shop.test/robots.txt': [new Error('ECONNRESET'), ROBOTS_OK],
      'https://shop.test/a': PAGE
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    await expect(f.get('https://shop.test/a')).rejects.toThrow(
      'robots.txt could not be read for shop.test'
    )
    expect(await f.get('https://shop.test/a')).toEqual({ ...PAGE, url: 'https://shop.test/a' })
    expect(calls.filter((c) => c.url.endsWith('/robots.txt'))).toHaveLength(2)
  })

  test('a robots.txt that times out fails the request and is asked for again next time', async () => {
    let robotsCalls = 0
    const fetchImpl = ((input: string | URL) => {
      if (String(input).endsWith('/robots.txt')) {
        robotsCalls++
        return robotsCalls === 1
          ? new Promise<Response>(() => {})
          : Promise.resolve(new Response('', { status: 404 }))
      }
      return Promise.resolve(new Response(PAGE.body, { status: 200 }))
    }) as typeof fetch
    const f = createFetcher({ fetchImpl, sleep: async () => {}, timeoutMs: 20 })
    await expect(f.get('https://shop.test/a')).rejects.toThrow(
      'robots.txt could not be read for shop.test'
    )
    expect((await f.get('https://shop.test/a'))?.status).toBe(200)
    expect(robotsCalls).toBe(2)
  })

  test('a 404 robots.txt allows everything and is asked for once', async () => {
    const { fetchImpl, calls } = fakeFetch({
      'https://shop.test/robots.txt': { status: 404, body: '' },
      'https://shop.test/a': PAGE,
      'https://shop.test/koszyk/1': PAGE
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    expect(await f.get('https://shop.test/a')).toEqual({ ...PAGE, url: 'https://shop.test/a' })
    expect(await f.get('https://shop.test/koszyk/1')).toEqual({
      ...PAGE,
      url: 'https://shop.test/koszyk/1'
    })
    expect(calls.filter((c) => c.url.endsWith('/robots.txt'))).toHaveLength(1)
  })

  test('500 then 200 retries once and returns 200', async () => {
    const { fetchImpl } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a': [{ status: 500, body: '' }, PAGE]
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    expect(await f.get('https://shop.test/a')).toEqual({ ...PAGE, url: 'https://shop.test/a' })
  })

  test('network error then 200 retries once', async () => {
    const { fetchImpl } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a': [new Error('ECONNRESET'), PAGE]
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    expect(await f.get('https://shop.test/a')).toEqual({ ...PAGE, url: 'https://shop.test/a' })
  })

  test('sends JOB-AUTO user agent', async () => {
    const { fetchImpl, calls } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a': PAGE
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    await f.get('https://shop.test/a')
    expect(USER_AGENT).toBe('JOB-AUTO/0.1 (personal job search)')
    expect(calls.every((c) => c.ua === USER_AGENT)).toBe(true)
  })

  test('a request that hangs is aborted after timeoutMs and retried once, then fails', async () => {
    let calls = 0
    const fetchImpl = ((input: string | URL, init?: RequestInit) => {
      if (String(input).endsWith('/robots.txt'))
        return Promise.resolve(new Response('', { status: 404 }))
      calls++
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }) as typeof fetch
    const f = createFetcher({ fetchImpl, sleep: async () => {}, timeoutMs: 20 })
    await expect(f.get('https://shop.test/slow')).rejects.toThrow()
    expect(calls).toBe(2)
  })

  test('a request that ignores the abort still ends at the deadline', async () => {
    const fetchImpl = ((input: string | URL) => {
      if (String(input).endsWith('/robots.txt'))
        return Promise.resolve(new Response('', { status: 404 }))
      return new Promise<Response>(() => {})
    }) as typeof fetch
    const f = createFetcher({ fetchImpl, sleep: async () => {}, timeoutMs: 20 })
    await expect(f.get('https://shop.test/stuck')).rejects.toThrow(/timed out/)
  })

  test('a page whose body stops arriving half-way ends at the deadline', async () => {
    const fetchImpl = ((input: string | URL) => {
      if (String(input).endsWith('/robots.txt'))
        return Promise.resolve(new Response('', { status: 404 }))
      const body = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('<html>half a page'))
        }
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    }) as typeof fetch
    const f = createFetcher({ fetchImpl, sleep: async () => {}, timeoutMs: 20 })
    await expect(f.get('https://shop.test/trickle')).rejects.toThrow(/timed out/)
  })

  test('missing robots.txt allows everything', async () => {
    const { fetchImpl } = fakeFetch({ 'https://shop.test/a': PAGE })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    expect(await f.get('https://shop.test/a')).toEqual({ ...PAGE, url: 'https://shop.test/a' })
  })

  test('reports the final address after a redirect', async () => {
    const fetchImpl = (async (input: string | URL) => {
      if (String(input).endsWith('/robots.txt')) return new Response('', { status: 404 })
      const res = new Response(PAGE.body, { status: 200 })
      Object.defineProperty(res, 'url', { value: 'https://acme.wd3.myworkdayjobs.com/External' })
      return res
    }) as typeof fetch
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    expect((await f.get('https://careers.acme.test/'))!.url).toBe(
      'https://acme.wd3.myworkdayjobs.com/External'
    )
  })

  test('falls back to the requested address when the response has none', async () => {
    const { fetchImpl } = fakeFetch({ 'https://careers.acme.test/': PAGE })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    expect((await f.get('https://careers.acme.test/'))!.url).toBe('https://careers.acme.test/')
  })

  test('post sends the JSON body with JSON headers and the user agent', async () => {
    const seen: { url: string; method?: string; headers: Headers; body?: unknown }[] = []
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: init?.body
      })
      return new Response(String(input).endsWith('/robots.txt') ? '' : '{"ok":true}', {
        status: String(input).endsWith('/robots.txt') ? 404 : 200
      })
    }) as typeof fetch
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    const r = await f.post('https://acme.test/jobs', { limit: 20, offset: 0 })
    expect(r).toEqual({ status: 200, body: '{"ok":true}', url: 'https://acme.test/jobs' })
    const call = seen.find((c) => c.url === 'https://acme.test/jobs')!
    expect(call.method).toBe('POST')
    expect(call.body).toBe('{"limit":20,"offset":0}')
    expect(call.headers.get('content-type')).toBe('application/json')
    expect(call.headers.get('accept')).toBe('application/json')
    expect(call.headers.get('user-agent')).toBe(USER_AGENT)
  })

  test('post to a path robots.txt disallows returns null and sends nothing', async () => {
    const { fetchImpl, calls } = fakeFetch({ 'https://shop.test/robots.txt': ROBOTS_OK })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    expect(await f.post('https://shop.test/koszyk/1', {})).toBeNull()
    expect(calls.map((c) => c.url)).toEqual(['https://shop.test/robots.txt'])
  })

  test('get and post to one host share the 1500 ms pace', async () => {
    const { fetchImpl } = fakeFetch({
      'https://shop.test/robots.txt': { status: 404, body: '' },
      'https://shop.test/a': PAGE,
      'https://shop.test/b': PAGE
    })
    const sleeps: number[] = []
    const f = createFetcher({
      fetchImpl,
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms)
      }
    })
    await f.get('https://shop.test/a')
    await f.post('https://shop.test/b', {})
    expect(sleeps).toEqual([1500, 3000])
  })
  test('getBytes returns the bytes as sent', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00])
    const { fetchImpl } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a.png': { status: 200, body: png }
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    const r = await f.getBytes('https://shop.test/a.png')
    expect(r?.status).toBe(200)
    expect(r?.url).toBe('https://shop.test/a.png')
    expect(Buffer.compare(r!.bytes, Buffer.from(png))).toBe(0)
  })

  test('getBytes does not gunzip and does not run the challenge check', async () => {
    const gz = gzipSync('hello')
    const { fetchImpl } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a.gz': { status: 200, body: gz },
      'https://shop.test/b': { status: 200, body: 'px-captcha' }
    })
    const f = createFetcher({ fetchImpl, sleep: async () => {} })
    expect(Buffer.compare((await f.getBytes('https://shop.test/a.gz'))!.bytes, gz)).toBe(0)
    expect((await f.getBytes('https://shop.test/b'))!.bytes.toString()).toBe('px-captcha')
  })

  test('getBytes obeys robots.txt and the pace', async () => {
    const { fetchImpl, calls } = fakeFetch({
      'https://shop.test/robots.txt': ROBOTS_OK,
      'https://shop.test/a.bin': { status: 200, body: new Uint8Array([1, 2, 3]) },
      'https://shop.test/b.bin': { status: 403, body: '' }
    })
    const sleeps: number[] = []
    let clock = 0
    const f = createFetcher({
      fetchImpl,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock += ms
      }
    })
    expect(await f.getBytes('https://shop.test/koszyk/x.bin')).toBeNull()
    expect(calls.map((c) => c.url)).toEqual(['https://shop.test/robots.txt'])
    await f.getBytes('https://shop.test/a.bin')
    expect(Math.max(...sleeps)).toBeGreaterThanOrEqual(1500)
    await expect(f.getBytes('https://shop.test/b.bin')).rejects.toBeInstanceOf(BlockedError)
  })

  test("a request's own timeoutMs replaces the default", async () => {
    let aborted = false
    const fetchImpl = ((input: string | URL, init?: RequestInit) => {
      if (String(input).endsWith('/robots.txt'))
        return Promise.resolve(new Response('', { status: 404 }))
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new Error('aborted'))
        })
      })
    }) as typeof fetch
    const f = createFetcher({ fetchImpl, sleep: async () => {}, timeoutMs: 60_000 })
    await expect(f.get('https://shop.test/slow', { timeoutMs: 20 })).rejects.toThrow(/timed out/)
    await expect(f.getBytes('https://shop.test/slow2', { timeoutMs: 20 })).rejects.toThrow(
      /timed out/
    )
    expect(aborted).toBe(true)
  })
  describe('permits (for pages loaded outside the fetcher)', () => {
    test('a path robots.txt forbids is refused and nothing but robots.txt is asked for', async () => {
      const { fetchImpl, calls } = fakeFetch({ 'https://shop.test/robots.txt': ROBOTS_OK })
      const f = createFetcher({ fetchImpl, sleep: async () => {} })
      expect(await f.permits('https://shop.test/koszyk/1')).toBe(false)
      expect(calls.map((c) => c.url)).toEqual(['https://shop.test/robots.txt'])
    })

    test('an allowed path books the pace slot: the next request to that host waits delayMs', async () => {
      const { fetchImpl, calls } = fakeFetch({
        'https://shop.test/robots.txt': ROBOTS_OK,
        'https://shop.test/a': PAGE
      })
      const sleeps: number[] = []
      let clock = 0
      const f = createFetcher({
        fetchImpl,
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms)
          clock += ms
        }
      })
      expect(await f.permits('https://shop.test/careers')).toBe(true)
      // permits waited for its own slot after robots.txt, and loaded nothing itself.
      expect(sleeps).toEqual([1500])
      expect(calls.map((c) => c.url)).toEqual(['https://shop.test/robots.txt'])
      await f.get('https://shop.test/a')
      expect(sleeps).toEqual([1500, 1500])
    })

    test('a robots.txt that cannot be read refuses by failing', async () => {
      const { fetchImpl } = fakeFetch({ 'https://shop.test/robots.txt': { status: 503, body: '' } })
      const f = createFetcher({ fetchImpl, sleep: async () => {} })
      await expect(f.permits('https://shop.test/careers')).rejects.toThrow(
        'robots.txt could not be read for shop.test'
      )
    })
  })
})
