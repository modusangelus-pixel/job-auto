import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDb, type Db } from '../src/main/db/db'
import { setSetting } from '../src/main/db/settings'
import { loadWorkRights, saveWorkRights } from '../src/main/db/workRights'
import type { SponsorCountry } from '../src/shared/types'
import { WORK_RIGHT_GROUPS, countryLine, visaTag } from '../src/shared/visa'

const match = { country: 'GB' as const, name: 'Acme Ltd', detail: 'Skilled Worker' }

describe('visaTag', () => {
  const ALL: SponsorCountry[] = ['GB', 'NL', 'DK', 'CA']
  test('no visa needed when a job country is a work country', () => {
    expect(visaTag({ countries: ['SE'], sponsors: [] }, ['SE', 'NO'], ALL)).toBe('No visa needed')
  })
  test('UK job on the list', () => {
    expect(visaTag({ countries: ['GB'], sponsors: [match] }, [], ALL)).toBe(
      'On the UK sponsor list'
    )
  })
  test('UK job with no match on the list', () => {
    expect(visaTag({ countries: ['GB'], sponsors: [] }, [], ALL)).toBe(
      'No match on the UK sponsor list'
    )
  })
  test('a list never read says nothing', () => {
    expect(visaTag({ countries: ['GB'], sponsors: [] }, [], [])).toBeNull()
    expect(visaTag({ countries: ['GB'], sponsors: [] }, [], ['NL', 'DK', 'CA'])).toBeNull()
  })
  test('country without a list gives null', () => {
    expect(visaTag({ countries: ['DE'], sponsors: [] }, [], ALL)).toBeNull()
  })
  test('first sponsor country decides', () => {
    expect(visaTag({ countries: ['DE', 'NL', 'GB'], sponsors: [] }, [], ALL)).toBe(
      'No match on the Netherlands sponsor list'
    )
  })
  test('first sponsor country whose list was read decides', () => {
    expect(visaTag({ countries: ['NL', 'GB'], sponsors: [] }, [], ['GB'])).toBe(
      'No match on the UK sponsor list'
    )
  })
})

describe('countryLine', () => {
  test('SE', () => {
    expect(countryLine('SE', 'Sweden')).toEqual({
      text: 'Sweden publishes no sponsor list. After a job offer the employer starts your work permit with the Migration Agency.',
      link: 'https://www.migrationsverket.se'
    })
  })
  test('US', () => {
    expect(countryLine('US', 'United States')).toEqual({
      text: "The USA's H-1B employer data can't be read automatically. Most hires need an H-1B visa, drawn by lottery each spring.",
      link: 'https://www.uscis.gov'
    })
  })
  test('other EU/EEA', () => {
    expect(countryLine('FR', 'France')).toEqual({
      text: 'No public sponsor list. Employers hire from outside the EU on an EU Blue Card or a national work permit.',
      link: 'https://immigration-portal.ec.europa.eu'
    })
  })
  test('any other', () => {
    expect(countryLine('RS', 'Serbia')).toEqual({
      text: 'Serbia publishes no sponsor list the app can read.',
      link: null
    })
  })
  test.each(['GB', 'NL', 'DK', 'CA'])('%s has a list, so no line', (code) => {
    expect(countryLine(code, 'X')).toBeNull()
  })
})

describe('work rights', () => {
  let dir: string
  let db: Db
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wr-'))
    db = openDb(join(dir, 'job-auto.db'))
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('groups are exact', () => {
    expect(WORK_RIGHT_GROUPS.map((g) => g.label)).toEqual([
      'EU/EEA and Switzerland',
      'UK',
      'USA',
      'Canada',
      'Australia',
      'New Zealand',
      'Turkey'
    ])
  })
  test('empty by default', () => {
    expect(loadWorkRights(db)).toEqual([])
  })
  test('round-trips and drops unknown labels', () => {
    saveWorkRights(db, ['UK', 'Narnia', 'Turkey'])
    expect(loadWorkRights(db)).toEqual(['UK', 'Turkey'])
  })
  test('bad JSON or wrong types fall back to empty', () => {
    setSetting(db, 'workRights', '{nope')
    expect(loadWorkRights(db)).toEqual([])
    setSetting(db, 'workRights', '{"a":1}')
    expect(loadWorkRights(db)).toEqual([])
    setSetting(db, 'workRights', '["UK", 3]')
    expect(loadWorkRights(db)).toEqual([])
  })
})
