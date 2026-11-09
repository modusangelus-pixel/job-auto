import { describe, expect, test } from 'vitest'
import { checkCareers } from '../../src/main/careers/check'
import { BlockedError, type FetchResult, type Fetcher } from '../../src/main/readers/fetcher'

type Reply = FetchResult | null | Error

/** A fetcher with no network: it records the URLs it was asked for and answers each from `reply`. */
function fakeFetcher(reply: Reply | ((url: string) => Reply)): Fetcher & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async post() {
      throw new Error('these tests never POST')
    },
    async getBytes() {
      throw new Error('these tests never download files')
    },
    async get(url) {
      calls.push(url)
      const r = typeof reply === 'function' ? reply(url) : reply
      if (r instanceof Error) throw r
      return r
    }
  }
}

/** A fetcher that fails the test if it is asked for anything. */
const fetcherThatFails = (): Fetcher & { calls: string[] } =>
  fakeFetcher(() => {
    throw new Error('no request expected')
  })

const page = (body: string, url = 'https://acme.com/careers', status = 200): FetchResult => ({
  status,
  body,
  url
})

describe('checkCareers', () => {
  test('no links: not found', async () => {
    const f = fakeFetcher(page(''))
    expect(await checkCareers(f, null, null, 'acquired by X')).toEqual({
      careersUrl: null,
      jobsUrl: null,
      status: 'not_found',
      jobBoard: null,
      note: 'acquired by X',
      error: null
    })
    expect(f.calls).toEqual([])
  })

  test('a jobs link on a job system: read directly, without fetching anything', async () => {
    const f = fakeFetcher(page(''))
    const r = await checkCareers(
      f,
      'https://waymo.com/careers',
      'https://boards.greenhouse.io/waymo',
      null
    )
    expect(r).toEqual({
      careersUrl: 'https://waymo.com/careers',
      jobsUrl: 'https://boards.greenhouse.io/waymo',
      status: 'direct',
      jobBoard: { system: 'greenhouse', board: 'waymo' },
      note: null,
      error: null
    })
    expect(f.calls).toEqual([])
  })

  test('a careers link on a job system, with no jobs link: read directly too', async () => {
    const f = fakeFetcher(page(''))
    const r = await checkCareers(f, 'https://jobs.lever.co/nuro', null, 'found by Claude')
    expect(r).toMatchObject({
      status: 'direct',
      jobBoard: { system: 'lever', board: 'nuro' },
      jobsUrl: null,
      note: 'found by Claude'
    })
    expect(f.calls).toEqual([])
  })

  test('both links on job systems: the jobs link decides the board', async () => {
    const r = await checkCareers(
      fakeFetcher(page('')),
      'https://jobs.lever.co/one',
      'https://boards.greenhouse.io/two',
      null
    )
    expect(r.jobBoard).toEqual({ system: 'greenhouse', board: 'two' })
  })

  test('the jobs link is the page fetched when there is one, else the careers link', async () => {
    const both = fakeFetcher(page('<html></html>'))
    await checkCareers(both, 'https://acme.com/careers', 'https://acme.com/jobs', null)
    expect(both.calls).toEqual(['https://acme.com/jobs'])
    const careersOnly = fakeFetcher(page('<html></html>'))
    await checkCareers(careersOnly, 'https://acme.com/careers', null, null)
    expect(careersOnly.calls).toEqual(['https://acme.com/careers'])
    const jobsOnly = fakeFetcher(page('<html></html>'))
    await checkCareers(jobsOnly, null, 'https://acme.com/jobs', null)
    expect(jobsOnly.calls).toEqual(['https://acme.com/jobs'])
  })

  test('robots.txt forbids the page: blocked', async () =>
    expect(await checkCareers(fakeFetcher(null), 'https://acme.com/careers', null, null)).toEqual({
      careersUrl: 'https://acme.com/careers',
      jobsUrl: null,
      status: 'blocked',
      jobBoard: null,
      note: null,
      error: 'robots.txt does not allow reading this page'
    }))

  test('the site refuses the reader: blocked, with the reason', async () =>
    expect(
      await checkCareers(
        fakeFetcher(new BlockedError('acme.com', 'HTTP 403')),
        'https://acme.com/careers',
        null,
        'a note'
      )
    ).toMatchObject({ status: 'blocked', error: 'HTTP 403', note: 'a note' }))

  test('a redirect to Workday: read directly, from the one page fetched', async () => {
    const f = fakeFetcher(page('<html></html>', 'https://acme.wd3.myworkdayjobs.com/External'))
    const r = await checkCareers(f, 'https://acme.com/careers', null, null)
    expect(r).toMatchObject({
      status: 'direct',
      jobBoard: { system: 'workday', board: 'acme.wd3/External' },
      // The stored links stay as given; only the board comes from where the redirect ended.
      careersUrl: 'https://acme.com/careers',
      error: null
    })
    expect(f.calls).toEqual(['https://acme.com/careers'])
  })

  test('a job system embedded in the page: read directly', async () => {
    const body =
      '<html><body><iframe src="https://boards.greenhouse.io/embed/job_board?for=acme&amp;b=x"></iframe></body></html>'
    const r = await checkCareers(fakeFetcher(page(body)), 'https://acme.com/careers', null, null)
    expect(r).toMatchObject({
      status: 'direct',
      jobBoard: { system: 'greenhouse', board: 'acme' },
      error: null
    })
  })

  test('a page with no known job system: needs Claude reading', async () => {
    const r = await checkCareers(
      fakeFetcher(page('<html><body>Join us! Email jobs@acme.com</body></html>')),
      'https://acme.com/careers',
      null,
      'a note'
    )
    expect(r).toEqual({
      careersUrl: 'https://acme.com/careers',
      jobsUrl: null,
      status: 'needs_claude',
      jobBoard: null,
      note: 'a note',
      error: null
    })
  })

  test('HTTP 404: needs Claude reading with the error "HTTP 404"', async () => {
    // Even an error page that happens to mention a job system is not read for one.
    const r = await checkCareers(
      fakeFetcher(page('<a href="https://boards.greenhouse.io/acme">jobs</a>', undefined, 404)),
      'https://acme.com/careers',
      null,
      null
    )
    expect(r).toMatchObject({ status: 'needs_claude', error: 'HTTP 404', jobBoard: null })
  })

  test('a network error: needs Claude reading with its message', async () => {
    const r = await checkCareers(
      fakeFetcher(new Error('getaddrinfo ENOTFOUND acme.com')),
      'https://acme.com/careers',
      null,
      null
    )
    expect(r).toMatchObject({
      status: 'needs_claude',
      error: 'getaddrinfo ENOTFOUND acme.com',
      jobBoard: null
    })
  })

  describe('when the jobs link cannot be read, the careers page is checked instead', () => {
    const JOBS = 'https://acme.com/jobs'
    const CAREERS = 'https://acme.com/careers'
    const GREENHOUSE =
      '<html><body><iframe src="https://boards.greenhouse.io/embed/job_board?for=acme"></iframe></body></html>'
    /** The jobs link answers `jobs`, the careers link `careers`. */
    const byLink = (jobs: Reply, careers: Reply): ReturnType<typeof fakeFetcher> =>
      fakeFetcher((url) => (url === JOBS ? jobs : careers))

    test('robots.txt forbids the jobs link, the careers page is readable: needs Claude reading', async () => {
      const f = byLink(null, page('<html><body>Join us!</body></html>', CAREERS))
      expect(await checkCareers(f, CAREERS, JOBS, 'a note')).toEqual({
        careersUrl: CAREERS,
        jobsUrl: JOBS,
        status: 'needs_claude',
        jobBoard: null,
        note: 'a note',
        error: null
      })
      expect(f.calls).toEqual([JOBS, CAREERS])
    })

    test('the careers HTML embeds a job system: read directly', async () => {
      const f = byLink(null, page(GREENHOUSE, CAREERS))
      expect(await checkCareers(f, CAREERS, JOBS, null)).toMatchObject({
        status: 'direct',
        jobBoard: { system: 'greenhouse', board: 'acme' },
        error: null
      })
      expect(f.calls).toEqual([JOBS, CAREERS])
    })

    test('a jobs link the site refuses to the reader falls back too', async () => {
      const f = byLink(new BlockedError('acme.com', 'HTTP 403'), page(GREENHOUSE, CAREERS))
      expect(await checkCareers(f, CAREERS, JOBS, null)).toMatchObject({
        status: 'direct',
        error: null
      })
    })

    test('a 404 jobs link falls back', async () => {
      const f = byLink(page('Not found', JOBS, 404), page(GREENHOUSE, CAREERS))
      expect(await checkCareers(f, CAREERS, JOBS, null)).toMatchObject({
        status: 'direct',
        jobBoard: { system: 'greenhouse', board: 'acme' },
        error: null
      })
      expect(f.calls).toEqual([JOBS, CAREERS])
    })

    test('a network error on the jobs link falls back', async () => {
      const f = byLink(new Error('getaddrinfo ENOTFOUND acme.com'), page(GREENHOUSE, CAREERS))
      expect(await checkCareers(f, CAREERS, JOBS, null)).toMatchObject({
        status: 'direct',
        error: null
      })
    })

    test('both links blocked: blocked, with the reason of the careers page, one fetch each', async () => {
      const robots = byLink(null, null)
      expect(await checkCareers(robots, CAREERS, JOBS, null)).toMatchObject({
        status: 'blocked',
        error: 'robots.txt does not allow reading this page'
      })
      expect(robots.calls).toEqual([JOBS, CAREERS])

      const refused = byLink(null, new BlockedError('acme.com', 'HTTP 403'))
      expect(await checkCareers(refused, CAREERS, JOBS, null)).toMatchObject({
        status: 'blocked',
        error: 'HTTP 403'
      })
    })

    test('the status comes from the careers page, so blocked only when that page is blocked', async () => {
      const f = byLink(null, page('Not found', CAREERS, 404))
      expect(await checkCareers(f, CAREERS, JOBS, null)).toMatchObject({
        status: 'needs_claude',
        error: 'HTTP 404'
      })
    })

    test('no careers link, or the same link: no second fetch', async () => {
      const jobsOnly = fakeFetcher(null)
      expect(await checkCareers(jobsOnly, null, JOBS, null)).toMatchObject({ status: 'blocked' })
      expect(jobsOnly.calls).toEqual([JOBS])

      const same = fakeFetcher(null)
      expect(await checkCareers(same, JOBS, JOBS, null)).toMatchObject({ status: 'blocked' })
      expect(same.calls).toEqual([JOBS])
    })

    test('a jobs page that is read, but shows no job system, does not fall back', async () => {
      const f = byLink(page('<html>Join us!</html>', JOBS), page(GREENHOUSE, CAREERS))
      expect(await checkCareers(f, CAREERS, JOBS, null)).toMatchObject({ status: 'needs_claude' })
      expect(f.calls).toEqual([JOBS])
    })

    test('a redirect target of the careers page is not fetched either', async () => {
      const f = byLink(null, page('<html></html>', 'https://other.example/careers'))
      await checkCareers(f, CAREERS, JOBS, null)
      expect(f.calls).toEqual([JOBS, CAREERS])
    })
  })

  test('a SmartRecruiters board is blocked with the reason', async () => {
    const f = fetcherThatFails()
    const r = await checkCareers(f, null, 'https://jobs.smartrecruiters.com/BoschGroup', null)
    expect(r).toMatchObject({
      status: 'blocked',
      jobBoard: { system: 'smartrecruiters', board: 'BoschGroup' },
      error: 'SmartRecruiters does not allow automated reading of its job feed (robots.txt)'
    })
    expect(f.calls).toEqual([])
  })

  test('a SmartRecruiters board found by reading a page is blocked too', async () => {
    const f = fakeFetcher(page('<a href="https://jobs.smartrecruiters.com/BoschGroup">jobs</a>'))
    const r = await checkCareers(f, 'https://acme.com/careers', null, null)
    expect(r).toMatchObject({
      status: 'blocked',
      jobBoard: { system: 'smartrecruiters', board: 'BoschGroup' }
    })
  })
})
