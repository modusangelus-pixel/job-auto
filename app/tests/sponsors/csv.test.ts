import { describe, expect, it } from 'vitest'
import { parseCsv } from '../../src/main/sponsors/csv'

describe('parseCsv', () => {
  it('handles quotes, commas and doubled quotes', () => {
    const text = 'a,"b, c","say ""hi""",\n"x",,"y\nz"\n'
    expect(parseCsv(text)).toEqual([
      ['a', 'b, c', 'say "hi"', ''],
      ['x', '', 'y\nz']
    ])
  })

  it('reads CRLF line ends, a missing final newline and a leading byte order mark', () => {
    expect(parseCsv('﻿a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
  })

  it('returns no rows for an empty text', () => {
    expect(parseCsv('')).toEqual([])
  })

  it('keeps a quote inside an unquoted field as a literal character', () => {
    expect(parseCsv('Foo "Bar" Ltd,Leeds\nAcme,York\nZed,Bath\n')).toEqual([
      ['Foo "Bar" Ltd', 'Leeds'],
      ['Acme', 'York'],
      ['Zed', 'Bath']
    ])
  })
})
