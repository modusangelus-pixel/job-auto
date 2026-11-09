import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createLog } from '../src/main/log'

let home = ''
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'job-log-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

test('appends timestamped lines to refresh.log', () => {
  const log = createLog(home)
  log('hello')
  log('again')
  const lines = readFileSync(join(home, 'refresh.log'), 'utf-8')
  expect(lines).toMatch(/^\d{4}-\d\d-\d\dT\S+ hello\n\d{4}-\d\d-\d\dT\S+ again\n$/)
})

test('moves refresh.log to refresh.log.1 once it passes 1 MB', () => {
  const big = 'x'.repeat(1_000_001)
  writeFileSync(join(home, 'refresh.log'), big)
  createLog(home)('fresh')
  expect(readFileSync(join(home, 'refresh.log.1'), 'utf-8')).toBe(big)
  expect(readFileSync(join(home, 'refresh.log'), 'utf-8')).toMatch(/^\d{4}-\d\d-\d\dT\S+ fresh\n$/)
})

test('keeps a log that is not over 1 MB where it is', () => {
  writeFileSync(join(home, 'refresh.log'), 'x'.repeat(1_000_000))
  createLog(home)('more')
  expect(existsSync(join(home, 'refresh.log.1'))).toBe(false)
})

test('never throws, even when the folder is gone', () => {
  expect(() => createLog(join(home, 'missing'))('x')).not.toThrow()
})
