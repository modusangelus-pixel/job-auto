import type { Db } from './db'

export function getSetting(db: Db, key: string): string | null {
  const value = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(key)
  return (value as string | undefined) ?? null
}

const READ_PAGES_KEY = 'readPages'

/** Settings → Reading: read script-built careers pages with Claude, weekly. On unless switched off. */
export function loadReadPages(db: Db): boolean {
  return getSetting(db, READ_PAGES_KEY) !== 'false'
}

export function saveReadPages(db: Db, on: boolean): void {
  setSetting(db, READ_PAGES_KEY, on ? 'true' : 'false')
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}
