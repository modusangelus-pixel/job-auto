import Database from 'better-sqlite3'
import { cleanName } from '../../shared/cleanName'

export type Db = Database.Database

const MIGRATIONS: (string | ((db: Database.Database) => void))[] = [
  // Companies: the owner's tracker columns, then what the careers lookup found.
  // lookup_attempts counts the times Claude gave no answer, so a company cannot be retried forever.
  `
  CREATE TABLE companies (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    list TEXT NOT NULL CHECK (list IN ('vehicle', 'machinery', 'both')),
    focus TEXT NOT NULL DEFAULT '',
    hq TEXT NOT NULL DEFAULT '',
    priority TEXT,
    application_status TEXT,
    notes TEXT,
    english_only TEXT,
    visa_sponsorship TEXT,
    careers_url TEXT,
    jobs_url TEXT,
    job_system TEXT,
    board TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'direct', 'needs_claude', 'blocked', 'not_found')),
    note TEXT,
    error TEXT,
    lookup_attempts INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT
  );
  `,
  // Step 2 detection fixes: bare career<n>.successfactors servers and SmartRecruiters' my-applications / oneclick-ui
  // pages were never real boards, so those companies go back to not checked yet. Every other SmartRecruiters company
  // is blocked by its robots.txt. careers_url, jobs_url, note and lookup_attempts stay as they are.
  `
  UPDATE companies
     SET status = 'pending', job_system = NULL, board = NULL, error = NULL, checked_at = NULL
   WHERE (job_system = 'successfactors' AND board LIKE 'career%.successfactors.%')
      OR (job_system = 'smartrecruiters' AND lower(board) IN ('my-applications', 'oneclick-ui'));
  UPDATE companies
     SET status = 'blocked',
         -- same text as SMARTRECRUITERS_BLOCKED in careers/check.ts
         error = 'SmartRecruiters does not allow automated reading of its job feed (robots.txt)'
   WHERE job_system = 'smartrecruiters';
  `,
  // Step 2: the jobs read from each board, the app's settings, and what the last read of a company found.
  `
  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    countries TEXT NOT NULL DEFAULT '',          -- alpha-2 codes joined by ','
    employment TEXT NOT NULL DEFAULT 'unknown',
    url TEXT NOT NULL,
    posted_at TEXT,
    posted_rough INTEGER NOT NULL DEFAULT 0,
    details_read INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    closed_at TEXT,
    baseline INTEGER NOT NULL DEFAULT 0,          -- found on its board's first read: never New
    status TEXT CHECK (status IN ('interested','applied','interview','offer','rejected','not_interested')),
    notes TEXT NOT NULL DEFAULT '',
    UNIQUE (company_id, source_id)
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  ALTER TABLE companies ADD COLUMN read_board TEXT;   -- system:board of the last successful read
  ALTER TABLE companies ADD COLUMN read_at TEXT;
  ALTER TABLE companies ADD COLUMN read_error TEXT;
  `,
  // Step 2b: the official visa sponsor lists (norm is the cleaned name), when each was read, and the matches
  // the owner rejected as wrong.
  `
  CREATE TABLE sponsor_entries (
    country TEXT NOT NULL,
    name TEXT NOT NULL,
    norm TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX sponsor_entries_norm ON sponsor_entries (norm);
  CREATE TABLE sponsor_lists (
    country TEXT PRIMARY KEY,
    fetched_at TEXT,
    source TEXT,
    entries INTEGER NOT NULL DEFAULT 0,
    error TEXT
  );
  CREATE TABLE sponsor_rejects (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    country TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (company_id, country, name)
  );
  `,
  // Step 2b fixes: names are cleaned a little differently now (a leading "the" goes; ø, æ, ß, ł and the like are
  // spelled out), so the stored cleaned names are worked out again rather than waiting for each list's next read.
  (db) => {
    const rows = db.prepare('SELECT rowid AS id, name, norm FROM sponsor_entries').all() as {
      id: number
      name: string
      norm: string
    }[]
    const update = db.prepare('UPDATE sponsor_entries SET norm = ? WHERE rowid = ?')
    for (const r of rows) {
      const norm = cleanName(r.name)
      if (norm !== r.norm) update.run(norm, r.id)
    }
  },
  // A rejected match is kept by its cleaned name, so a list that spells it differently next time stays rejected.
  (db) => {
    const rows = db.prepare('SELECT company_id, country, name FROM sponsor_rejects').all() as {
      company_id: number
      country: string
      name: string
    }[]
    db.prepare('DELETE FROM sponsor_rejects').run()
    const insert = db.prepare(
      'INSERT OR IGNORE INTO sponsor_rejects (company_id, country, name) VALUES (?, ?, ?)'
    )
    for (const r of rows) insert.run(r.company_id, r.country, cleanName(r.name))
  },
  // Step 2c: seven more job systems are recognised, so the needs-Claude companies with their own link go back to
  // not checked yet, once; the lookup re-checks them from that link without Claude. A job board link is not the
  // company's own: these patterns follow JOB_BOARD_HOST / isJobBoardSite in careers/detect.ts.
  `
  UPDATE companies
     SET status = 'pending', job_system = NULL, board = NULL
   WHERE status = 'needs_claude'
     AND trim(coalesce(careers_url, '')) <> ''
     AND lower(careers_url) NOT LIKE '%linkedin.com%'
     AND lower(careers_url) NOT LIKE '%ziprecruiter.com%'
     AND lower(careers_url) NOT LIKE '%indeed.%'
     AND lower(careers_url) NOT LIKE '%glassdoor.%'
     AND lower(careers_url) NOT LIKE '%stepstone.%'
     AND lower(careers_url) NOT LIKE '%monster.%';
  `
]

/** Opens (and migrates) the database. */
export function openDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // The background lookup writes while the main process reads; wait briefly instead of failing on a lock.
  db.pragma('busy_timeout = 5000')
  const version = db.pragma('user_version', { simple: true }) as number
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      const m = MIGRATIONS[v]
      if (typeof m === 'string') db.exec(m)
      else m(db)
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
  return db
}
