import { WORK_RIGHT_GROUPS } from '../../shared/visa'
import type { Db } from './db'
import { getSetting, setSetting } from './settings'

const KEY = 'workRights'
const KNOWN = new Set(WORK_RIGHT_GROUPS.map((g) => g.label))

/** The work-rights group labels the owner ticked. */
export function loadWorkRights(db: Db): string[] {
  const text = getSetting(db, KEY)
  if (text === null) return []
  let saved: unknown
  try {
    saved = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(saved) || !saved.every((x) => typeof x === 'string')) return []
  return (saved as string[]).filter((x) => KNOWN.has(x))
}

export function saveWorkRights(db: Db, labels: string[]): void {
  setSetting(db, KEY, JSON.stringify(labels.filter((x) => KNOWN.has(x))))
}
