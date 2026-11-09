import { describe, expect, it } from 'vitest'
import { dkReader } from '../../src/main/sponsors/dk'
import { fakeFetcher, fixtureText } from './helpers'

const PAGE = 'https://www.nyidanmark.dk/en-GB/Words-and-concepts/SIRI/Certified-companies'

describe('dk reader', () => {
  it('reads the certified-companies page and returns one entry per company', async () => {
    const { fetcher, calls } = fakeFetcher({ [PAGE]: fixtureText('dk.html') })
    const r = await dkReader.read(fetcher)
    expect(dkReader.country).toBe('DK')
    expect(calls.map((c) => [c.method, c.url])).toEqual([['get', PAGE]])
    expect(r.source).toBe(PAGE)
    expect(r.entries).toHaveLength(20)
    expect(r.entries[0]).toEqual({ name: '&TRADITION A/S', detail: 'Fast-track certified' })
    expect(r.entries.map((e) => e.name)).toContain('ABB A/S')
  })

  it('strips markup and non-breaking spaces from names and skips rows without a name', async () => {
    const { fetcher } = fakeFetcher({ [PAGE]: fixtureText('dk.html') })
    const names = (await dkReader.read(fetcher)).entries.map((e) => e.name)
    expect(names).toContain('3Shape A/S')
    expect(names).toContain('AAK DENMARK A/S')
    expect(names).not.toContain('')
    expect(names.every((n) => n === n.trim() && !n.includes('<') && !n.includes(' '))).toBe(true)
  })

  it('a page without the expected table throws', async () => {
    const { fetcher } = fakeFetcher({
      [PAGE]: '<table><tr><td>Something else</td><td>entirely</td></tr></table>'
    })
    await expect(dkReader.read(fetcher)).rejects.toThrow(`Sponsor list not recognised on ${PAGE}`)
  })
})
