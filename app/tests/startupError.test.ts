import { expect, test } from 'vitest'
import { startupErrorText } from '../src/main/startupError'

test('the startup message says what failed, where, and why, in that order', () => {
  expect(
    startupErrorText(
      'The database could not be opened.',
      'C:\\Users\\you\\JOB-AUTO\\job-auto.db',
      new Error('database is locked')
    )
  ).toBe(
    'The database could not be opened.\n\nC:\\Users\\you\\JOB-AUTO\\job-auto.db\n\ndatabase is locked'
  )
})

test('something thrown that is not an Error is shown as text', () => {
  expect(startupErrorText('The app could not start.', 'C:\\data', 'boom')).toBe(
    'The app could not start.\n\nC:\\data\n\nboom'
  )
})
