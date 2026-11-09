import ExcelJS from 'exceljs'
import { getFile, getText } from '../jobs/readers/http'
import { notRecognised, type SponsorEntry, type SponsorReader } from './types'

const API =
  'https://open.canada.ca/data/api/action/package_show?id=90fed587-1364-4f33-a9ee-208181dc0b97'
const FILE_TIMEOUT_MS = 120_000
const QUARTERS = 4

interface Resource {
  format?: string
  language?: string[]
  created?: string
  url?: string
}

interface Acc {
  positions: number
  byOccupation: Map<string, number>
}

/** The newest `QUARTERS` English XLSX files of the package. */
function newestFiles(json: string): string[] {
  let resources: Resource[]
  try {
    const parsed = JSON.parse(json) as { result?: { resources?: Resource[] } }
    resources = parsed.result?.resources ?? []
  } catch {
    return []
  }
  return resources
    .filter((r) => r.format === 'XLSX' && r.language?.includes('en') && r.url && r.created)
    .sort((a, b) => (b.created as string).localeCompare(a.created as string))
    .slice(0, QUARTERS)
    .map((r) => r.url as string)
}

async function addQuarter(url: string, bytes: Buffer, into: Map<string, Acc>): Promise<void> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes as unknown as ArrayBuffer)
  const sheet = wb.getWorksheet('positive') ?? wb.worksheets[0]
  if (!sheet) throw notRecognised(url)
  let columns: { employer: number; occupation: number; positions: number } | null = null
  let headerRow = 0
  for (let i = 1; i <= Math.min(5, sheet.rowCount) && !columns; i++) {
    const cells = (sheet.getRow(i).values as unknown[]).map((v) => String(v ?? '').trim())
    const employer = cells.indexOf('Employer')
    const positions = cells.indexOf('Approved Positions')
    if (employer > 0 && positions > 0) {
      columns = { employer, occupation: cells.indexOf('Occupation'), positions }
      headerRow = i
    }
  }
  if (!columns) throw notRecognised(url)
  for (let i = headerRow + 1; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i)
    const employer = row.getCell(columns.employer).text.trim()
    if (employer === '') continue
    const count = Number(row.getCell(columns.positions).value)
    const positions = Number.isFinite(count) ? count : 0
    let acc = into.get(employer)
    if (!acc) {
      acc = { positions: 0, byOccupation: new Map() }
      into.set(employer, acc)
    }
    acc.positions += positions
    const occupation = columns.occupation > 0 ? row.getCell(columns.occupation).text.trim() : ''
    if (occupation !== '') {
      acc.byOccupation.set(occupation, (acc.byOccupation.get(occupation) ?? 0) + positions)
    }
  }
}

export const caReader: SponsorReader = {
  country: 'CA',
  async read(fetcher) {
    const files = newestFiles(await getText(fetcher, API))
    if (files.length === 0) throw notRecognised(API)
    const byEmployer = new Map<string, Acc>()
    for (const url of files) {
      await addQuarter(url, await getFile(fetcher, url, { timeoutMs: FILE_TIMEOUT_MS }), byEmployer)
    }
    const entries: SponsorEntry[] = [...byEmployer].map(([name, acc]) => {
      // Array.sort is stable, so a tie keeps the order the file gave
      const top = [...acc.byOccupation].sort((a, b) => b[1] - a[1]).slice(0, 2)
      const head = `${acc.positions} ${acc.positions === 1 ? 'position' : 'positions'} in the last ${QUARTERS} quarters`
      return { name, detail: top.length > 0 ? `${head} · ${top.map(([o]) => o).join(', ')}` : head }
    })
    return { entries, source: API }
  }
}
