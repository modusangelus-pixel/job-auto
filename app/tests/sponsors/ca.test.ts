import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { caReader } from '../../src/main/sponsors/ca'
import { fakeFetcher, fixture, fixtureText } from './helpers'

const API =
  'https://open.canada.ca/data/api/action/package_show?id=90fed587-1364-4f33-a9ee-208181dc0b97'
const BASE = 'https://open.canada.ca/data/dataset/90fed587-1364-4f33-a9ee-208181dc0b97/resource/'
const NEWEST_FOUR = [
  BASE + '2b94f80d-fa27-4d2e-9b90-6f67fe69bf50/download/tfwp_2026q2_pos_en.xlsx',
  BASE + '4ee7a4e0-ffc3-47af-94e7-30929d1eeb67/download/tfwp_2026q1_pos_en.xlsx',
  BASE + '06512c1b-d4a7-413f-bc1e-fc38de9f9aca/download/tfwp_2025q4_pos_en.xlsx',
  BASE + '3b7a821b-becc-4d96-9e39-0c2849f90c50/download/tfwp_2025q3_pos_en.xlsx'
]

// The same small workbook is served for all 4 quarters, so every per-quarter number appears 4 times.
function routes(): Record<string, string | Buffer> {
  const r: Record<string, string | Buffer> = { [API]: fixtureText('ca-package.json') }
  for (const u of NEWEST_FOUR) r[u] = fixture('ca-q.xlsx')
  return r
}

describe('ca reader', () => {
  it('reads the newest 4 English XLSX files and sums positions per employer', async () => {
    const { fetcher, calls } = fakeFetcher(routes())
    const r = await caReader.read(fetcher)
    expect(caReader.country).toBe('CA')
    expect(calls.map((c) => [c.method, c.url, c.timeoutMs])).toEqual([
      ['get', API, undefined],
      ...NEWEST_FOUR.map((u) => ['getBytes', u, 120000])
    ])
    expect(r.source).toBe(API)
    expect(r.entries).toHaveLength(6)
    expect(r.entries.find((e) => e.name === 'DOF Subsea Canada Corp.')).toEqual({
      name: 'DOF Subsea Canada Corp.',
      detail:
        '8 positions in the last 4 quarters · 21399-Other professional engineers, n.e.c., 74201-Water transport deck and engine room crew'
    })
  })

  it('names the 2 occupations with most positions and merges padded employer names', async () => {
    const { fetcher } = fakeFetcher(routes())
    const { entries } = await caReader.read(fetcher)
    const detail = (name: string): string | undefined =>
      entries.find((e) => e.name === name)?.detail
    // per quarter: 2 + 2 positions on two occupations, in file order on a tie
    expect(detail('91521 Newfoundland & Labrador Inc.')).toBe(
      '16 positions in the last 4 quarters · 72310-Carpenters, 73102-Plasterers, drywall installers and finishers and lathers'
    )
    // per quarter: 2 + 1 + 3 positions; the 3 comes first
    expect(detail('Nova Scotia Health Authority')).toBe(
      '24 positions in the last 4 quarters · 32101-Licensed practical nurses, 31301-Registered nurses and registered psychiatric nurses'
    )
    // per quarter: 1 + 1 + 1 plus a padded repeat of 2 on material handlers
    expect(entries.filter((e) => e.name === 'Asante Logistic Group Inc.')).toHaveLength(1)
    expect(detail('Asante Logistic Group Inc.')).toBe(
      '20 positions in the last 4 quarters · 75101-Material handlers, 70020-Managers in transportation'
    )
  })

  it('reads fewer files when the package lists fewer', async () => {
    const pkg = JSON.parse(fixtureText('ca-package.json')) as { result: { resources: unknown[] } }
    pkg.result.resources = pkg.result.resources.slice(0, 1)
    const { fetcher, calls } = fakeFetcher({ ...routes(), [API]: JSON.stringify(pkg) })
    await caReader.read(fetcher)
    expect(calls.filter((c) => c.method === 'getBytes')).toHaveLength(1)
  })

  it('a package without English XLSX files throws', async () => {
    const { fetcher } = fakeFetcher({ [API]: JSON.stringify({ result: { resources: [] } }) })
    await expect(caReader.read(fetcher)).rejects.toThrow(`Sponsor list not recognised on ${API}`)
  })

  it('a workbook without the expected header throws', async () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('positive').addRow(['nothing', 'here'])
    const bytes = Buffer.from(await wb.xlsx.writeBuffer())
    const r = routes()
    for (const u of NEWEST_FOUR) r[u] = bytes
    const { fetcher } = fakeFetcher(r)
    await expect(caReader.read(fetcher)).rejects.toThrow(
      `Sponsor list not recognised on ${NEWEST_FOUR[0]}`
    )
  })

  /** A quarter's workbook after `titleRows` title rows: Acme Ltd with `positions`, or no employer at all (null). */
  async function workbook(titleRows: number, positions: number | null): Promise<Buffer> {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('positive')
    for (let i = 0; i < titleRows; i++) ws.addRow([`Title ${i}`])
    ws.addRow([
      'Province/Territory',
      'Program Stream',
      'Employer',
      'Address',
      'Occupation',
      'Incorporate Status',
      'Approved LMIAs',
      'Approved Positions'
    ])
    if (positions !== null)
      ws.addRow([
        'BC ',
        'High Wage ',
        ' Acme Ltd ',
        'Here',
        '21232-Software developers',
        'Unknown',
        1,
        positions
      ])
    return Buffer.from(await wb.xlsx.writeBuffer())
  }

  async function served(titleRows: number): Promise<ReturnType<typeof fakeFetcher>> {
    const bytes = await workbook(titleRows, 3)
    const r = routes()
    for (const u of NEWEST_FOUR) r[u] = bytes
    return fakeFetcher(r)
  }

  it('says 1 position, not 1 positions', async () => {
    const r = routes()
    r[NEWEST_FOUR[0]] = await workbook(1, 1)
    for (const u of NEWEST_FOUR.slice(1)) r[u] = await workbook(1, null)
    const { entries } = await caReader.read(fakeFetcher(r).fetcher)
    expect(entries).toEqual([
      { name: 'Acme Ltd', detail: '1 position in the last 4 quarters · 21232-Software developers' }
    ])
  })

  it('finds the header when it sits on row 3', async () => {
    const { fetcher } = await served(2)
    expect((await caReader.read(fetcher)).entries).toEqual([
      {
        name: 'Acme Ltd',
        detail: '12 positions in the last 4 quarters · 21232-Software developers'
      }
    ])
  })

  it('throws when no header is found in the first rows', async () => {
    const { fetcher } = await served(5)
    await expect(caReader.read(fetcher)).rejects.toThrow(
      `Sponsor list not recognised on ${NEWEST_FOUR[0]}`
    )
  })
})
