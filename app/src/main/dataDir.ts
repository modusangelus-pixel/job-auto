// Where the database lives: a JOB-AUTO folder in the user folder, not in AppData. Windows gives everything the
// Microsoft Store version of Claude Desktop starts (its connector, Claude sessions) a private copy of AppData, so it
// would see other files than the app does.
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

export const DB_FILE = 'job-auto.db'

export interface DataPlace {
  /** Folder with job-auto.db and refresh.log for this run. */
  dir: string
  /** The owner's own data folder. */
  realDir: string
  /** Started from a Claude session or a dev build: works on a copy and leaves the owner's data alone. */
  test: boolean
}

/** Every program a Claude session starts carries CLAUDECODE; a folder passed in JOB_AUTO_DATA_DIR wins. */
export function dataPlace(env: NodeJS.ProcessEnv, home: string, dev: boolean): DataPlace {
  const realDir = join(home, 'JOB-AUTO')
  const test = dev || Boolean(env.CLAUDECODE)
  return { dir: env.JOB_AUTO_DATA_DIR || (test ? join(realDir, 'test') : realDir), realDir, test }
}

/**
 * Gets the folder ready before the database opens. A test run starts from a copy of the owner's database, made once
 * and never written back; with no real database yet it starts empty.
 */
export function prepareDataDir(place: DataPlace): void {
  mkdirSync(place.dir, { recursive: true })
  const target = join(place.dir, DB_FILE)
  if (existsSync(target) || !place.test) return
  const real = join(place.realDir, DB_FILE)
  if (existsSync(real)) copyDb(real, target)
}

/** A consistent copy, changes still in the write-ahead log included, that only takes its name once it opens. */
function copyDb(from: string, to: string): void {
  const tmp = to + '.copying'
  rmSync(tmp, { force: true })
  const src = new Database(from, { readonly: true, fileMustExist: true })
  try {
    src.prepare('VACUUM INTO ?').run(tmp)
  } finally {
    src.close()
  }
  const copy = new Database(tmp, { readonly: true, fileMustExist: true })
  copy.pragma('user_version')
  copy.close()
  renameSync(tmp, to)
}
