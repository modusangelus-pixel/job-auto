import { expect, test } from 'vitest'
import { READERS } from '../../../src/main/jobs/readers'

test('READERS has the feed readers, Workday, SuccessFactors and the step 2c readers', () => {
  expect(Object.keys(READERS).sort()).toEqual([
    'ashby',
    'avature',
    'comeet',
    'eightfold',
    'greenhouse',
    'icims',
    'lever',
    'oracle',
    'personio',
    'radancy',
    'successfactors',
    'workable',
    'workday'
  ])
})
