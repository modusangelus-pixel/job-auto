import { describe, expect, it } from 'vitest'
import { SPONSOR_READERS } from '../../src/main/sponsors'

describe('SPONSOR_READERS', () => {
  it('lists the readers in the order GB, NL, DK, CA', () => {
    expect(SPONSOR_READERS.map((r) => r.country)).toEqual(['GB', 'NL', 'DK', 'CA'])
  })
})
