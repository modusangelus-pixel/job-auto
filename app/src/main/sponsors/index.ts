import { caReader } from './ca'
import { dkReader } from './dk'
import { nlReader } from './nl'
import type { SponsorReader } from './types'
import { ukReader } from './uk'

export type { SponsorEntry, SponsorReader } from './types'

export const SPONSOR_READERS: SponsorReader[] = [ukReader, nlReader, dkReader, caReader]
