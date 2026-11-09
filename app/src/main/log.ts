import { appendFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Writes timestamped lines to refresh.log in the given folder; the previous log is kept as refresh.log.1 once it
 * passes 1 MB.
 */
export function createLog(dir: string): (line: string) => void {
  const logPath = join(dir, 'refresh.log')
  return (line) => {
    try {
      const size = statSync(logPath, { throwIfNoEntry: false })?.size ?? 0
      if (size > 1_000_000) renameSync(logPath, `${logPath}.1`)
      appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`)
    } catch {
      // Logging must never stop a refresh.
    }
  }
}
