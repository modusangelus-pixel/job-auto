import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { openDb, type Db } from '../../src/main/db/db'
import { getSetting, setSetting } from '../../src/main/db/settings'

let dir = ''
let db: Db
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'job-settings-'))
  db = openDb(join(dir, 'job-auto.db'))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('a setting reads back, and an unknown key is null', () => {
  expect(getSetting(db, 'filters')).toBeNull()
  setSetting(db, 'filters', 'one')
  setSetting(db, 'filters', 'two')
  expect(getSetting(db, 'filters')).toBe('two')
  expect(getSetting(db, 'other')).toBeNull()
})
