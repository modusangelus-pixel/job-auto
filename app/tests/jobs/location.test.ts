import { describe, expect, test } from 'vitest'
import {
  REGION_COUNTRIES,
  countriesIn,
  countryCode,
  isRegionName,
  regionGroupsOf,
  usStateCode
} from '../../src/main/jobs/location'

describe('countriesIn', () => {
  test.each([
    ['San Francisco, CA; New York, NY', ['US']],
    ['Gothenburg, Sweden', ['SE']],
    ['Hamburg, HH, Germany', ['DE']],
    ['Remote - US', ['US']],
    ['Toronto, ON', ['CA']],
    ['Sydney, NSW', ['AU']],
    ['Atlanta, Georgia', ['US']],
    ['İstanbul, Türkiye', ['TR']],
    ['Istanbul, Turkey', ['TR']],
    ['Stryama, Plovdiv, Bulgaria', ['BG']],
    ['Indianapolis, IN', ['US']],
    ['Wilmington, DE', ['US']],
    ['London, UK / Munich, Deutschland', ['GB', 'DE']],
    ['Remote', []],
    ['London', []],
    ['3 Locations', []],
    ['', []]
  ])('countriesIn reads each location shape: %j', (input, expected) => {
    expect(countriesIn(input)).toEqual(expected)
  })

  test('other shapes', () => {
    expect(countriesIn('Berlin, Germany | Paris, France')).toEqual(['DE', 'FR'])
    expect(countriesIn('Berlin (Germany)')).toEqual(['DE'])
    expect(countriesIn('Austin, TX; Dallas, Texas')).toEqual(['US'])
    expect(countriesIn('Tbilisi, Georgia')).toEqual(['US'])
  })
})

describe('countryCode', () => {
  test('maps names, aliases and bare codes', () => {
    expect(countryCode('United States')).toBe('US')
    expect(countryCode('se')).toBe('SE')
    expect(countryCode('Narnia')).toBeNull()
    expect(countryCode('Deutschland')).toBe('DE')
  })
})

describe('regionGroupsOf', () => {
  test('groups countries in region order', () => {
    expect(regionGroupsOf(['SE', 'GB', 'IN'])).toEqual(['nordics', 'europe'])
    expect(regionGroupsOf([])).toEqual([])
  })
  test('region lists', () => {
    expect(REGION_COUNTRIES.nordics).toEqual(['SE', 'NO', 'FI', 'DK'])
    expect(REGION_COUNTRIES.europe).toHaveLength(40)
    expect(REGION_COUNTRIES.turkey).toEqual(['TR'])
  })
})

describe('usStateCode', () => {
  test('maps names and codes, folded', () => {
    expect(usStateCode('Texas')).toBe('TX')
    expect(usStateCode(' tx ')).toBe('TX')
    expect(usStateCode('District of Columbia')).toBe('DC')
    expect(usStateCode('NEW YORK')).toBe('NY')
    expect(usStateCode('Paris')).toBeNull()
    expect(usStateCode('')).toBeNull()
  })
})

describe('isRegionName', () => {
  test.each([
    'USA',
    'United States',
    'Wales',
    'SE',
    'Texas',
    'TX',
    'Quebec',
    'QC',
    'Victoria',
    'NSW'
  ])('%s is a country, state or province', (part) => {
    expect(isRegionName(part)).toBe(true)
  })
  test.each(['Dallas', 'Montréal', '671 30', ''])('%s is not', (part) => {
    expect(isRegionName(part)).toBe(false)
  })
})
