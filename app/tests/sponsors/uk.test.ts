import { describe, expect, it } from 'vitest'
import { ukReader } from '../../src/main/sponsors/uk'
import { fakeFetcher, fixtureText } from './helpers'

const PAGE = 'https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers'
const CSV =
  'https://assets.publishing.service.gov.uk/media/6aec6a5cbdbbd2ef07a254c1/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-11-05.csv'

function served(): ReturnType<typeof fakeFetcher> {
  return fakeFetcher({ [PAGE]: fixtureText('uk-page.html'), [CSV]: fixtureText('uk.csv') })
}

describe('uk reader', () => {
  it('belongs to GB', () => {
    expect(ukReader.country).toBe('GB')
  })

  it('reads the publication page, then the CSV it links, with the long wait', async () => {
    const { fetcher, calls } = served()
    const r = await ukReader.read(fetcher)
    expect(calls.map((c) => [c.method, c.url, c.timeoutMs])).toEqual([
      ['get', PAGE, undefined],
      ['get', CSV, 180000]
    ])
    expect(r.source).toBe(PAGE)
  })

  it('returns one entry per organisation, with routes in file order, ratings and the first town', async () => {
    const { entries } = await ukReader.read(served().fetcher)
    expect(entries).toHaveLength(12)
    expect(entries.find((e) => e.name === 'ABB Limited')).toEqual({
      name: 'ABB Limited',
      detail:
        'Global Business Mobility: Graduate Trainee, Skilled Worker, Global Business Mobility: Senior or Specialist Worker · A rating · Daresbury'
    })
  })

  it('trims names and towns, unquotes quoted names and reads a B rating', async () => {
    const { entries } = await ukReader.read(served().fetcher)
    const detail = (name: string): string | undefined =>
      entries.find((e) => e.name === name)?.detail
    expect(detail('Akaal Transport Ltd')).toBe(
      'Skilled Worker · B rating · Leicester, Leicestershire'
    )
    expect(detail('PINAL DAYA, T/A LONDIS')).toBe('Skilled Worker · A rating · NORTHAMPTON')
    expect(detail('"K" Line Energy Shipping (UK) Limited')).toBe(
      'Global Business Mobility: Senior or Specialist Worker, Skilled Worker · A rating · LONDON'
    )
    expect(detail('Asian African Foods Ltd')).toBe('Skilled Worker · A rating · London')
  })

  it('lists each rating once, in file order', async () => {
    const csv =
      'Organisation Name,Town/City,County,Type & Rating,Route\n' +
      'Acme,Leeds,,Worker (A rating),Skilled Worker\n' +
      'Acme,Leeds,,Temporary Worker (B rating),Creative Worker\n' +
      'Acme,Leeds,,Worker (A rating),Skilled Worker\n' +
      'Acme,Leeds,,Worker (A rating),Scale-up\n'
    const { fetcher } = fakeFetcher({ [PAGE]: fixtureText('uk-page.html'), [CSV]: csv })
    expect((await ukReader.read(fetcher)).entries).toEqual([
      {
        name: 'Acme',
        detail: 'Skilled Worker, Creative Worker, Scale-up · A rating, B rating · Leeds'
      }
    ])
  })

  it('a page without the CSV link throws', async () => {
    const { fetcher } = fakeFetcher({
      [PAGE]: '<html><body><a href="/other.csv">x</a></body></html>'
    })
    await expect(ukReader.read(fetcher)).rejects.toThrow(`Sponsor list not recognised on ${PAGE}`)
  })

  it('a CSV without the expected header throws', async () => {
    const { fetcher } = fakeFetcher({ [PAGE]: fixtureText('uk-page.html'), [CSV]: 'a,b\n1,2\n' })
    await expect(ukReader.read(fetcher)).rejects.toThrow(`Sponsor list not recognised on ${CSV}`)
  })

  it('an HTTP error names the status and the url', async () => {
    const { fetcher } = fakeFetcher({})
    await expect(ukReader.read(fetcher)).rejects.toThrow(`HTTP 404 from ${PAGE}`)
  })
})
