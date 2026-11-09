import type { JobSystem } from '../../../shared/types'
import { ashby } from './ashby'
import { avature } from './avature'
import { comeet } from './comeet'
import { eightfold } from './eightfold'
import { greenhouse } from './greenhouse'
import { icims } from './icims'
import { lever } from './lever'
import { oracle } from './oracle'
import { personio } from './personio'
import { radancy } from './radancy'
import { successfactors } from './successfactors'
import type { Reader } from './types'
import { workable } from './workable'
import { workday } from './workday'

export const READERS: Partial<Record<JobSystem, Reader>> = {
  greenhouse,
  lever,
  ashby,
  workable,
  personio,
  workday,
  successfactors,
  icims,
  oracle,
  comeet,
  eightfold,
  avature,
  radancy
}
