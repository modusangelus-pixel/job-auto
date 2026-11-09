import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { dataPlace, DB_FILE, prepareDataDir, type DataPlace } from '../src/main/dataDir'

let home = ''
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'job-home-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

/** A database with a table t holding the given rows, closed cleanly. */
function makeDb(file: string, rows: number[]): void {
  mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.exec('CREATE TABLE t(x)')
  for (const x of rows) db.prepare('INSERT INTO t VALUES (?)').run(x)
  db.close()
}

function rowsOf(file: string): number[] {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  const rows = db.prepare('SELECT x FROM t ORDER BY x').pluck().all() as number[]
  db.close()
  return rows
}

function addRow(file: string, x: number): void {
  const db = new Database(file)
  db.prepare('INSERT INTO t VALUES (?)').run(x)
  db.close()
}

describe('dataPlace', () => {
  test('a normal start uses the JOB-AUTO folder in the user folder', () => {
    expect(dataPlace({}, home, false)).toEqual({
      dir: join(home, 'JOB-AUTO'),
      realDir: join(home, 'JOB-AUTO'),
      test: false
    })
  })

  test('a Claude session or a dev build is a test run in JOB-AUTO\\test', () => {
    expect(dataPlace({ CLAUDECODE: '1' }, home, false)).toEqual({
      dir: join(home, 'JOB-AUTO', 'test'),
      realDir: join(home, 'JOB-AUTO'),
      test: true
    })
    expect(dataPlace({}, home, true)).toMatchObject({
      dir: join(home, 'JOB-AUTO', 'test'),
      test: true
    })
  })

  test('JOB_AUTO_DATA_DIR wins', () => {
    expect(dataPlace({ JOB_AUTO_DATA_DIR: 'D:\\x' }, home, true).dir).toBe('D:\\x')
    expect(dataPlace({ JOB_AUTO_DATA_DIR: 'D:\\x', CLAUDECODE: '1' }, home, false).dir).toBe(
      'D:\\x'
    )
  })
})

describe('prepareDataDir', () => {
  const testRun = (): DataPlace => dataPlace({ CLAUDECODE: '1' }, home, false)
  const realFile = (): string => join(home, 'JOB-AUTO', DB_FILE)

  test('a test run starts from a copy of the real database, made once, never written back', () => {
    makeDb(realFile(), [1])
    prepareDataDir(testRun())
    const copy = join(testRun().dir, DB_FILE)
    expect(rowsOf(copy)).toEqual([1])

    addRow(copy, 2)
    prepareDataDir(testRun())
    expect(rowsOf(copy)).toEqual([1, 2])
    expect(rowsOf(realFile())).toEqual([1])
  })

  test('the copy includes changes still in the write-ahead log of a database another program has open', () => {
    mkdirSync(dirname(realFile()), { recursive: true })
    const open = new Database(realFile())
    open.pragma('journal_mode = WAL')
    open.exec('CREATE TABLE t(x)')
    open.prepare('INSERT INTO t VALUES (7)').run()
    try {
      prepareDataDir(testRun())
      expect(rowsOf(join(testRun().dir, DB_FILE))).toEqual([7])
    } finally {
      open.close()
    }
  })

  test('a test run with no real database starts empty', () => {
    prepareDataDir(testRun())
    expect(existsSync(testRun().dir)).toBe(true)
    expect(existsSync(join(testRun().dir, DB_FILE))).toBe(false)
  })

  test('a real run only creates the folder, and never touches a database', () => {
    const place = dataPlace({}, home, false)
    prepareDataDir(place)
    expect(existsSync(place.dir)).toBe(true)
    expect(existsSync(join(place.dir, DB_FILE))).toBe(false)
  })
})
