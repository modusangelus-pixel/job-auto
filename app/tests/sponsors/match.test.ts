import { describe, expect, test } from 'vitest'
import { cleanName, matchesCompany } from '../../src/main/sponsors/match'

describe('cleanName', () => {
  test.each([
    ['ABB Limited', 'abb'],
    ['ABB A/S', 'abb'],
    ['VOLVO CONSTRUCTION EQUIPMENT AB', 'volvo construction equipment'],
    ['Scania (Great Britain) Limited', 'scania great britain'],
    ['AS Watson Ltd', 'as watson'],
    ['B.V. Machinefabriek', 'bv machinefabriek'],
    ['&TRADITION A/S', 'and tradition'],
    ['Kion Group AG', 'kion group'],
    ['The Mathworks Limited', 'mathworks'],
    ['the mathworks', 'mathworks'],
    ['Theodor GmbH', 'theodor'],
    ['Intel Corporation (UK) Ltd', 'intel corporation uk']
  ])('%s -> %s', (input, output) => {
    expect(cleanName(input)).toBe(output)
  })

  test('folds accents and removes several legal suffixes', () => {
    expect(cleanName('Société Générale S.A. Co')).toBe('societe generale')
  })
})

describe('matchesCompany', () => {
  test.each([
    ['abb', 'abb', true],
    ['abb grain', 'abb', false],
    ['scania great britain', 'scania', true],
    ['volvo cars uk', 'volvo', false],
    ['ab', 'ab', false],
    ['volvo group holding', 'volvo', true],
    ['volvo', 'volvo cars', false],
    ['intel corporation uk', 'intel', true],
    ['volvo ab sweden', 'volvo', false]
  ])('%s vs %s -> %s', (list, company, expected) => {
    expect(matchesCompany(list, company)).toBe(expected)
  })
})
