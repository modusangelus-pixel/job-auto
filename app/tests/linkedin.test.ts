import { describe, expect, test } from 'vitest'
import { linkedInSearches } from '../src/renderer/src/linkedin'

const BASE = 'https://www.linkedin.com/search/results/people/?keywords='

describe('linkedInSearches', () => {
  test('a quality job in a city gives three searches', () => {
    expect(linkedInSearches('Volvo CE', 'Quality Manager', 'Göteborg')).toEqual([
      { label: 'Recruiters', url: BASE + encodeURIComponent('"Volvo CE" recruiter') },
      {
        label: 'Quality managers',
        url: BASE + encodeURIComponent('"Volvo CE" quality manager')
      },
      { label: 'People in Göteborg', url: BASE + encodeURIComponent('"Volvo CE" Göteborg') }
    ])
  })

  test('no field and no city gives recruiters and hiring managers', () => {
    expect(linkedInSearches('Volvo CE', 'Software Developer', null)).toEqual([
      { label: 'Recruiters', url: BASE + encodeURIComponent('"Volvo CE" recruiter') },
      {
        label: 'Hiring managers',
        url: BASE + encodeURIComponent('"Volvo CE" hiring manager')
      }
    ])
  })

  test.each([
    ['Programme Lead', 'program'],
    ['PMO Analyst', 'program'],
    ['Proje Yöneticisi', 'project'],
    ['Kalite Mühendisi', 'quality'],
    ['Süreç Uzmanı', 'process'],
    ['Değişim Lideri', 'change'],
    ['Change and Project Lead', 'project'],
    ['Projektledare', 'project'],
    ['Senior Program Manager', 'program'],
    ['Programmes Director', 'program'],
    ['Change Manager', 'change']
  ])('%s is the %s field', (title, field) => {
    const second = linkedInSearches('X', title, null)[1]
    expect(second.label).toBe(`${field[0].toUpperCase()}${field.slice(1)} managers`)
    expect(decodeURIComponent(second.url.slice(BASE.length))).toBe(`"X" ${field} manager`)
  })

  test.each(['Software Programmer', 'Exchange Analyst', 'Subprocess Engineer'])(
    'a field word inside another word does not count: %s',
    (title) => {
      expect(linkedInSearches('X', title, null)[1].label).toBe('Hiring managers')
    }
  )

  test('brackets in the company name are left out of the searches', () => {
    const queries = linkedInSearches(
      'Mobile Industrial Robots (MiR)',
      'Quality Lead',
      'Odense'
    ).map((s) => decodeURIComponent(s.url.slice(BASE.length)))
    expect(queries).toEqual([
      '"Mobile Industrial Robots" recruiter',
      '"Mobile Industrial Robots" quality manager',
      '"Mobile Industrial Robots" Odense'
    ])
  })
})
