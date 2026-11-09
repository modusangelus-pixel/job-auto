# JOB-AUTO Step 1: Companies — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows app that imports the owner's company tracker, has Claude find each company's careers page, works out the job system behind it, and shows every company as read directly, needs Claude reading, blocked or not found, so the owner can review and fix the list.

**Architecture:**

- **Two halves.** The Electron main process owns the database, the network and Claude. The React screens talk to it only through a typed API exposed by the preload script, the same split as DRESS-AUTO.
- **Finding careers pages.** Claude Code runs headless in batches of 5 companies. Each run returns JSON with a careers link and a jobs link per company. The app then decides each company's status with plain rules: it recognises the job system from the link, or failing that from the page's HTML, and fetches the page politely.
- **Copied from DRESS-AUTO, not shared.** Files are copied and adapted: data folder, polite fetcher, Claude runner, build setup and styles.

**Tech Stack:**

- **App framework:** Electron, TypeScript, electron-vite and React
- **Database:** better-sqlite3
- **Spreadsheets:** exceljs for reading the tracker `.xlsx`
- **Web pages:** robots-parser for robots.txt rules
- **Validation:** zod for Claude's answers
- **Tests:** vitest and @testing-library/react
- **Installer:** electron-builder (NSIS)

**Spec:** `JOB-AUTO/docs/2026-11-03-job-auto-design.md`. This plan covers §11 step 1, "Companies", and the parts of §4, §7.2, §8.2 and §10 it needs.

## Global Constraints

### Where things live

- All code lives in `JOB-AUTO/app/`. All commands below run from `JOB-AUTO/app/`.
- Work is committed straight to `main` (owner). It is pushed only when the owner asks.
- Nothing is imported from `DRESS-AUTO/`. Files are copied, so changing one app never breaks the other (owner).

### Platform and versions

- **Platform:** Windows 11 and Node.js 24 (v24.19.0 is installed).
- **Package versions:** every package DRESS-AUTO also uses keeps the exact version in `DRESS-AUTO/app/package.json`. New: `exceljs` `4.4.0`, an exact version with no `^`.

### Where data lives

- **Database:** `%USERPROFILE%\JOB-AUTO\job-auto.db`, with `refresh.log` beside it.
- **Test runs:** started from a dev build or from a Claude session (`CLAUDECODE` set), the app works in `%USERPROFILE%\JOB-AUTO\test\`. It uses a copy of the real database, made the first time, and never writes back. `JOB_AUTO_DATA_DIR` overrides the folder.
- **Electron's own files** (`userData`) go in `<data folder>\electron`, and Claude's empty working folder is `<data folder>\claude`. The app reads and writes nothing else (owner).

### Rules for reading sites

- **Robots.txt:** obey `robots.txt`. A URL it disallows is never fetched, and the company is marked `blocked`.
- **Speed:** wait at least 1500 ms between requests to the same host.
- **Identification:** User-Agent `JOB-AUTO/0.1 (personal job search)`.
- **No workarounds:** never work around bot protection, CAPTCHAs or logins. A site that blocks gets the status `blocked`.
- **Company sites only (owner):** a link on `linkedin.com`, `indeed.*`, `glassdoor.*`, `stepstone.*`, `monster.*` or `ziprecruiter.com` is never stored as a careers or jobs link.

### Claude

- **How it runs:** Claude Code's CLI, headless, on the Claude account signed in on the computer. Never `--bare` and never an API key.
- **Isolation:** only the `WebSearch` and `WebFetch` tools. `--setting-sources ''` means none of the owner's settings, hooks or CLAUDE.md apply, and `--strict-mcp-config` with no config means no connectors.

### Wording

- **Language:** the interface is in English.
- **Lists:** stored as `'vehicle' | 'machinery' | 'both'` and shown as Vehicle, Machinery and Both.
- **Status labels**, exactly as written:

  | Status | Label |
  |---|---|
  | `pending` | not checked yet |
  | `direct` | read directly |
  | `needs_claude` | needs Claude reading |
  | `blocked` | blocked |
  | `not_found` | not found |

## Review Focus

1. **Claude's answer is messy.** It may wrap the JSON in prose or a code fence, skip a company, invent an id, or give a LinkedIn or Indeed link. Only the JSON array is read. Unknown ids are dropped, and job-board links become `null`. A company left out twice becomes `not_found` with the note "Claude gave no answer for this company". Tests: Task 7 and Task 8.
2. **The owner's tracker isn't quite as expected.** It may have a renamed or missing column, blank rows, a name listed twice, or an unexpected Category.
   - A missing required column gives a message that names it, and nothing is imported.
   - Blank rows are skipped.
   - Duplicates and unknown categories are reported by row number, and the other rows are still imported.

   Tests: Task 4.
3. **A careers link redirects to its job system**, for example `careers.acme.com` → `acme.wd3.myworkdayjobs.com/External`. The final address is used for detection, so the status is `direct`. Tests: Task 5 and Task 8.
4. **Stop is pressed, or the app closes, during a lookup.** Companies in the unfinished batch stay `pending`, never `not_found`, and the next **Find careers pages** continues with them. Tests: Task 8.
5. **Claude Code is missing, not signed in, or a run fails.** The button says what's needed. A failed run marks no company, and the run stops with Claude's message in the log and on screen. Tests: Task 8 and Task 10.

---

### Task 1: App skeleton

**Files:**
- Create: `JOB-AUTO/app/package.json`
- Create: `JOB-AUTO/app/electron.vite.config.ts`
- Create: `JOB-AUTO/app/electron-builder.yml`
- Create: `JOB-AUTO/app/tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create: `JOB-AUTO/app/vitest.config.mts`
- Create: `JOB-AUTO/app/eslint.config.mjs`
- Create: `JOB-AUTO/app/.gitignore`, `.prettierrc.yaml`, `.prettierignore`, `.editorconfig`
- Create: `JOB-AUTO/app/build/icon.ico`, `build/icon.png`, `resources/icon.png`
- Create: `JOB-AUTO/app/src/main/index.ts`
- Create: `JOB-AUTO/app/src/preload/index.ts`, `src/preload/index.d.ts`
- Create: `JOB-AUTO/app/src/renderer/index.html`
- Create: `JOB-AUTO/app/src/renderer/src/main.tsx`, `App.tsx`, `env.d.ts`, `assets/main.css`
- Test: `JOB-AUTO/app/tests/smoke.test.ts`

**Interfaces:**
- Produces: a window showing the heading "JOB-AUTO"; `npm test`, `npm run typecheck`, `npm run build` and `npm run build:unpack` all work.

- [ ] **Step 1: Copy the build setup from `DRESS-AUTO/app/`**
  - **Copied unchanged:** `tsconfig*.json`, `vitest.config.mts`, `eslint.config.mjs`, `.prettierrc.yaml`, `.prettierignore`, `.editorconfig` and `.gitignore`. Also the icons, which are a placeholder until step 4.
  - **`electron.vite.config.ts`:** copied, without the `mcp` input. `main` keeps the default entry.
  - **`electron-builder.yml`:** copied, with `appId: app.jobauto`, `productName: JOB-AUTO`, `executableName: JOB-AUTO` and `artifactName: JOB-AUTO-Setup-${version}.${ext}`.
  - **`package.json`:** `name` `job-auto`, `productName` `JOB-AUTO`, `version` `0.1.0`, `description` "Keeps a list of open jobs at your target companies". The `scripts` and `devDependencies` are DRESS-AUTO's, verbatim. `dependencies` are DRESS-AUTO's without `@modelcontextprotocol/sdk` and `fflate`, plus `"exceljs": "4.4.0"`.
- [ ] **Step 2: Write the window and an empty preload**
  - **`src/main/index.ts`:** DRESS-AUTO's, keeping the single-instance lock, `createWindow` and the external-link handler. Without the database, worker and IPC, which come in Tasks 2 and 9. `setAppUserModelId('app.jobauto')`.
  - **`src/preload/index.ts`:** exposes nothing yet.
  - **`index.html`:** title `JOB-AUTO`.
  - **`main.css`:** DRESS-AUTO's `assets/main.css`, copied for the same look and themes.
  - **`App.tsx`:** renders `<h1>JOB-AUTO</h1>`.
- [ ] **Step 3: Copy `tests/smoke.test.ts` from DRESS-AUTO and install**

Run: `npm install`, then `npm test`, then `npm run typecheck`, then `npm run build`
Expected: install finishes, and its postinstall rebuilds better-sqlite3 for Electron. 1 test passes, the typecheck is clean, and the build writes `out/`.

- [ ] **Step 4: Commit**

```bash
git add JOB-AUTO/app
git commit -m "feat(job-auto): app skeleton copied from DRESS-AUTO's setup"
```

---

### Task 2: Data folder and log

**Files:**
- Create: `JOB-AUTO/app/src/main/dataDir.ts`
- Create: `JOB-AUTO/app/src/main/log.ts`
- Modify: `JOB-AUTO/app/src/main/index.ts`
- Test: `JOB-AUTO/app/tests/dataDir.test.ts`
- Test: `JOB-AUTO/app/tests/log.test.ts`

**Interfaces:**
- Produces:
  - `DB_FILE = 'job-auto.db'`
  - `interface DataPlace { dir: string; realDir: string; test: boolean }`
  - `dataPlace(env: NodeJS.ProcessEnv, home: string, dev: boolean): DataPlace`
  - `prepareDataDir(place: DataPlace): void`
  - `createLog(dir: string): (line: string) => void`

- [ ] **Step 1: Write the failing tests**

```ts
// dataDir.test.ts (home = a fresh temp folder per test)
test('a normal start uses the JOB-AUTO folder in the user folder', () =>
  expect(dataPlace({}, home, false)).toEqual({ dir: join(home, 'JOB-AUTO'), realDir: join(home, 'JOB-AUTO'), test: false }))
test('a Claude session or a dev build is a test run in JOB-AUTO\\test', () => {
  expect(dataPlace({ CLAUDECODE: '1' }, home, false).dir).toBe(join(home, 'JOB-AUTO', 'test'))
  expect(dataPlace({}, home, true)).toMatchObject({ dir: join(home, 'JOB-AUTO', 'test'), test: true })
})
test('JOB_AUTO_DATA_DIR wins', () => expect(dataPlace({ JOB_AUTO_DATA_DIR: 'D:\\x' }, home, true).dir).toBe('D:\\x'))
test('a test run starts from a copy of the real database, made once, never written back', () => {
  // real job-auto.db made with better-sqlite3: CREATE TABLE t(x); INSERT INTO t VALUES (1)
  // prepareDataDir(test place) -> test copy has the row; insert 2 into the copy; prepareDataDir again;
  // copy still has both rows, real db still has only 1
})
test('a test run with no real database starts empty', () => {
  // prepareDataDir creates the folder; no job-auto.db in it
})
// log.test.ts
test('appends timestamped lines to refresh.log', () => {
  // createLog(dir)('hello') -> file matches /^\d{4}-\d\d-\d\dT.* hello\n$/
})
test('moves refresh.log to refresh.log.1 once it passes 1 MB', () => {})
test('never throws, even when the folder is gone', () => expect(() => createLog(join(home, 'missing'))('x')).not.toThrow())
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/dataDir.test.ts tests/log.test.ts`
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 3: Implement `dataDir.ts` and `log.ts`**
  - **Source:** DRESS-AUTO's `dataDir.ts` with the names changed: `JOB-AUTO`, `job-auto.db`, `JOB_AUTO_DATA_DIR`.
  - **`prepareDataDir`:** has no AppData move, because this app is new. In a test run, when the folder has no database and the real one exists, it makes a consistent copy (keep `copyDb` with `VACUUM INTO`).
  - **`createLog`:** the rotating append from DRESS-AUTO's `refresh-worker.ts`.
- [ ] **Step 4: Wire it into `index.ts`** Before `app.whenReady()`, compute `place = dataPlace(process.env, homedir(), is.dev)`, call `prepareDataDir(place)`, then `app.setPath('userData', join(place.dir, 'electron'))`.
- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/dataDir.test.ts tests/log.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add JOB-AUTO/app
git commit -m "feat(job-auto): data folder in the user folder, test runs on a copy, refresh log"
```

---

### Task 3: Database and company store

**Files:**
- Create: `JOB-AUTO/app/src/shared/types.ts`
- Create: `JOB-AUTO/app/src/main/db/db.ts`
- Create: `JOB-AUTO/app/src/main/db/companies.ts`
- Test: `JOB-AUTO/app/tests/db/companies.test.ts`

**Interfaces:**
- Produces, in `shared/types.ts`:

```ts
export type CompanyList = 'vehicle' | 'machinery' | 'both'
export type CompanyStatus = 'pending' | 'direct' | 'needs_claude' | 'blocked' | 'not_found'
export type JobSystem =
  | 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'workable'
  | 'recruitee' | 'personio' | 'workday' | 'successfactors'
export interface JobBoard { system: JobSystem; board: string }
export interface Company {
  id: number
  name: string
  list: CompanyList
  focus: string
  hq: string
  priority: string | null
  applicationStatus: string | null
  notes: string | null
  englishOnly: string | null
  visaSponsorship: string | null
  careersUrl: string | null
  jobsUrl: string | null
  jobBoard: JobBoard | null
  status: CompanyStatus
  note: string | null
  error: string | null
  checkedAt: string | null
}
export type NewCompany = Pick<Company, 'name' | 'list'> &
  Partial<Pick<Company, 'focus' | 'hq' | 'priority' | 'applicationStatus' | 'notes' | 'englishOnly' | 'visaSponsorship' | 'careersUrl'>>
export interface CheckResult {
  careersUrl: string | null
  jobsUrl: string | null
  status: Exclude<CompanyStatus, 'pending'>
  jobBoard: JobBoard | null
  note: string | null
  error: string | null
}
export interface ImportResult { added: number; skipped: number; errors: string[] }
export interface LookupProgress {
  running: boolean
  done: number
  total: number
  current: string[]
  step: string | null
  lastSummary: string | null
}
```

- Produces, in `db/db.ts`: `type Db`, and `openDb(path: string): Db`, which uses WAL, `foreign_keys`, `busy_timeout = 5000`, and `user_version` migrations as in DRESS-AUTO.
- Produces, in `db/companies.ts`:
  - `addCompanies(db: Db, rows: NewCompany[]): { added: number; skipped: string[] }`
  - `listCompanies(db: Db): Company[]`, ordered by name, ignoring case
  - `getCompany(db: Db, id: number): Company | undefined`
  - `findCompany(db: Db, name: string): Company | undefined`, which trims and ignores case
  - `moveCompany(db: Db, id: number, list: CompanyList): void`
  - `removeCompany(db: Db, id: number): void`
  - `pendingCompanies(db: Db): Company[]`, ordered by id
  - `saveCheck(db: Db, id: number, r: CheckResult): void`, which also sets `checked_at` to now
  - `noteFailedLookup(db: Db, id: number, maxAttempts: number): void`
  - `resetCompany(db: Db, id: number): void`
  - `statusCounts(db: Db): Record<CompanyStatus, number>`

- [ ] **Step 1: Write the failing tests**

```ts
test('adds companies and skips names already there, whatever the case', () => {
  expect(addCompanies(db, [{ name: 'Waymo', list: 'vehicle' }, { name: 'Konecranes', list: 'machinery' }])).toEqual({ added: 2, skipped: [] })
  expect(addCompanies(db, [{ name: 'waymo ', list: 'both' }])).toEqual({ added: 0, skipped: ['waymo'] })
  expect(listCompanies(db).map((c) => [c.name, c.list, c.status])).toEqual([['Konecranes', 'machinery', 'pending'], ['Waymo', 'vehicle', 'pending']])
  expect(findCompany(db, ' WAYMO')!.name).toBe('Waymo')
})
test('saveCheck stores the result and the job board', () => {
  saveCheck(db, id, { careersUrl: 'https://waymo.com/careers', jobsUrl: 'https://boards.greenhouse.io/waymo', status: 'direct',
    jobBoard: { system: 'greenhouse', board: 'waymo' }, note: null, error: null })
  expect(getCompany(db, id)).toMatchObject({ status: 'direct', jobBoard: { system: 'greenhouse', board: 'waymo' }, checkedAt: expect.any(String) })
})
test('a company Claude skips twice becomes not found', () => {
  noteFailedLookup(db, id, 2); expect(getCompany(db, id)!.status).toBe('pending')
  noteFailedLookup(db, id, 2); expect(getCompany(db, id)).toMatchObject({ status: 'not_found', note: 'Claude gave no answer for this company' })
})
test('resetCompany puts a company back to not checked, clearing links, board, note, error and attempts', () => {})
test('move, remove and statusCounts', () => {
  // statusCounts returns all five keys, zeros included
})
test('the database refuses an unknown list', () => expect(() => addCompanies(db, [{ name: 'X', list: 'cars' as CompanyList }])).toThrow())
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/db/companies.test.ts`
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 3: Implement `openDb` with migration 1**

```sql
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
```

- [ ] **Step 4: Implement `companies.ts`** Names are trimmed before insert. Rows map from snake_case to the `Company` shape, and `job_system` with `board` become `jobBoard`, or `null` when `job_system` is null.
- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/db/companies.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add JOB-AUTO/app
git commit -m "feat(job-auto): company database with statuses and job boards"
```

---

### Task 4: Tracker import

**Files:**
- Create: `JOB-AUTO/app/src/main/tracker/importTracker.ts`
- Test: `JOB-AUTO/app/tests/tracker/importTracker.test.ts`

**Interfaces:**
- Consumes: `addCompanies`, `NewCompany` and `ImportResult` from Task 3.
- Produces:
  - `readTracker(path: string): Promise<{ rows: NewCompany[]; errors: string[] }>`
  - `importTracker(db: Db, path: string): Promise<ImportResult>`

- [ ] **Step 1: Write the failing tests** Each test writes a small `.xlsx` to a temp folder with exceljs. A helper, `writeTracker(rows, { sheet?, headers? })`, takes the owner's header row by default:

```ts
const HEADERS = ['Company', 'Category', 'Industry / focus', 'Headquarters / origin', 'Target countries',
  'Local presence / locations', 'Career page', 'English-only opportunities', 'Visa sponsorship',
  'Target positions', 'Priority', 'Research status', 'Application status', 'Notes']

test('reads the Master Company List into the three lists', async () => {
  // rows: Waymo/Vehicle, Konecranes/Machinery, ABB/Both -> lists vehicle, machinery, both
  // focus and hq come from 'Industry / focus' and 'Headquarters / origin'; 'Unknown' stays 'Unknown'
})
test('a missing Company or Category column imports nothing and names the column', async () => {
  expect((await readTracker(fileWithout('Category'))).errors).toEqual(['The sheet has no "Category" column.'])
})
test('a file without the Master Company List sheet says so', async () => {
  expect((await readTracker(otherSheetFile)).errors).toEqual(['The file has no "Master Company List" sheet.'])
})
test('blank rows are skipped; an unknown category and a repeated name are reported by row', async () => {
  // row 3 blank, row 4 Category "Cars", row 5 repeats row 2's name in another case
  expect(result.errors).toEqual(['Row 4 (Acme): unknown category "Cars", not imported.', 'Row 5 (waymo): listed twice, kept the first.'])
})
test('Career page fills careersUrl when it is a web link, including hyperlink cells', async () => {})
test('importing again adds only the new companies', async () => {
  expect(await importTracker(db, file)).toEqual({ added: 3, skipped: 0, errors: [] })
  expect(await importTracker(db, file)).toEqual({ added: 0, skipped: 3, errors: [] })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/tracker/importTracker.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `readTracker` and `importTracker`**
  - **Sheet:** `Master Company List`, with headers in row 1, matched by exact text.
  - **Required columns:** `Company` and `Category`. The other columns in `HEADERS` are optional.
  - **Category:** matched case-insensitively against `Vehicle`, `Machinery` and `Both`.
  - **Cell text:** a cell's value can be a string, a number, `{ text }`, `{ richText: [{ text }] }` or `{ hyperlink, text }`. All of them become trimmed text.
  - **Career page:** a value counts only when it starts with `http://` or `https://`.
  - **The rest:** Target countries, Local presence, Target positions and Research status are not imported.
- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/tracker/importTracker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add JOB-AUTO/app
git commit -m "feat(job-auto): import the company tracker spreadsheet"
```

---

### Task 5: Polite fetcher

**Files:**
- Create: `JOB-AUTO/app/src/main/readers/fetcher.ts`
- Test: `JOB-AUTO/app/tests/readers/fetcher.test.ts`

**Interfaces:**
- Produces:
  - `USER_AGENT = 'JOB-AUTO/0.1 (personal job search)'`
  - `class BlockedError extends Error { host: string; reason: string }`
  - `interface FetchResult { status: number; body: string; url: string }`, where `url` is the final address after redirects
  - `interface Fetcher { get(url: string): Promise<FetchResult | null> }`, which returns `null` when robots.txt disallows the URL
  - `createFetcher(opts?: { delayMs?; timeoutMs?; fetchImpl?; now?; sleep? }): Fetcher`
  - `requestsInFlight()`

- [ ] **Step 1: Copy DRESS-AUTO's `tests/readers/fetcher.test.ts`** Rename the imports, then add:

```ts
test('reports the final address after a redirect', async () => {
  // fakeFetch returns a Response whose url is set with
  // Object.defineProperty(res, 'url', { value: 'https://acme.wd3.myworkdayjobs.com/External' })
  expect((await f.get('https://careers.acme.test/'))!.url).toBe('https://acme.wd3.myworkdayjobs.com/External')
})
test('falls back to the requested address when the response has none', async () => {})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/readers/fetcher.test.ts`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Copy DRESS-AUTO's `readers/fetcher.ts`** Change the `USER_AGENT`, and return `url: res.url || url` from each request.
- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/readers/fetcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add JOB-AUTO/app
git commit -m "feat(job-auto): polite fetcher that reports where redirects end"
```

---

### Task 6: Job-system detection

**Files:**
- Create: `JOB-AUTO/app/src/main/careers/detect.ts`
- Test: `JOB-AUTO/app/tests/careers/detect.test.ts`

**Interfaces:**
- Consumes: `JobBoard` from Task 3.
- Produces:
  - `isJobBoardSite(url: string): boolean`
  - `detectFromUrl(url: string): JobBoard | null`
  - `detectFromHtml(html: string, pageUrl: string): JobBoard | null`

- [ ] **Step 1: Write the failing tests**

```ts
test.each([
  ['https://boards.greenhouse.io/waymo', 'greenhouse', 'waymo'],
  ['https://job-boards.greenhouse.io/scaleai/jobs/123', 'greenhouse', 'scaleai'],
  ['https://job-boards.eu.greenhouse.io/acme', 'greenhouse', 'acme'],
  ['https://boards.greenhouse.io/embed/job_board?for=nuro', 'greenhouse', 'nuro'],
  ['https://jobs.lever.co/zoox', 'lever', 'zoox'],
  ['https://jobs.eu.lever.co/acme/abc-123', 'lever', 'eu:acme'],
  ['https://jobs.ashbyhq.com/wayve', 'ashby', 'wayve'],
  ['https://jobs.smartrecruiters.com/Konecranes', 'smartrecruiters', 'Konecranes'],
  ['https://careers.smartrecruiters.com/SGS', 'smartrecruiters', 'SGS'],
  ['https://apply.workable.com/exotec/', 'workable', 'exotec'],
  ['https://kion.recruitee.com/o/some-job', 'recruitee', 'kion'],
  ['https://acme.jobs.personio.de/job/1', 'personio', 'acme'],
  ['https://acme.jobs.personio.com', 'personio', 'acme'],
  ['https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite', 'workday', 'nvidia.wd5/NVIDIAExternalCareerSite'],
  ['https://acme.wd3.myworkdayjobs.com/External/job/X', 'workday', 'acme.wd3/External'],
  ['https://career5.successfactors.eu/career?company=AcmeP&career_ns=job_listing', 'successfactors', 'career5.successfactors.eu/AcmeP']
])('%s is %s %s', (url, system, board) => expect(detectFromUrl(url)).toEqual({ system, board }))

test('a plain careers page or a job board site is not a job system', () => {
  expect(detectFromUrl('https://www.acme.com/careers')).toBeNull()
  expect(detectFromUrl('https://www.linkedin.com/company/acme/jobs')).toBeNull()
  expect(detectFromUrl('not a url')).toBeNull()
})
test('isJobBoardSite knows LinkedIn, Indeed, Glassdoor, StepStone, Monster and ZipRecruiter, subdomains included', () => {
  expect(isJobBoardSite('https://se.indeed.com/jobs?q=x')).toBe(true)
  expect(isJobBoardSite('https://www.glassdoor.co.uk/x')).toBe(true)
  expect(isJobBoardSite('https://www.acme.com/careers')).toBe(false)
})
test('finds the job system linked or embedded in a careers page', () => {
  expect(detectFromHtml('<a href="https://jobs.lever.co/zoox">Jobs</a>', 'https://zoox.com/careers')).toEqual({ system: 'lever', board: 'zoox' })
  expect(detectFromHtml('<script src="https://boards.greenhouse.io/embed/job_board/js?for=nuro"></script>', 'https://nuro.ai/careers'))
    .toEqual({ system: 'greenhouse', board: 'nuro' })
  expect(detectFromHtml('<iframe src="https://acme.wd3.myworkdayjobs.com/en-US/External"></iframe>', 'https://acme.com/jobs'))
    .toEqual({ system: 'workday', board: 'acme.wd3/External' })
})
test('a SuccessFactors career site on its own domain is recognised by its asset host', () =>
  expect(detectFromHtml('<link href="https://rmkcdn.successfactors.com/abc/main.css">', 'https://jobs.acme.com/search'))
    .toEqual({ system: 'successfactors', board: 'jobs.acme.com' }))
test('a page linking only to LinkedIn has no job system', () =>
  expect(detectFromHtml('<a href="https://www.linkedin.com/company/acme/jobs">', 'https://acme.com/careers')).toBeNull())
test('with several systems linked, the first in the fixed order wins', () => {
  // order: greenhouse, lever, ashby, smartrecruiters, workable, recruitee, personio, workday, successfactors
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/careers/detect.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `detect.ts`** `detectFromUrl` parses the address with `URL` and matches the host:
  - **Workday:** skips a locale path segment such as `en-US`.
  - **Lever:** EU-hosted boards are prefixed `eu:`.
  - **SuccessFactors:** the board is `host/company` when there's a `company` parameter, otherwise the host.

  `detectFromHtml` pulls every `https?://…` address out of the HTML and runs `detectFromUrl` on each, keeping the best by the fixed order. Failing that, it treats `rmkcdn.successfactors.com` as a marker and returns `successfactors` with the host of `pageUrl`.
- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/careers/detect.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add JOB-AUTO/app
git commit -m "feat(job-auto): recognise job systems from links and careers pages"
```

---

### Task 7: Claude lookup runner

**Files:**
- Create: `JOB-AUTO/app/src/main/careers/claude.ts`
- Test: `JOB-AUTO/app/tests/careers/claude.test.ts`

**Interfaces:**
- Consumes: `Company` from Task 3, and `isJobBoardSite` from Task 6.
- Produces:
  - `findClaude(env?, exists?): string | null`, copied verbatim from DRESS-AUTO's `agent/claude.ts`
  - `LOOKUP_RULES: string`
  - `lookupArgs(): string[]`
  - `lookupPrompt(companies: Pick<Company, 'id' | 'name' | 'hq' | 'focus'>[]): string`
  - `interface LookupAnswer { id: number; careersUrl: string | null; jobsUrl: string | null; note: string }`
  - `parseLookupResult(text: string, ids: number[]): LookupAnswer[]`
  - `readLookupLine(text: string): { step?: string; done?: { ok: boolean; text: string } }`
  - `runClaude(opts: { claudePath: string; args: string[]; prompt: string; cwd: string; timeoutMs: number; onStep(text: string): void }): { stop(): void; done: Promise<{ ok: boolean; text: string }> }`

- [ ] **Step 1: Write the failing tests**

```ts
test('headless on the owner\'s login with only web search and page reading', () => {
  const a = lookupArgs(); const v = (f: string): string => a[a.indexOf(f) + 1]
  expect(a).toContain('-p'); expect(v('--output-format')).toBe('stream-json'); expect(a).toContain('--verbose')
  expect(a).toContain('--no-session-persistence'); expect(a).not.toContain('--bare')
  expect(v('--setting-sources')).toBe(''); expect(a).toContain('--strict-mcp-config'); expect(a).not.toContain('--mcp-config')
  expect(v('--tools')).toBe('WebSearch,WebFetch'); expect(v('--allowedTools')).toBe('WebSearch,WebFetch')
  expect(v('--permission-mode')).toBe('dontAsk'); expect(v('--append-system-prompt')).toBe(LOOKUP_RULES)
})
test('the prompt lists each company with its id, headquarters and focus', () =>
  expect(lookupPrompt([{ id: 7, name: 'Waymo', hq: 'USA', focus: 'Autonomous driving' }]))
    .toContain('id 7: Waymo (headquarters: USA; Autonomous driving)'))
test('reads the JSON array even inside prose or a code fence', () => {
  const text = 'Here you go:\n```json\n[{"id":7,"careersUrl":"https://waymo.com/careers","jobsUrl":"https://boards.greenhouse.io/waymo","note":""}]\n```'
  expect(parseLookupResult(text, [7])).toEqual([{ id: 7, careersUrl: 'https://waymo.com/careers', jobsUrl: 'https://boards.greenhouse.io/waymo', note: '' }])
})
test('drops ids it did not ask for and items without a numeric id, keeps the first of a repeated id, and reads a missing note as empty', () => {})
test('job board links, non-web links, "null" and empty strings become null', () => {
  const text = '[{"id":1,"careersUrl":"https://www.linkedin.com/company/x/jobs","jobsUrl":"null","note":"gone"}]'
  expect(parseLookupResult(text, [1])).toEqual([{ id: 1, careersUrl: null, jobsUrl: null, note: 'gone' }])
})
test('text that is not JSON gives no answers', () => expect(parseLookupResult('Sorry, I could not do that.', [1])).toEqual([]))
test('stream lines become steps and a final result', () => {
  expect(readLookupLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'Waymo careers' } }] } })))
    .toEqual({ step: 'Searching the web: Waymo careers' })
  expect(readLookupLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebFetch', input: { url: 'https://waymo.com/careers/' } }] } })))
    .toEqual({ step: 'Reading waymo.com/careers/' })
  expect(readLookupLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '[]' }))).toEqual({ done: { ok: true, text: '[]' } })
  expect(readLookupLine(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: '' })).done!.ok).toBe(false)
  expect(readLookupLine('not json')).toEqual({})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/careers/claude.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `claude.ts`**
  - **`lookupArgs()`** returns, in order: `-p`, `--output-format stream-json`, `--verbose`, `--no-session-persistence`, `--setting-sources ''`, `--strict-mcp-config`, `--tools WebSearch,WebFetch`, `--allowedTools WebSearch,WebFetch`, `--permission-mode dontAsk`, `--append-system-prompt LOOKUP_RULES`.
  - **`lookupPrompt`** is `Find the careers pages of these companies:` followed by one line per company in the tested format.
  - **`parseLookupResult`** strips code fences, parses from the first `[` to the last `]`, and validates each item with zod.
  - **`runClaude`** is DRESS-AUTO's `runAgent`, using `readLookupLine` and keeping the timeout and `taskkill /T /F` tree kill.
  - **`LOOKUP_RULES`** is exactly:

```text
You find the official careers pages of companies for JOB-AUTO, the owner's personal job-search app.
For each company in the request:
- Find the company's own official careers page with WebSearch. Never LinkedIn, Indeed, Glassdoor or any other job board.
- Open it with WebFetch and follow it to the page that lists the open jobs, for example a "Search jobs" or "View all jobs" link. That page is often on a job system such as Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee, Personio or SuccessFactors.
- When the company has a global careers site and country sites, give the global one.
- When the company no longer exists, was taken over, or has no careers page you can find, give null for both links and say why in the note.
- When a page is blocked or asks for a captcha or a login, don't try to get around it: give the link you found and write "blocked" in the note.
- Never guess a link. Give only links you saw.
Answer with only a JSON array, one object per company, in the order asked:
[{"id": <id>, "careersUrl": "<link or null>", "jobsUrl": "<link or null>", "note": "<one short sentence or empty>"}]
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/careers/claude.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add JOB-AUTO/app
git commit -m "feat(job-auto): Claude finds careers pages and answers in JSON"
```

---

### Task 8: Careers check and lookup queue

**Files:**
- Create: `JOB-AUTO/app/src/main/careers/check.ts`
- Create: `JOB-AUTO/app/src/main/careers/lookup.ts`
- Test: `JOB-AUTO/app/tests/careers/check.test.ts`
- Test: `JOB-AUTO/app/tests/careers/lookup.test.ts`

**Interfaces:**
- Consumes: `Fetcher` and `BlockedError` from Task 5, the detection functions from Task 6, `LookupAnswer`, `lookupArgs`, `lookupPrompt`, `parseLookupResult` and `runClaude` from Task 7, and the store functions from Task 3.
- Produces:
  - `checkCareers(fetcher: Fetcher, careersUrl: string | null, jobsUrl: string | null, note: string | null): Promise<CheckResult>`
  - `checkLink(db: Db, fetcher: Fetcher, id: number, url: string): Promise<Company>`, which throws an `Error` with a message for the screen
  - `interface BatchOutcome { ok: boolean; answers: LookupAnswer[]; summary: string }`
  - `createLookup(deps)`, where `deps` is `{ db: Db; fetcher: Fetcher; runBatch(companies: Company[], signal: AbortSignal): Promise<BatchOutcome>; log(line: string): void; onProgress(p: LookupProgress): void; batchSize?: number; maxAttempts?: number }`. It returns `{ start(): Promise<void>; stop(): void; progress(): LookupProgress }`. Defaults: `batchSize` 5, `maxAttempts` 2.
  - `makeRunBatch(opts: { findClaudePath(): string | null; cwd: string; timeoutMs: number; onStep(step: string): void }): (companies: Company[], signal: AbortSignal) => Promise<BatchOutcome>`. It is the real `runBatch`, and has no Electron import, so the app and the live check in Task 11 share it.

- [ ] **Step 1: Write the failing tests for `checkCareers`** They use a fake `Fetcher` that returns set results or throws, and records the URLs it was asked for.

```ts
test('no links: not found', async () => expect((await checkCareers(f, null, null, 'acquired by X')).status).toBe('not_found'))
test('a jobs link on a job system: read directly, without fetching anything', async () => {
  const r = await checkCareers(f, 'https://waymo.com/careers', 'https://boards.greenhouse.io/waymo', null)
  expect(r).toMatchObject({ status: 'direct', jobBoard: { system: 'greenhouse', board: 'waymo' } }); expect(f.calls).toEqual([])
})
test('robots.txt forbids the page: blocked', async () =>
  expect(await checkCareers(fetcherReturning(null), 'https://acme.com/careers', null, null))
    .toMatchObject({ status: 'blocked', error: 'robots.txt does not allow reading this page' }))
test('the site refuses the reader: blocked, with the reason', async () =>
  expect(await checkCareers(fetcherThrowing(new BlockedError('acme.com', 'HTTP 403')), 'https://acme.com/careers', null, null))
    .toMatchObject({ status: 'blocked', error: 'HTTP 403' }))
test('a redirect to Workday: read directly', async () => {})        // fetch result url = https://acme.wd3.myworkdayjobs.com/External
test('a job system embedded in the page: read directly', async () => {})
test('a page with no known job system: needs Claude reading', async () => {})
test('HTTP 404: needs Claude reading with the error "HTTP 404"', async () => {})
test('a network error: needs Claude reading with its message', async () => {})
```

- [ ] **Step 2: Write the failing tests for `createLookup` and `checkLink`** These use a temp database, a fake fetcher, and a fake `runBatch` that records the batches it gets.

```ts
test('companies that already have a link are checked without Claude', async () => {})
test('12 companies without links go to Claude in batches of 5, 5 and 2', async () => {
  await lookup.start(); expect(batches.map((b) => b.length)).toEqual([5, 5, 2])
})
test('a company missing from two answers becomes not found', async () => {})
test('a failed run marks nobody, stops, and logs and shows the summary', async () => {
  // runBatch -> { ok: false, answers: [], summary: 'Not logged in' }
  // all 12 still pending; one batch tried; progress().lastSummary === 'Not logged in'
  expect(logLines).toContain('lookup batch failed: Not logged in')
})
test('stop during a batch aborts the run and leaves that batch not checked yet', async () => {
  // runBatch waits on its signal; lookup.stop(); await start's promise; signal.aborted is true; those 5 still 'pending'
})
test('start while running does not start a second run', async () => {})
test('progress counts companies done out of those pending at start, with the batch names as current', async () => {})
test('checkLink refuses a link that is not a web address or is a job board site', async () => {
  await expect(checkLink(db, f, id, 'mailto:x@y.z')).rejects.toThrow('Paste a link that starts with http:// or https://')
  await expect(checkLink(db, f, id, 'https://www.linkedin.com/company/acme/jobs')).rejects.toThrow("Use the company's own careers page, not a job board")
})
test('checkLink saves the result with the note "Link added by you"', async () => {})
test('makeRunBatch without Claude Code fails the batch with a plain message', async () =>
  expect(await makeRunBatch({ findClaudePath: () => null, cwd: tmp, timeoutMs: 1000, onStep: () => {} })([company], new AbortController().signal))
    .toEqual({ ok: false, answers: [], summary: 'Claude Code was not found on this computer.' }))
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run tests/careers/check.test.ts tests/careers/lookup.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement `checkCareers`** It applies these rules in order:
  1. Both links are null: `not_found`.
  2. Try `detectFromUrl` on the jobs link, then on the careers link. A match: `direct`, with no fetch.
  3. Otherwise fetch the jobs link, or the careers link if there's no jobs link.
     - A `null` result: `blocked`, with the error "robots.txt does not allow reading this page".
     - A `BlockedError`: `blocked`, with the error set to its `reason`.
     - Any other error: `needs_claude`, with its message.
  4. Status 400 or above: `needs_claude`, with the error `HTTP <status>`.
  5. Try `detectFromUrl(result.url)`, then `detectFromHtml(result.body, result.url)`. A match: `direct`. Otherwise `needs_claude`.
- [ ] **Step 5: Implement `createLookup`** One run at a time.
  - **First, companies with a link:** the pending companies that already have a careers link go through `checkCareers` directly.
  - **Then the rest, in batches:**
    - **For each batch:** set the progress `current` to the batch names, then call `runBatch`.
    - **A failed run** (`ok: false`): record `lastSummary`, log `lookup batch failed: <summary>`, and end the run without marking anyone.
    - **A successful run:** each answered company goes through `checkCareers` and `saveCheck`, and each unanswered one through `noteFailedLookup(maxAttempts)`.
  - **Stop:** `stop()` aborts the signal, and the loop ends after the current call returns without saving that batch.
  - **Log lines:**
    - `lookup started: <n> companies`
    - `<name>: <status>`, followed by ` (<system> <board>)` when there's a board and `, <error>` when there's an error
    - `lookup stopped`
    - `lookup finished`
- [ ] **Step 6: Implement `makeRunBatch`**
  - **No Claude Code:** when `findClaudePath()` returns null, it returns the tested outcome.
  - **A run:** `runClaude` gets `lookupArgs()`, `lookupPrompt(companies)`, `opts.cwd` (created if missing) and `opts.timeoutMs`. The signal's `abort` calls `run.stop()`.
  - **Its result:** `{ ok: done.ok, answers: done.ok ? parseLookupResult(done.text, ids) : [], summary: done.text }`.
- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/careers`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add JOB-AUTO/app
git commit -m "feat(job-auto): decide each company's status and look them up in batches"
```

---

### Task 9: Wiring: API, preload and main process

**Files:**
- Create: `JOB-AUTO/app/src/shared/api.ts`
- Create: `JOB-AUTO/app/src/main/ipc.ts`
- Modify: `JOB-AUTO/app/src/preload/index.ts`, `src/preload/index.d.ts`
- Modify: `JOB-AUTO/app/src/main/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–8.
- Produces: `window.jobAuto: JobAutoApi`, with channels named `job-auto:<name>`:

```ts
export interface JobAutoApi {
  listCompanies(): Promise<Company[]>
  /** Asks for the tracker file (.xlsx); null when the dialog is cancelled. */
  importTracker(): Promise<ImportResult | null>
  /** With a link, the link is checked at once. */
  addCompany(name: string, list: CompanyList, careersUrl: string | null): Promise<Company>
  moveCompany(id: number, list: CompanyList): Promise<void>
  removeCompany(id: number): Promise<void>
  /** Rejects with a message the screen shows as it is. */
  pasteCareersLink(id: number, url: string): Promise<Company>
  /** Back to "not checked yet", so the next lookup includes it. */
  lookUpAgain(id: number): Promise<void>
  lookupInfo(): Promise<{ claudePath: string | null; progress: LookupProgress }>
  /** Resolves when the run ends. */
  startLookup(): Promise<void>
  stopLookup(): Promise<void>
  onLookupProgress(cb: (p: LookupProgress) => void): () => void
  openExternal(url: string): Promise<void>
  appInfo(): Promise<{ version: string; dataPath: string; test: boolean }>
}
```

- [ ] **Step 1: Write `api.ts`, `preload/index.ts` and `index.d.ts`** Follow DRESS-AUTO's pattern, with `IPC` constants and `contextBridge.exposeInMainWorld('jobAuto', api)`.
- [ ] **Step 2: Write `ipc.ts`, exporting `registerIpc(db: Db, place: DataPlace, log: (line: string) => void): { stop(): void }`**
  - **The fetcher:** one `createFetcher()` for the app.
  - **`runBatch`:** `makeRunBatch({ findClaudePath: findClaude, cwd: join(place.dir, 'claude'), timeoutMs: 15 * 60_000, onStep })`, where `onStep` updates the progress `step`.
  - **`addCompany`:** a name already in the app (`findCompany`) rejects with `<name> is already in the app.`
  - **Progress:** goes to the window on `job-auto:lookup-progress`.
  - **`openExternal`:** opens only `http(s)` links.
  - **The tracker dialog:** filters to `.xlsx`, titled "Pick your company tracker".
- [ ] **Step 3: Update `index.ts`**
  - **Startup order:** `openDb(join(place.dir, DB_FILE))`, then `createLog(place.dir)`, then `registerIpc`.
  - **Closing:** `before-quit` stops the lookup and logs `app closing`.
  - **No automatic lookup** at start (call): the owner presses the button, because a full lookup uses the Claude plan for hours.
- [ ] **Step 4: Check that it builds**

Run: `npm run typecheck`, then `npm run lint`, then `npm run build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add JOB-AUTO/app
git commit -m "feat(job-auto): connect companies, import and lookup to the window"
```

---

### Task 10: Companies screen

**Files:**
- Create: `JOB-AUTO/app/src/renderer/src/screens/Companies.tsx`
- Create: `JOB-AUTO/app/src/renderer/src/labels.ts`
- Modify: `JOB-AUTO/app/src/renderer/src/App.tsx`
- Modify: `JOB-AUTO/app/src/renderer/src/assets/main.css`
- Test: `JOB-AUTO/app/tests/renderer/Companies.test.tsx`

**Interfaces:**
- Consumes: `window.jobAuto` from Task 9.
- Produces:
  - `STATUS_LABEL: Record<CompanyStatus, string>`, with the Global Constraints wording
  - `SYSTEM_LABEL: Record<JobSystem, string>`: Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, Personio, Workday and SuccessFactors
  - `Companies(): React.JSX.Element`

- [ ] **Step 1: Write the failing tests** Use jsdom and a mocked `window.jobAuto`, as in DRESS-AUTO's `AgentPanel.test.tsx`.

```ts
test('with no companies it offers the tracker import and reports the result', async () => {
  // click 'Import your company tracker (.xlsx)' -> importTracker resolves { added: 255, skipped: 0, errors: ['Row 4 (Acme): ...'] }
  expect(await screen.findByText('Added 255 companies. 0 were already in the app.')).toBeTruthy()
  expect(screen.getByText(/Row 4 \(Acme\)/)).toBeTruthy()
})
test('tabs show Vehicle, Machinery and Both with their counts; Vehicle first', async () => {})
test('status chips count each status and filter the rows', async () => {
  // chips: All, not checked yet, read directly, needs Claude reading, blocked, not found
})
test('a row shows the job system, the status, the link, and the note or error', async () => {})
test('without Claude Code the lookup button is off and says why', async () => {
  // lookupInfo -> claudePath null
  expect(await screen.findByText('Needs Claude Code on this computer, signed in.')).toBeTruthy()
})
test('Find careers pages shows progress and a Stop button while running', async () => {
  // button text 'Find careers pages (12 to check)'; progress event { running: true, done: 3, total: 12, current: ['Waymo'], step: 'Searching the web: Waymo careers' }
  expect(screen.getByText('Checked 3 of 12 · now: Waymo · Searching the web: Waymo careers')).toBeTruthy()
})
test('a failed run shows its summary', async () => {})          // progress lastSummary 'Not logged in' shown after the run ends
test('pasting a link updates the row, and a refused link shows the message', async () => {})
test('move to another list, remove after confirm, and add a company', async () => {})
test('Look up again puts a company back to not checked yet', async () => {})   // calls lookUpAgain(id), row shows 'not checked yet'
test('a test run says so', async () => {
  // appInfo test true
  expect(await screen.findByText('Test run: working on a copy of your data.')).toBeTruthy()
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/renderer/Companies.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement `labels.ts`, `Companies.tsx` and the `App.tsx` shell**
  - **`App.tsx`:** a sidebar with only Companies for now, using DRESS-AUTO's layout classes. The Jobs, Metrics and Settings screens come in later steps.
  - **`Companies.tsx`:** reloads the list when `done` changes in a progress event, and when a run ends.
  - **Styles:** add only the CSS the screen needs, under a `.companies` block.
- [ ] **Step 4: Run all tests and checks**

Run: `npm test`, then `npm run typecheck`, then `npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add JOB-AUTO/app
git commit -m "feat(job-auto): Companies screen with lists, statuses and careers lookup"
```

---

### Task 11: README, build and first real run

**Files:**
- Create: `JOB-AUTO/README.md`
- Create: `JOB-AUTO/app/tests/live/lookup.live.test.ts`

- [ ] **Step 1: Write `JOB-AUTO/README.md`** in the style of DRESS-AUTO's README.
  - **What step 1 does.**
  - **Install:** including the SmartScreen "More info → Run anyway" note.
  - **First run:**
    - Companies → **Import your company tracker**.
    - Then **Find careers pages**. It runs in batches of 5, takes hours for 255 companies, uses your Claude plan, and can be stopped and continued.
  - **What each status means.**
  - **Fixing a wrong link:** paste the right one on the company's row.
  - **Where data is stored, and test runs.**
  - **Build from source:** `npm install`, `npm test`, `npm run build:win`.
  - **Documents:** links to the design and this plan.
- [ ] **Step 2: Build the app**

Run: `npm test`, then `npm run lint`, then `npm run typecheck`, then `npm run build:unpack`
Expected: all pass, and `dist/win-unpacked/JOB-AUTO.exe` exists.

- [ ] **Step 3: Write the live check `tests/live/lookup.live.test.ts`**
  - **Opt-in:** it is skipped unless `JOB_AUTO_LIVE=1`, using `test.skipIf`, so `npm test` never touches the network or Claude.
  - **What it does:**
    - Import the file named in `JOB_AUTO_TRACKER` into a temp database.
    - Expect Vehicle 112, Machinery 82 and Both 61.
    - Run `createLookup` with the real fetcher and `makeRunBatch`, stopping once 5 companies are done.
    - Expect 5 companies with a status other than `pending`, and a log line for each.
- [ ] **Step 4: Run the live check once**

Run: `JOB_AUTO_LIVE=1 JOB_AUTO_TRACKER="C:\path\to\tracker.xlsx" npx vitest run tests/live`
Expected: PASS within about 15 minutes. The 5 statuses and links look right when checked by hand.

- [ ] **Step 5: Open the built app in a test run** Start `dist/win-unpacked/JOB-AUTO.exe` from this Claude session, which makes it a test run in `JOB-AUTO\test\`. Expected: the window opens on Companies, with the test-run line and the import button. Take a screenshot.
- [ ] **Step 6: Commit**

```bash
git add JOB-AUTO/README.md JOB-AUTO/app/tests/live
git commit -m "docs(job-auto): README for step 1, and an opt-in live lookup check"
```

- [ ] **Step 7: Hand over to the owner**
  - The owner starts `JOB-AUTO.exe` from Explorer, which is a real run, and imports the tracker.
  - They press **Find careers pages** and let it run, which can take hours.
  - Afterwards they review the statuses and paste links for wrong or not-found companies.
  - Push to GitHub when the owner asks.
