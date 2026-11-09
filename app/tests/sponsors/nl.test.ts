import { describe, expect, it } from 'vitest'
import { nlReader } from '../../src/main/sponsors/nl'
import { fakeFetcher, fixtureText } from './helpers'

const PAGE = 'https://ind.nl/en/public-register-recognised-sponsors/public-register-work'

describe('nl reader', () => {
  it('reads the register page and returns one entry per organisation', async () => {
    const { fetcher, calls } = fakeFetcher({ [PAGE]: fixtureText('nl.html') })
    const r = await nlReader.read(fetcher)
    expect(nlReader.country).toBe('NL')
    expect(calls.map((c) => [c.method, c.url])).toEqual([['get', PAGE]])
    expect(r.source).toBe(PAGE)
    expect(r.entries).toHaveLength(20)
    expect(r.entries[0]).toEqual({
      name: '"Aa-Dee" Machinefabriek en Staalbouw Nederland B.V.',
      detail: 'Recognised sponsor (work)'
    })
    expect(r.entries[2].name).toBe('@EasePay B.V.')
  })

  it('decodes entities in names', async () => {
    const html =
      '<table><thead><tr><th scope="col">Organisation</th><th scope="col">KVK</th></tr></thead><tbody>' +
      '<tr><th scope="row">Ben &amp; Jerry&#39;s B.V.</th><td>1</td></tr></tbody></table>'
    const { fetcher } = fakeFetcher({ [PAGE]: html })
    expect((await nlReader.read(fetcher)).entries).toEqual([
      { name: "Ben & Jerry's B.V.", detail: 'Recognised sponsor (work)' }
    ])
  })

  it('a page without the expected table throws', async () => {
    const { fetcher } = fakeFetcher({ [PAGE]: '<html><body><p>Maintenance</p></body></html>' })
    await expect(nlReader.read(fetcher)).rejects.toThrow(`Sponsor list not recognised on ${PAGE}`)
  })
})
