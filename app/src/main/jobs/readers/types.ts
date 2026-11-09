import type { Fetcher } from '../../readers/fetcher'
import type { RawJob } from '../../../shared/types'

export interface ReadResult {
  jobs: RawJob[]
  complete: boolean
  note: string | null
}

export interface Reader {
  /** now: the check's clock, for sites that give relative dates such as "Posted 3 Days Ago". */
  list(fetcher: Fetcher, board: string, now: Date): Promise<ReadResult>
  /** Fills countries, employment and postedAt for a job read with needsDetails. */
  details?(fetcher: Fetcher, board: string, job: RawJob): Promise<RawJob>
}
