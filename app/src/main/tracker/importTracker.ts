import { readFileSync } from 'node:fs'
import { posix } from 'node:path'
import ExcelJS from 'exceljs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { CompanyList, ImportResult, NewCompany } from '../../shared/types'
import { addCompanies } from '../db/companies'
import type { Db } from '../db/db'

const SHEET = 'Master Company List'
const REQUIRED = ['Company', 'Category']
const LISTS: Record<string, CompanyList> = {
  vehicle: 'vehicle',
  machinery: 'machinery',
  both: 'both'
}
const WEB_LINK = /^https?:\/\//i

/** The text of a cell, trimmed. A number becomes its text; text with a link or rich formatting, its words. */
function cellText(value: ExcelJS.CellValue | undefined): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (value !== null && typeof value === 'object') {
    if ('richText' in value) return cellText(value.richText.map((part) => part.text).join(''))
    // A link's own text can be rich text when the file comes from Excel, whatever the typings say.
    if ('text' in value) return cellText(value.text as ExcelJS.CellValue)
  }
  return ''
}

/** A web link from a Career page cell: the cell's link if it has one, else its text. */
function careersUrlOf(value: ExcelJS.CellValue | undefined): string | undefined {
  const link =
    value !== null && typeof value === 'object' && 'hyperlink' in value ? value.hyperlink : ''
  return [link.trim(), cellText(value)].find((candidate) => WEB_LINK.test(candidate))
}

/** Same match the store makes: SQLite's NOCASE folds only A-Z. */
function nameKey(name: string): string {
  return name.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

/**
 * openpyxl links a sheet to its parts (tables) with an absolute path, `/xl/tables/table1.xml`. exceljs only
 * resolves the relative form, `../tables/table1.xml`, and crashes on the other, so every such link in a sheet's
 * relationships is rewritten relative to `xl/worksheets/` before the file is loaded.
 */
function repairTargets(file: Uint8Array): Uint8Array {
  const parts = unzipSync(file)
  let changed = false
  for (const name of Object.keys(parts)) {
    if (!/^xl\/worksheets\/_rels\/[^/]+\.rels$/.test(name)) continue
    const xml = strFromU8(parts[name])
    const fixed = xml.replace(
      /Target="\/xl\/([^"]*)"/g,
      (_, target: string) => `Target="${posix.relative('xl/worksheets', `xl/${target}`)}"`
    )
    if (fixed === xml) continue
    parts[name] = strToU8(fixed)
    changed = true
  }
  return changed ? zipSync(parts) : file
}

/** Reads the owner's tracker into companies, plus a message for each row or problem it could not use. */
export async function readTracker(path: string): Promise<{ rows: NewCompany[]; errors: string[] }> {
  const stop = (...errors: string[]): { rows: NewCompany[]; errors: string[] } => ({
    rows: [],
    errors
  })

  const workbook = new ExcelJS.Workbook()
  try {
    // exceljs types its argument with a Buffer of its own; a Node Buffer is what it takes at run time.
    const bytes = Buffer.from(repairTargets(readFileSync(path)))
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
  } catch (e) {
    return stop(`Could not read the file: ${e instanceof Error ? e.message : String(e)}`)
  }
  const sheet = workbook.getWorksheet(SHEET)
  if (!sheet) return stop(`The file has no "${SHEET}" sheet.`)

  // Column number by header text; the first of two equal headers wins.
  const columns = new Map<string, number>()
  sheet.getRow(1).eachCell((cell, col) => {
    const header = cellText(cell.value)
    if (header !== '' && !columns.has(header)) columns.set(header, col)
  })
  const missing = REQUIRED.filter((header) => !columns.has(header))
  if (missing.length > 0) return stop(...missing.map((h) => `The sheet has no "${h}" column.`))

  const rows: NewCompany[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  for (let n = 2; n <= sheet.rowCount; n++) {
    const row = sheet.getRow(n)
    const value = (header: string): ExcelJS.CellValue | undefined => {
      const col = columns.get(header)
      return col === undefined ? undefined : row.getCell(col).value
    }
    const text = (header: string): string => cellText(value(header))

    const name = text('Company')
    const category = text('Category')
    if (name === '') {
      let blank = true
      row.eachCell((cell) => {
        if (cellText(cell.value) !== '') blank = false
      })
      if (!blank) errors.push(`Row ${n}: no company name, not imported.`)
      continue
    }
    const list = LISTS[category.toLowerCase()]
    if (list === undefined) {
      errors.push(
        category === ''
          ? `Row ${n} (${name}): no category, not imported.`
          : `Row ${n} (${name}): unknown category "${category}", not imported.`
      )
      continue
    }
    const key = nameKey(name)
    if (seen.has(key)) {
      errors.push(`Row ${n} (${name}): listed twice, kept the first.`)
      continue
    }
    seen.add(key)

    // An empty cell is left out, so the store applies its own default.
    const company: NewCompany = { name, list }
    const optional: [Exclude<keyof NewCompany, 'name' | 'list'>, string | undefined][] = [
      ['focus', text('Industry / focus')],
      ['hq', text('Headquarters / origin')],
      ['priority', text('Priority')],
      ['applicationStatus', text('Application status')],
      ['notes', text('Notes')],
      ['englishOnly', text('English-only opportunities')],
      ['visaSponsorship', text('Visa sponsorship')],
      ['careersUrl', careersUrlOf(value('Career page'))]
    ]
    for (const [field, cell] of optional) if (cell) company[field] = cell
    rows.push(company)
  }
  return { rows, errors }
}

/** Adds the tracker's companies that are not in the app yet. Nothing is changed or removed. */
export async function importTracker(db: Db, path: string): Promise<ImportResult> {
  const { rows, errors } = await readTracker(path)
  if (rows.length === 0) return { added: 0, skipped: 0, errors }
  const { added, skipped } = addCompanies(db, rows)
  return { added, skipped: skipped.length, errors }
}
