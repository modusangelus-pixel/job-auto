import { describe, expect, test } from 'vitest'
import { employmentFrom } from '../../../src/main/jobs/readers/employment'

describe('employmentFrom', () => {
  test.each([
    ['Full-Time', 'full_time'],
    ['FullTime', 'full_time'],
    ['Part-time', 'part_time'],
    ['Intern', 'intern'],
    ['Internship', 'intern'],
    ['Interns', 'intern'],
    ['Intern/Werkstudent', 'intern'],
    ['International', 'unknown'],
    ['Internal, Full-time', 'full_time'],
    ['Contract', 'fixed_term'],
    ['Temporary', 'fixed_term'],
    ['Full time', 'full_time'],
    ['Trainee', 'unknown'],
    ['Permanent contract', 'full_time'],
    ['Full-time or part-time', 'full_time'],
    ['Permanent part-time', 'part_time'],
    ['Part-time contract', 'part_time'],
    ['Regular Full time', 'full_time'],
    ['', 'unknown']
  ])('%s -> %s', (text, expected) => {
    expect(employmentFrom(text)).toBe(expected)
  })

  test('missing text is unknown', () => {
    expect(employmentFrom(null)).toBe('unknown')
    expect(employmentFrom(undefined)).toBe('unknown')
  })
})
