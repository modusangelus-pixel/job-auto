import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDb, type Db } from '../../src/main/db/db'
import { listCompanies } from '../../src/main/db/companies'
import { importTracker, readTracker } from '../../src/main/tracker/importTracker'

const HEADERS = [
  'Company',
  'Category',
  'Industry / focus',
  'Headquarters / origin',
  'Target countries',
  'Local presence / locations',
  'Career page',
  'English-only opportunities',
  'Visa sponsorship',
  'Target positions',
  'Priority',
  'Research status',
  'Application status',
  'Notes'
]

let dir = ''
let db: Db
let fileCount = 0
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'job-tracker-'))
  db = openDb(join(dir, 'job-auto.db'))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** A tracker row, keyed by header. A header left out stays an empty cell. */
type Cells = Record<string, ExcelJS.CellValue>

/** Writes a tracker file to the temp folder: headers in row 1, `rows[0]` in row 2, and so on. */
async function writeTracker(
  rows: Cells[],
  opts: { sheet?: string; headers?: string[] } = {}
): Promise<string> {
  const headers = opts.headers ?? HEADERS
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(opts.sheet ?? 'Master Company List')
  headers.forEach((h, c) => (sheet.getCell(1, c + 1).value = h))
  rows.forEach((row, i) =>
    headers.forEach((h, c) => {
      if (row[h] !== undefined) sheet.getCell(i + 2, c + 1).value = row[h]
    })
  )
  const path = join(dir, `tracker-${++fileCount}.xlsx`)
  await workbook.xlsx.writeFile(path)
  return path
}

const THREE: Cells[] = [
  { Company: 'Waymo', Category: 'Vehicle' },
  { Company: 'Konecranes', Category: 'Machinery' },
  { Company: 'ABB', Category: 'Both' }
]

describe('readTracker', () => {
  test('reads the Master Company List into the three lists', async () => {
    const file = await writeTracker([
      {
        Company: 'Waymo',
        Category: 'Vehicle',
        'Industry / focus': 'Self-driving cars',
        'Headquarters / origin': 'USA',
        'English-only opportunities': 'Unknown',
        'Visa sponsorship': 'Unknown',
        Priority: 'High',
        'Application status': 'Not started',
        Notes: 'Sample note'
      },
      {
        Company: 'Konecranes',
        Category: 'Machinery',
        'Industry / focus': 'Unknown',
        'Headquarters / origin': 'Finland'
      },
      { Company: 'ABB', Category: 'Both' }
    ])
    expect(await readTracker(file)).toEqual({
      rows: [
        {
          name: 'Waymo',
          list: 'vehicle',
          focus: 'Self-driving cars',
          hq: 'USA',
          englishOnly: 'Unknown',
          visaSponsorship: 'Unknown',
          priority: 'High',
          applicationStatus: 'Not started',
          notes: 'Sample note'
        },
        { name: 'Konecranes', list: 'machinery', focus: 'Unknown', hq: 'Finland' },
        { name: 'ABB', list: 'both' }
      ],
      errors: []
    })
  })

  test('leaves out empty cells and the columns that are not imported', async () => {
    const file = await writeTracker([
      {
        Company: 'Waymo',
        Category: 'Vehicle',
        'Target countries': 'USA',
        'Local presence / locations': 'Mountain View',
        'Target positions': 'Perception engineer',
        'Research status': 'Done',
        Priority: '   '
      }
    ])
    const { rows } = await readTracker(file)
    expect(rows).toStrictEqual([{ name: 'Waymo', list: 'vehicle' }])
  })

  test.each(['Company', 'Category'])(
    'a missing %s column imports nothing and names the column',
    async (column) => {
      const file = await writeTracker(THREE, { headers: HEADERS.filter((h) => h !== column) })
      expect(await readTracker(file)).toEqual({
        rows: [],
        errors: [`The sheet has no "${column}" column.`]
      })
    }
  )

  test('a file without the Master Company List sheet says so', async () => {
    const file = await writeTracker(THREE, { sheet: 'Sheet1' })
    expect(await readTracker(file)).toEqual({
      rows: [],
      errors: ['The file has no "Master Company List" sheet.']
    })
  })

  // openpyxl links a sheet to its table as "/xl/tables/table1.xml"; exceljs only resolves "../tables/table1.xml".
  test('reads a tracker saved by openpyxl, whose sheet links to its table with an absolute path', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Master Company List')
    sheet.addTable({
      name: 'TblMasterCompanyList',
      ref: 'A1',
      headerRow: true,
      columns: HEADERS.map((name) => ({ name })),
      rows: THREE.map((row) => HEADERS.map((h) => row[h] ?? ''))
    })
    const file = join(dir, 'tracker-openpyxl.xlsx')
    const parts = unzipSync(new Uint8Array(await workbook.xlsx.writeBuffer()))
    const rels = Object.keys(parts).filter((name) => /^xl\/worksheets\/_rels\/.+\.rels$/.test(name))
    expect(rels).not.toEqual([])
    for (const name of rels) {
      const xml = strFromU8(parts[name])
      expect(xml).toContain('Target="../tables/')
      parts[name] = strToU8(xml.replaceAll('Target="../', 'Target="/xl/'))
    }
    writeFileSync(file, zipSync(parts))

    expect(await readTracker(file)).toEqual({
      rows: [
        { name: 'Waymo', list: 'vehicle' },
        { name: 'Konecranes', list: 'machinery' },
        { name: 'ABB', list: 'both' }
      ],
      errors: []
    })
  })

  test('a file that is not a spreadsheet is reported, not thrown', async () => {
    const file = join(dir, 'not-a-tracker.xlsx')
    writeFileSync(file, 'Company,Category\nWaymo,Vehicle\n')
    const result = await readTracker(file)
    expect(result.rows).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/^Could not read the file: /)
  })

  test('headers match by their trimmed text and categories ignore case and spaces', async () => {
    const file = await writeTracker(
      [
        { ' Company ': ' Waymo ', Category: ' vehicle ' },
        { ' Company ': 'ABB', Category: 'BOTH' }
      ],
      { headers: [' Company ', 'Category'] }
    )
    expect(await readTracker(file)).toEqual({
      rows: [
        { name: 'Waymo', list: 'vehicle' },
        { name: 'ABB', list: 'both' }
      ],
      errors: []
    })
  })

  test('blank rows are skipped; an unknown category and a repeated name are reported by row', async () => {
    const file = await writeTracker([
      { Company: 'Waymo', Category: 'Vehicle' }, // row 2
      {}, // row 3, blank
      { Company: 'Acme', Category: 'Cars' }, // row 4
      { Company: 'waymo', Category: 'Both' } // row 5
    ])
    const result = await readTracker(file)
    expect(result.rows).toEqual([{ name: 'Waymo', list: 'vehicle' }])
    expect(result.errors).toEqual([
      'Row 4 (Acme): unknown category "Cars", not imported.',
      'Row 5 (waymo): listed twice, kept the first.'
    ])
  })

  test('a row with a name but no category, or a category but no name, is reported by row', async () => {
    const file = await writeTracker([
      { Company: 'Acme' }, // row 2
      { Category: 'Vehicle', Notes: 'orphan' } // row 3
    ])
    expect(await readTracker(file)).toEqual({
      rows: [],
      errors: ['Row 2 (Acme): no category, not imported.', 'Row 3: no company name, not imported.']
    })
  })

  test('a row that was not imported does not count as the first listing of its name', async () => {
    const file = await writeTracker([
      { Company: 'Acme', Category: 'Cars' },
      { Company: 'Acme', Category: 'Machinery' }
    ])
    const result = await readTracker(file)
    expect(result.rows).toEqual([{ name: 'Acme', list: 'machinery' }])
    expect(result.errors).toEqual(['Row 2 (Acme): unknown category "Cars", not imported.'])
  })

  test('cells that hold numbers, rich text or link text become trimmed text', async () => {
    const file = await writeTracker([
      { Company: 2024, Category: 'Vehicle', Priority: 1 },
      {
        Company: { richText: [{ text: ' Ac' }, { text: 'me ' }] },
        Category: 'Machinery',
        'Industry / focus': { text: ' Cranes ', hyperlink: 'https://acme.example' }
      }
    ])
    expect(await readTracker(file)).toEqual({
      rows: [
        { name: '2024', list: 'vehicle', priority: '1' },
        { name: 'Acme', list: 'machinery', focus: 'Cranes' }
      ],
      errors: []
    })
  })

  test('Career page fills careersUrl when it is a web link, including hyperlink cells', async () => {
    const file = await writeTracker([
      { Company: 'A', Category: 'Vehicle', 'Career page': ' https://a.example/careers ' },
      { Company: 'B', Category: 'Vehicle', 'Career page': 'http://b.example/jobs' },
      {
        Company: 'C',
        Category: 'Vehicle',
        'Career page': { text: 'Careers', hyperlink: 'https://c.example/jobs' }
      },
      { Company: 'D', Category: 'Vehicle', 'Career page': 'see their website' },
      {
        Company: 'E',
        Category: 'Vehicle',
        'Career page': { text: 'Mail HR', hyperlink: 'mailto:hr@e.example' }
      },
      {
        Company: 'F',
        Category: 'Vehicle',
        'Career page': { text: 'https://f.example/careers', hyperlink: 'mailto:hr@f.example' }
      },
      { Company: 'G', Category: 'Vehicle', 'Career page': 'www.g.example/careers' },
      { Company: 'H', Category: 'Vehicle' }
    ])
    const { rows, errors } = await readTracker(file)
    expect(errors).toEqual([])
    expect(rows.map((r) => [r.name, r.careersUrl])).toEqual([
      ['A', 'https://a.example/careers'],
      ['B', 'http://b.example/jobs'],
      ['C', 'https://c.example/jobs'],
      ['D', undefined],
      ['E', undefined],
      ['F', 'https://f.example/careers'],
      ['G', undefined],
      ['H', undefined]
    ])
  })
})

describe('importTracker', () => {
  test('importing again adds only the new companies', async () => {
    const file = await writeTracker(THREE)
    expect(await importTracker(db, file)).toEqual({ added: 3, skipped: 0, errors: [] })
    expect(await importTracker(db, file)).toEqual({ added: 0, skipped: 3, errors: [] })
    expect(listCompanies(db).map((c) => [c.name, c.list])).toEqual([
      ['ABB', 'both'],
      ['Konecranes', 'machinery'],
      ['Waymo', 'vehicle']
    ])
  })

  test('stores the fields, with focus and hq empty when the tracker has none', async () => {
    const file = await writeTracker([
      {
        Company: 'Waymo',
        Category: 'Vehicle',
        'Industry / focus': 'Self-driving cars',
        'Headquarters / origin': 'USA',
        'Career page': 'https://waymo.com/careers',
        'English-only opportunities': 'Unknown',
        'Visa sponsorship': 'Unknown',
        Priority: 'High',
        'Application status': 'Not started',
        Notes: 'Sample note'
      },
      { Company: 'ABB', Category: 'Both' }
    ])
    await importTracker(db, file)
    const [abb, waymo] = listCompanies(db)
    expect(waymo).toMatchObject({
      name: 'Waymo',
      list: 'vehicle',
      focus: 'Self-driving cars',
      hq: 'USA',
      careersUrl: 'https://waymo.com/careers',
      englishOnly: 'Unknown',
      visaSponsorship: 'Unknown',
      priority: 'High',
      applicationStatus: 'Not started',
      notes: 'Sample note',
      status: 'pending'
    })
    expect(abb).toMatchObject({
      name: 'ABB',
      focus: '',
      hq: '',
      careersUrl: null,
      priority: null,
      notes: null
    })
  })

  test('skipped counts the names already in the app; a repeat within the file is only an error', async () => {
    await importTracker(db, await writeTracker([{ Company: 'Waymo', Category: 'Vehicle' }]))
    const file = await writeTracker([
      { Company: 'waymo', Category: 'Vehicle' },
      { Company: 'ABB', Category: 'Both' },
      { Company: 'abb', Category: 'Both' }
    ])
    expect(await importTracker(db, file)).toEqual({
      added: 1,
      skipped: 1,
      errors: ['Row 4 (abb): listed twice, kept the first.']
    })
  })

  test('a file with a missing column or sheet adds nothing', async () => {
    const noCategory = await writeTracker(THREE, { headers: ['Company'] })
    expect(await importTracker(db, noCategory)).toEqual({
      added: 0,
      skipped: 0,
      errors: ['The sheet has no "Category" column.']
    })
    const noSheet = await writeTracker(THREE, { sheet: 'Sheet1' })
    expect(await importTracker(db, noSheet)).toEqual({
      added: 0,
      skipped: 0,
      errors: ['The file has no "Master Company List" sheet.']
    })
    expect(listCompanies(db)).toEqual([])
  })

  test('imports a tracker of the real size and shape', async () => {
    const categories = ['Vehicle', 'Machinery', 'Both']
    const rows: Cells[] = Array.from({ length: 255 }, (_, i) => ({
      Company: `Company ${i + 1}`,
      Category: categories[i % 3],
      'Industry / focus': 'Unknown',
      'Headquarters / origin': 'Unknown',
      'English-only opportunities': 'Unknown',
      'Visa sponsorship': 'Unknown'
    }))
    const result = await importTracker(db, await writeTracker(rows))
    expect(result).toEqual({ added: 255, skipped: 0, errors: [] })
    expect(listCompanies(db).filter((c) => c.list === 'both')).toHaveLength(85)
  })
})
