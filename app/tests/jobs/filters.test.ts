import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDb, type Db } from '../../src/main/db/db'
import { addCompanies, findCompany } from '../../src/main/db/companies'
import { saveRead, fittingJobs } from '../../src/main/db/jobs'
import { setSetting } from '../../src/main/db/settings'
import {
  DEFAULT_FILTERS,
  applyRules,
  foldText,
  hasWord,
  loadFilters,
  rulesFor,
  saveFilters,
  titleFits,
  type RuleResult
} from '../../src/main/jobs/filters'
import type { Employment, RawJob } from '../../src/shared/types'

const f = DEFAULT_FILTERS
const fits = (title: string, countries = ['SE'], employment: Employment = 'unknown'): RuleResult =>
  applyRules({ title, countries, employment }, f)

describe('applyRules', () => {
  test.each([
    'Project Coordinator, Validation',
    'Quality Manager',
    'Engineering Project Manager',
    'Process Improvement Specialist',
    'Change Manager',
    'PMO Analyst',
    'Graduate Programme – Operations',
    'Proje Yöneticisi',
    'Kalite Uzmanı',
    'Süreç İyileştirme Koordinatörü',
    'SUREC IYILESTIRME UZMANI',
    'Lean Coordinator'
  ])('keeps %s', (title) => {
    expect(fits(title).fits).toBe(true)
  })

  test.each([
    ['Quality Engineer', 'engineer'],
    ['Process Engineer', 'engineer'],
    ['Project Engineer', 'engineer'],
    ['Senior Project Manager', 'level'],
    ['Sr. Program Manager', 'level'],
    ['Head of Quality', 'level'],
    ['Kıdemli Proje Yöneticisi', 'level'],
    ['KIDEMLİ PROJE YÖNETİCİSİ', 'level'],
    ['Project Management Intern', 'type'],
    ['Master Thesis: Process Mining', 'type'],
    ['Werkstudent Projektmanagement', 'type'],
    ['Projektledare', 'role'],
    ['Software Developer', 'role'],
    ['Programmer', 'role'],
    ['Data Processing Clerk', 'role']
  ])('drops %s as %s', (title, reason) => {
    expect(fits(title)).toEqual({ fits: false, reason })
  })

  test('region cases', () => {
    expect(fits('Project Manager', ['IN'])).toEqual({ fits: false, reason: 'region' })
    expect(fits('Project Manager', [])).toEqual({
      fits: true,
      regionGroups: [],
      locationUnclear: true
    })
    expect(fits('Project Manager', ['TR', 'DE'])).toEqual({
      fits: true,
      regionGroups: ['europe', 'turkey'],
      locationUnclear: false
    })
  })

  test('a switched-off region does not count', () => {
    const off = { ...f, regions: { ...f.regions, turkey: false } }
    const job = (
      title: string,
      countries: string[]
    ): Pick<RawJob, 'title' | 'countries' | 'employment'> => ({
      title,
      countries,
      employment: 'unknown' as const
    })
    expect(applyRules(job('Proje Yöneticisi', ['TR']), off)).toEqual({
      fits: false,
      reason: 'region'
    })
    expect(applyRules(job('Project Manager', ['TR', 'DE']), off)).toMatchObject({
      fits: true,
      regionGroups: ['europe']
    })
  })

  test('employment decides the type', () => {
    expect(fits('Project Manager', ['SE'], 'part_time')).toEqual({ fits: false, reason: 'type' })
    expect(fits('Project Manager', ['SE'], 'intern')).toEqual({ fits: false, reason: 'type' })
    expect(fits('Project Manager', ['SE'], 'fixed_term').fits).toBe(true)
  })
})

describe('matching', () => {
  test('foldText', () => {
    expect(foldText('SÜREÇ İyileştirme')).toBe('surec iyilestirme')
  })
  test('hasWord: words, phrases, wildcards, blanks', () => {
    expect(hasWord('Head of Quality', ['head of'])).toBe(true)
    expect(hasWord('Head Quality of', ['head of'])).toBe(false)
    expect(hasWord('Quality Manager', ['', '  '])).toBe(false)
    expect(hasWord('Continuous Improvement Lead', ['continuous impro*'])).toBe(true)
  })
  test('the owner words are folded: Süreç* matches surecler', () => {
    expect(hasWord('surecler', ['Süreç*'])).toBe(true)
  })
  test('an owner word with ø still matches, with or without the ø in the title', () => {
    expect(hasWord('Kvalitetsingeniør', ['kvalitetsingeniør'])).toBe(true)
    expect(hasWord('Kvalitetsingenior', ['Kvalitetsingeniør'])).toBe(true)
    expect(hasWord('Projektleder, Køge', ['køge'])).toBe(true)
  })
  test('titleFits ignores country and employment', () => {
    expect(titleFits('Project Manager', f)).toBe(true)
    expect(titleFits('Project Engineer', f)).toBe(false)
  })
  test('one set of prepared rules answers job after job', () => {
    const rules = rulesFor(f)
    const results = [
      rules.apply({ title: 'Project Manager', countries: ['SE'], employment: 'unknown' }),
      rules.apply({ title: 'Senior Project Manager', countries: ['SE'], employment: 'unknown' }),
      rules.apply({ title: 'Süreç Geliştirme Uzmanı', countries: ['TR'], employment: 'full_time' }),
      rules.apply({ title: 'Project Engineer', countries: [], employment: 'unknown' }),
      rules.apply({ title: 'Quality Coordinator', countries: ['JP'], employment: 'unknown' }),
      rules.apply({ title: 'Change Manager', countries: [], employment: 'part_time' }),
      rules.apply({ title: 'Software Developer', countries: ['SE'], employment: 'unknown' }),
      rules.apply({ title: 'Change Manager', countries: [], employment: 'unknown' })
    ]
    expect(results).toEqual([
      { fits: true, regionGroups: ['nordics'], locationUnclear: false },
      { fits: false, reason: 'level' },
      { fits: true, regionGroups: ['turkey'], locationUnclear: false },
      { fits: false, reason: 'engineer' },
      { fits: false, reason: 'region' },
      { fits: false, reason: 'type' },
      { fits: false, reason: 'role' },
      { fits: true, regionGroups: [], locationUnclear: true }
    ])
    expect(rules.titleFits('Project Manager')).toBe(true)
    expect(rules.titleFits('Project Engineer')).toBe(false)
  })
})

describe('settings and stored jobs', () => {
  let dir = ''
  let db: Db
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'job-filters-'))
    db = openDb(join(dir, 'job-auto.db'))
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('save then load round-trips, dropping blanks', () => {
    const mine = {
      ...f,
      keep: ['  alpha ', '', '   ', 'beta'],
      regions: { ...f.regions, usa: false }
    }
    saveFilters(db, mine)
    expect(loadFilters(db)).toEqual({ ...mine, keep: ['alpha', 'beta'] })
  })

  test('a missing key, bad JSON or a bad field falls back to the defaults', () => {
    expect(loadFilters(db)).toEqual(f)
    setSetting(db, 'filters', '{nope')
    expect(loadFilters(db)).toEqual(f)
    setSetting(
      db,
      'filters',
      JSON.stringify({ keep: 'x', level: ['boss'], regions: { usa: false, turkey: 3 } })
    )
    const got = loadFilters(db)
    expect(got.keep).toEqual(f.keep)
    expect(got.level).toEqual(['boss'])
    expect(got.regions.usa).toBe(false)
    expect(got.regions.turkey).toBe(true)
  })

  test('fittingJobs returns only fitting jobs with regionGroups filled', () => {
    addCompanies(db, [{ name: 'Acme', list: 'vehicle' }])
    const cid = findCompany(db, 'Acme')!.id
    const raw = (sourceId: string, title: string, countries: string[]): RawJob => ({
      sourceId,
      title,
      location: '',
      countries,
      employment: 'full_time',
      url: `https://example.com/${sourceId}`,
      postedAt: null,
      postedRough: false,
      needsDetails: false
    })
    saveRead(
      db,
      cid,
      'greenhouse:acme',
      [
        raw('1', 'Project Manager', ['SE', 'US']),
        raw('2', 'Project Engineer', ['SE']),
        raw('3', 'Quality Manager', []),
        raw('4', 'Quality Manager', ['IN'])
      ],
      true,
      new Date('2026-11-01T10:00:00Z')
    )
    const jobs = fittingJobs(db, f, new Date('2026-11-02T10:00:00Z'))
    expect(jobs.map((j) => j.title)).toEqual(['Project Manager', 'Quality Manager'])
    expect(jobs[0].regionGroups).toEqual(['nordics', 'usa'])
    expect(jobs[0].locationUnclear).toBe(false)
    expect(jobs[1].regionGroups).toEqual([])
    expect(jobs[1].locationUnclear).toBe(true)
  })
})
