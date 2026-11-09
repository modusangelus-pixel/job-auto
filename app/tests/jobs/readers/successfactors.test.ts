import { describe, expect, test } from 'vitest'
import { successfactors } from '../../../src/main/jobs/readers/successfactors'
import { BlockedError, fakeFetcher, fixture, rejection } from './helpers'

const NOW = new Date(2026, 10, 5, 12, 0, 0)
const BOARD = 'jobs.example.com'
const DAY = new Date(2026, 10, 5).toISOString()

function searchUrl(board: string, startrow: number): string {
  return `https://${board}/search/?q=&startrow=${startrow}`
}

function notRecognised(board: string, startrow: number): string {
  return `Job list not recognised on ${searchUrl(board, startrow)}`
}

function tableRow(
  id: number,
  over: { title?: string; location?: string; date?: string; href?: string } = {}
): string {
  const title = over.title ?? `Job ${id}`
  const href = over.href ?? `/job/Oslo-Job-${id}/${id}/`
  const date =
    over.date === undefined
      ? ''
      : `<td class="colDate"><span class="jobDate">${over.date}</span></td>`
  return `<tr class="data-row"><td class="colTitle"><span class="jobTitle hidden-phone"><a href="${href}" class="jobTitle-link">${title}</a></span><div class="jobdetail-phone"><span class="jobLocation visible-phone"><span class="jobLocation">Phone, NO</span></span></div></td><td class="colLocation hidden-phone"><span class="jobLocation">${over.location ?? 'Oslo, NO'}</span></td>${date}</tr>`
}

function tableHtml(rows: string, label: string | null): string {
  const lab = label === null ? '' : `<span class="paginationLabel">${label}</span>`
  return `<html><body>${lab}<table id="searchresults"><tbody>${rows}</tbody></table></body></html>`
}

/** A table-template page with rows for ids from..from+count-1. */
function tablePage(from: number, count: number, label: string | null): string {
  const rows = Array.from({ length: count }, (_, i) => tableRow(from + i)).join('\n')
  return tableHtml(rows, label)
}

function tileLi(id: number): string {
  return `<li class="job-tile job-id-${id}" data-url="/job/Lund-Tile-${id}/${id}/"><a class="jobTitle-link" href="/job/Lund-Tile-${id}/${id}/">Tile ${id}</a><div id="job-${id}-desktop-section-location-value">Lund, SE</div><div id="job-${id}-desktop-section-date-value">Nov 5, 2026</div></li>`
}

function tilePage(from: number, count: number, showing: string | null): string {
  const rows = Array.from({ length: count }, (_, i) => tileLi(from + i)).join('\n')
  const text = showing === null ? '' : `<span id="tile-search-results-label">${showing}</span>`
  return `<html><body>${text}<ul id="job-tile-list" data-per-page="2">${rows}</ul></body></html>`
}

describe('successfactors reader', () => {
  test('reads the Volvo table fixture', async () => {
    const board = 'jobs.volvogroup.com'
    const page = fixture('sf-volvo.html').replace('of <b>427</b>', 'of <b>3</b>')
    const { fetcher, urls } = fakeFetcher({ [searchUrl(board, 0)]: page })
    const r = await successfactors.list(fetcher, board, NOW)
    expect(urls).toEqual([searchUrl(board, 0)])
    expect(r.jobs).toHaveLength(3)
    expect(r.jobs[0]).toEqual({
      sourceId: '1370752555',
      title: 'Field Service Engineer',
      location: 'Istanbul, TR, 34771',
      countries: ['TR'],
      employment: 'unknown',
      url: 'https://jobs.volvogroup.com/job/Istanbul-Field-Service-Engineer-34771/1370752555/',
      postedAt: null,
      postedRough: false,
      needsDetails: false
    })
    // VA is a state here; the country is the last code part.
    expect(r.jobs[1].location).toBe('Dublin, VA, US, 24084')
    expect(r.jobs[1].countries).toEqual(['US'])
    expect(r).toMatchObject({ complete: true, note: null })
  })

  test('reads the Deere table fixture with dates', async () => {
    const board = 'jobs.deere.com'
    const page = fixture('sf-deere.html').replace('of <b>326</b>', 'of <b>3</b>')
    const { fetcher } = fakeFetcher({ [searchUrl(board, 0)]: page })
    const r = await successfactors.list(fetcher, board, NOW)
    expect(r.jobs).toHaveLength(3)
    expect(r.jobs[0]).toEqual({
      sourceId: '1427628800',
      title: 'Engineering Development Program - Weld',
      location: 'Illinois, US',
      countries: ['US'],
      employment: 'unknown',
      url: 'https://jobs.deere.com/eightfold/job/Engineering-Development-Program-Weld-Illi/1427628800/',
      postedAt: DAY,
      postedRough: false,
      needsDetails: false
    })
    expect(r.complete).toBe(true)
  })

  test('reads the Scania tile fixture', async () => {
    const board = 'jobs.scania.com'
    const page = fixture('sf-scania.html').replace('of 827 Jobs', 'of 3 Jobs')
    const { fetcher, urls } = fakeFetcher({ [searchUrl(board, 0)]: page })
    const r = await successfactors.list(fetcher, board, NOW)
    expect(urls).toEqual([searchUrl(board, 0)])
    expect(r.jobs).toHaveLength(3)
    const path =
      '/job/S%C3%B6dert%C3%A4lje-Scania-IM-s%C3%B6ker-Underh%C3%A5llselektriker-151-38/1445209733/'
    expect(r.jobs[0]).toEqual({
      sourceId: '1445209733',
      title: 'Scania IM söker Underhållselektriker',
      location: 'Södertälje, SE, 151 38',
      countries: ['SE'],
      employment: 'unknown',
      url: `https://jobs.scania.com${path}`,
      postedAt: DAY,
      postedRough: false,
      needsDetails: false
    })
    expect(r.complete).toBe(true)
  })

  test('table: pages by the site page size until the total', async () => {
    const { fetcher, urls } = fakeFetcher({
      [searchUrl(BOARD, 0)]: tablePage(1, 2, 'Results <b>1 – 2</b> of <b>5</b>'),
      [searchUrl(BOARD, 2)]: tablePage(3, 2, 'Results <b>3 – 4</b> of <b>5</b>'),
      [searchUrl(BOARD, 4)]: tablePage(5, 1, 'Results <b>5 – 5</b> of <b>5</b>')
    })
    const r = await successfactors.list(fetcher, BOARD, NOW)
    expect(urls).toEqual([0, 2, 4].map((n) => searchUrl(BOARD, n)))
    expect(r.jobs.map((j) => j.title)).toEqual(['Job 1', 'Job 2', 'Job 3', 'Job 4', 'Job 5'])
    expect(r).toMatchObject({ complete: true, note: null })
  })

  test('tile: pages by data-per-page until the total', async () => {
    const { fetcher, urls } = fakeFetcher({
      [searchUrl(BOARD, 0)]: tilePage(1, 2, 'Showing 1 to 2 of 5 Jobs'),
      [searchUrl(BOARD, 2)]: tilePage(3, 2, 'Showing 3 to 4 of 5 Jobs'),
      [searchUrl(BOARD, 4)]: tilePage(5, 1, 'Showing 5 to 5 of 5 Jobs')
    })
    const r = await successfactors.list(fetcher, BOARD, NOW)
    expect(urls).toEqual([0, 2, 4].map((n) => searchUrl(BOARD, n)))
    expect(r.jobs).toHaveLength(5)
    expect(r.jobs[4].sourceId).toBe('5')
    expect(r.complete).toBe(true)
  })

  test('tile: a total with a thousands separator is read', async () => {
    const { fetcher, urls } = fakeFetcher({
      [searchUrl(BOARD, 0)]: tilePage(1, 2, 'Showing 1 to 2 of 1,005 Jobs')
    })
    await rejection(successfactors.list(fetcher, BOARD, NOW))
    // A total of 1005 (not 1) means a second page is requested.
    expect(urls).toEqual([searchUrl(BOARD, 0), searchUrl(BOARD, 2)])
  })

  test('tile: without a Showing text it pages until a short page', async () => {
    const { fetcher, urls } = fakeFetcher({
      [searchUrl(BOARD, 0)]: tilePage(1, 2, null),
      [searchUrl(BOARD, 2)]: tilePage(3, 2, null),
      [searchUrl(BOARD, 4)]: tilePage(5, 1, null)
    })
    const r = await successfactors.list(fetcher, BOARD, NOW)
    expect(urls).toEqual([0, 2, 4].map((n) => searchUrl(BOARD, n)))
    expect(r.jobs).toHaveLength(5)
    expect(r.complete).toBe(true)
  })

  test('tile: a tile without a title link falls back to its data-url path', async () => {
    const li = `<li class="job-tile job-id-9" data-url="/job/Lund-X/9/"><span class="title">X</span></li>`
    const page = `<span id="tile-search-results-label">Showing 1 to 1 of 1 Jobs</span><ul id="job-tile-list" data-per-page="2">${li}</ul>`
    const { fetcher } = fakeFetcher({ [searchUrl(BOARD, 0)]: page })
    const r = await successfactors.list(fetcher, BOARD, NOW)
    expect(r.jobs[0]).toMatchObject({
      sourceId: '9',
      url: 'https://jobs.example.com/job/Lund-X/9/',
      title: '',
      postedAt: null
    })
  })

  test('the job id is the numeric id ending the link path, else the path as it is', async () => {
    const rows = [
      tableRow(1, { href: '/job/Oslo-Project-Manager/1445209733/' }),
      tableRow(2, { href: 'https://jobs.example.com/job/Oslo-PM/987/?locale=en_US' }),
      tableRow(3, { href: '/job/Oslo-Project-Manager-1234/' }),
      tableRow(4, { href: '/job/Oslo-PM/123/?feedId=1' })
    ].join('')
    const page = tableHtml(rows, 'Results <b>1 – 4</b> of <b>4</b>')
    const { fetcher } = fakeFetcher({ [searchUrl(BOARD, 0)]: page })
    const r = await successfactors.list(fetcher, BOARD, NOW)
    expect(r.jobs.map((j) => j.sourceId)).toEqual([
      '1445209733',
      '987',
      '/job/Oslo-Project-Manager-1234/',
      '123'
    ])
  })

  test('a page that is not a job list throws', async () => {
    const { fetcher } = fakeFetcher({
      [searchUrl(BOARD, 0)]: '<html><body>Maintenance</body></html>'
    })
    const e = await rejection(successfactors.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(notRecognised(BOARD, 0))
  })

  test('a later page that is not a job list throws', async () => {
    const { fetcher } = fakeFetcher({
      [searchUrl(BOARD, 0)]: tablePage(1, 2, 'Results <b>1 – 2</b> of <b>4</b>'),
      [searchUrl(BOARD, 2)]: '<html><body>Error</body></html>'
    })
    const e = await rejection(successfactors.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(notRecognised(BOARD, 2))
  })

  test('a first page with rows but no readable label throws', async () => {
    const { fetcher } = fakeFetcher({ [searchUrl(BOARD, 0)]: tablePage(1, 2, null) })
    const e = await rejection(successfactors.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(notRecognised(BOARD, 0))
  })

  test('an empty page before the total throws', async () => {
    const { fetcher } = fakeFetcher({
      [searchUrl(BOARD, 0)]: tablePage(1, 2, 'Results <b>1 – 2</b> of <b>6</b>'),
      [searchUrl(BOARD, 2)]: tablePage(3, 0, 'Results <b>3 – 4</b> of <b>6</b>')
    })
    const e = await rejection(successfactors.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(notRecognised(BOARD, 2))
  })

  test('a short page before a known total throws', async () => {
    const { fetcher } = fakeFetcher({
      [searchUrl(BOARD, 0)]: tablePage(1, 2, 'Results <b>1 – 2</b> of <b>6</b>'),
      [searchUrl(BOARD, 2)]: tablePage(3, 1, 'Results <b>3 – 4</b> of <b>6</b>')
    })
    const e = await rejection(successfactors.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(notRecognised(BOARD, 2))
  })

  test('a later page using the other template than the first throws', async () => {
    const { fetcher } = fakeFetcher({
      [searchUrl(BOARD, 0)]: tablePage(1, 2, 'Results <b>1 – 2</b> of <b>4</b>'),
      [searchUrl(BOARD, 2)]: tilePage(3, 2, 'Showing 3 to 4 of 4 Jobs')
    })
    const e = await rejection(successfactors.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(notRecognised(BOARD, 2))
  })

  test('a first page with a total above 0 but no rows throws', async () => {
    const a = fakeFetcher({
      [searchUrl(BOARD, 0)]: tablePage(1, 0, 'Results <b>1 – 2</b> of <b>6</b>')
    })
    const ea = await rejection(successfactors.list(a.fetcher, BOARD, NOW))
    expect((ea as Error).message).toBe(notRecognised(BOARD, 0))
    const b = fakeFetcher({ [searchUrl(BOARD, 0)]: tilePage(1, 0, 'Showing 1 to 2 of 6 Jobs') })
    const eb = await rejection(successfactors.list(b.fetcher, BOARD, NOW))
    expect((eb as Error).message).toBe(notRecognised(BOARD, 0))
  })

  test('a stated total below the rows on the page throws, for tiles as for tables', async () => {
    const a = fakeFetcher({ [searchUrl(BOARD, 0)]: tilePage(1, 2, 'Showing 1 to 2 of 1 Jobs') })
    const ea = await rejection(successfactors.list(a.fetcher, BOARD, NOW))
    expect((ea as Error).message).toBe(notRecognised(BOARD, 0))
    const b = fakeFetcher({
      [searchUrl(BOARD, 0)]: tablePage(1, 2, 'Results <b>1 – 2</b> of <b>1</b>')
    })
    const eb = await rejection(successfactors.list(b.fetcher, BOARD, NOW))
    expect((eb as Error).message).toBe(notRecognised(BOARD, 0))
  })

  test('tile: without a Showing text a short second page ends the read as complete', async () => {
    const { fetcher, urls } = fakeFetcher({
      [searchUrl(BOARD, 0)]: tilePage(1, 2, null),
      [searchUrl(BOARD, 2)]: tilePage(3, 1, null)
    })
    const r = await successfactors.list(fetcher, BOARD, NOW)
    expect(urls).toEqual([searchUrl(BOARD, 0), searchUrl(BOARD, 2)])
    expect(r.jobs).toHaveLength(3)
    expect(r).toMatchObject({ complete: true, note: null })
  })

  test('results markup with no rows on the first page is an empty complete list', async () => {
    const empty = { jobs: [], complete: true, note: null }
    const a = fakeFetcher({ [searchUrl(BOARD, 0)]: tablePage(1, 0, null) })
    expect(await successfactors.list(a.fetcher, BOARD, NOW)).toEqual(empty)
    const b = fakeFetcher({ [searchUrl(BOARD, 0)]: tilePage(1, 0, 'Showing 0 to 0 of 0 Jobs') })
    expect(await successfactors.list(b.fetcher, BOARD, NOW)).toEqual(empty)
  })

  test('a brand board keeps its folder in the search address', async () => {
    const board = 'jobs.teradyne.com/MiR'
    const { fetcher, urls } = fakeFetcher({
      'https://jobs.teradyne.com/MiR/search/?q=&startrow=0': tablePage(
        1,
        1,
        'Results <b>1 – 1</b> of <b>1</b>'
      )
    })
    const r = await successfactors.list(fetcher, board, NOW)
    expect(urls).toEqual(['https://jobs.teradyne.com/MiR/search/?q=&startrow=0'])
    expect(r.jobs[0].url).toBe('https://jobs.teradyne.com/job/Oslo-Job-1/1/')
  })

  test('decodes entities in titles, locations and links', async () => {
    const row = tableRow(1, {
      title: 'R&amp;D Engineer &#39;Lead&#39; &#x41;',
      location: 'Malm&#246;, SE',
      href: '/job/Ji&amp;apos;nan/1/'
    })
    const page = tableHtml(row, 'Results <b>1 – 1</b> of <b>1</b>')
    const { fetcher } = fakeFetcher({ [searchUrl(BOARD, 0)]: page })
    const r = await successfactors.list(fetcher, BOARD, NOW)
    expect(r.jobs[0]).toMatchObject({
      title: "R&D Engineer 'Lead' A",
      location: 'Malmö, SE',
      url: 'https://jobs.example.com/job/Ji&apos;nan/1/'
    })
  })

  test('countries: the last code part, no country for a lone state code, else names in the text', async () => {
    const rows = [
      tableRow(1, { location: 'Göteborg, SE' }),
      tableRow(2, { location: 'Dublin, VA, US, 24084' }),
      tableRow(3, { location: 'Oslo, Norway' }),
      tableRow(4, { location: 'Nowhere' }),
      tableRow(5, { location: 'Moline, IL' })
    ].join('')
    const page = tableHtml(rows, 'Results <b>1 – 5</b> of <b>5</b>')
    const { fetcher } = fakeFetcher({ [searchUrl(BOARD, 0)]: page })
    const r = await successfactors.list(fetcher, BOARD, NOW)
    expect(r.jobs.map((j) => j.countries)).toEqual([['SE'], ['US'], ['NO'], [], []])
  })

  test('parses the four date formats and nothing else', async () => {
    const dates = [
      'Nov 5, 2026',
      '5 Nov 2026',
      '05.11.2026',
      '2026-11-05',
      'yesterday',
      '31.02.2026',
      ''
    ]
    const rows = dates.map((d, i) => tableRow(i + 1, { date: d })).join('')
    const page = tableHtml(rows, 'Results <b>1 – 7</b> of <b>7</b>')
    const { fetcher } = fakeFetcher({ [searchUrl(BOARD, 0)]: page })
    const r = await successfactors.list(fetcher, BOARD, NOW)
    expect(r.jobs.map((j) => j.postedAt)).toEqual([DAY, DAY, DAY, DAY, null, null, null])
  })

  test('stops after 200 pages and says the read is incomplete', async () => {
    const routes: Record<string, string> = {}
    for (let p = 0; p < 201; p++) {
      routes[searchUrl(BOARD, p)] = tablePage(
        p + 1,
        1,
        `Results <b>${p + 1} – ${p + 1}</b> of <b>5000</b>`
      )
    }
    const { fetcher, urls } = fakeFetcher(routes)
    const r = await successfactors.list(fetcher, BOARD, NOW)
    expect(urls).toHaveLength(200)
    expect(r.jobs).toHaveLength(200)
    expect(r.complete).toBe(false)
    expect(r.note).toBe('Stopped after 200 pages')
  })

  test('a robots.txt block and an HTTP error propagate', async () => {
    const blocked = fakeFetcher({ [searchUrl(BOARD, 0)]: null })
    expect(await rejection(successfactors.list(blocked.fetcher, BOARD, NOW))).toBeInstanceOf(
      BlockedError
    )
    const down = fakeFetcher({ [searchUrl(BOARD, 0)]: 503 })
    const e = await rejection(successfactors.list(down.fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(`HTTP 503 from ${searchUrl(BOARD, 0)}`)
  })
})
