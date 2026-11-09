import type { JobAutoApi } from '../shared/api'

declare global {
  interface Window {
    jobAuto: JobAutoApi
  }
}
