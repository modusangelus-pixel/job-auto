# JOB-AUTO Step 2c: Colourful Map, More Readers, Reading Script-Built Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three changes:
- the map becomes a colourful political map with country and city names;
- seven more job systems get readers;
- the careers pages that build their job list with scripts get read once a week, in a hidden window, by Claude.

**Architecture:**

- **Map.** The built-in Natural Earth data gains colour groups, names, label ranks and a small list of major cities. The map draws these offline; it still makes no requests.
- **Readers.** Each new reader follows the step 2 reader pattern: `Reader.list(fetcher, board, now)` through the polite fetcher. Each gets matching detection in `src/main/careers/detect.ts`. A migration sends the "needs Claude reading" companies back to "not checked yet", so the lookup re-checks them from their stored links with the new detection, without Claude.
- **Page reading.**
  1. For each company still "needs Claude reading", the main process opens its careers page in a hidden Electron window under the app's own User-Agent. The fetcher's robots.txt rule and per-host pace apply.
  2. The page's text and links go to Claude (`claude -p`, Sonnet, no tools), which returns JSON jobs.
  3. These reads never close jobs, run at most weekly per company, and can be switched off.

**Tech Stack:** as before: Electron 44, React 19, TypeScript, electron-vite, better-sqlite3, vitest. No new packages.

**Spec:** `JOB-AUTO/docs/2026-11-03-job-auto-design.md` §17, agreed with the owner on 2026-11-06.

## Decisions for the owner to check

1. **Map colours and labels:**
   - 7 soft fills on a light-blue sea, with a darker set for the dark theme.
   - Country names grow in as you zoom: big countries at world view, all of them by about 16× zoom.
   - About 7,300 Natural Earth city names appear as you zoom in.
   - Each job dot shows its city's name from 3× zoom.
2. **One-company job systems** have no reader of their own; they are read as pages (§17.3). Small readers can be added later if page reading proves weak for them.
3. **Synopsys and Ansys** are read from Synopsys's site map, which lists 675 job addresses. A job address gives only the city and the title, for example `/job/sunnyvale/senior-applications-engineer/…`, so:
   - the title is rebuilt from the address in plain capitals;
   - the country is found from the city name when one country clearly has the biggest city of that name; otherwise the location is marked unclear.
4. **Page reading:**
   - **When:** at most once a week per company, after the daily job check.
   - **Claude use:** one Claude run per company, about 60 a week, on your account.
   - **No closing:** these reads never mark jobs closed. Missing jobs show "not seen since".
   - **Switch:** **Settings → Reading → Read script-built careers pages with Claude (weekly)**, on by default.
5. **Re-check after the update.** The "needs Claude reading" companies with their own link go back to "not checked yet". Pressing **Find careers pages** re-checks them from their links, without Claude. Those the new readers recognise become "read directly"; the rest go back to "needs Claude reading" and are read as pages.
6. **The refusing sites' open routes** (Caterpillar's Workday, South32's SuccessFactors site, TELUS Digital's WillowTree Greenhouse board, Ansys via Synopsys) are set with **Paste link** after the update. The README lists the exact links. No company-specific code.

## Global Constraints

### Where things live

- All code is in `JOB-AUTO/app/`, and every command runs from there.
- Commit straight to `main`. Push only when the owner asks.
- The database is migrated by appending to `MIGRATIONS`; earlier migrations are never edited.
- Tests use temp folders and fakes. The owner's `%USERPROFILE%\JOB-AUTO` is never touched.

### Rules for reading sites

These are unchanged:
- Every HTTP request goes through `src/main/readers/fetcher.ts`.
- Obey robots.txt.
- Wait 1500 ms per host, or the host's Crawl-delay.
- User-Agent `JOB-AUTO/0.1 (personal job search)`.
- Never work around a block.

The hidden window adds these rules:
- It sets that same User-Agent; it never presents itself as another browser.
- It opens only addresses the fetcher's robots.txt check allows.
- It waits for the host's pace slot before loading.
- It loads one page per host at a time.
- It never logs in and never submits forms.

The app still makes no request to LinkedIn, uscis.gov, gov.ie or download.geonames.org.

### Reader contract (from step 2)

`list(fetcher, board, now)` returns `{ jobs, complete, note }`:
- A feed or page the reader doesn't recognise throws `Error('Job list not recognised on <url>')`.
- `complete: true` only for a full read.
- Paging stops at a cap, giving `complete: false` with a note.
- `sourceId` is the system's stable job id.
- Times are `toISOString()`.

### Feeds (checked 2026-11-06)

| System | Board form | Request | Data |
|---|---|---|---|
| `icims` | `host`, e.g. `careers-rws.icims.com` | GET `https://{host}/jobs/search?ss=1&in_iframe=1&pr={n}`, n = 0, 1, … | 20 rows per page. Job links look like `https://{host}/jobs/{id}/{slug}/job?in_iframe=1`, and `id` is the sourceId. Read title, location and the page count from the page; check the markup on the fixture. robots.txt allows `/jobs/search`. |
| `oracle` | `host/siteNumber`, e.g. `hdjq.fa.us2.oraclecloud.com/CX_1` | GET `https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber={site},limit=25,offset={n}` | `items[0].TotalJobsCount`; `items[0].requisitionList[]` with `Id`, `Title`, `PrimaryLocation`, `PrimaryLocationCountry`, `PostedDate` and `JobSchedule`. The job link is `https://{host}/hcmUI/CandidateExperience/en/sites/{site}/job/{Id}`. robots.txt is 404. |
| `workday` (site form) | `wdN.myworkdaysite.com/tenant/Site`, e.g. `wd3.myworkdaysite.com/magna/Magna` | POST `https://wdN.myworkdaysite.com/wday/cxs/{tenant}/{Site}/jobs`, the same body as Workday | The same fields as Workday. The job link is `https://wdN.myworkdaysite.com/recruiting/{tenant}/{Site}{externalPath}`; check it on the fixture. robots.txt returns HTTP 422, so the fetcher treats it as allow-all. |
| `comeet` | `slug/uid`, e.g. `autobrains/57.004` | GET `https://www.comeet.com/jobs/{slug}/{uid}` | `COMPANY_POSITIONS_DATA = [...]` in the page, with `uid`, `name`, `location {name, country (alpha-2), city}`, `employment_type`, `url_comeet_hosted_page` and `time_updated`. The page lists every position, so the read is complete. robots.txt allows `/jobs`. |
| `eightfold` | `host|domain`, e.g. `vale.eightfold.ai|vale.com` | GET `https://{host}/api/apply/v2/jobs?domain={domain}&start={n}&num=10` | `count`; `positions[]` with `id`, `name`, `location`/`locations`, `t_create` (epoch seconds) and `canonicalPositionUrl`. robots.txt allows `/api/apply`. |
| `avature` | `host/locale/portal`, e.g. `jobs.siemens.com/en_US/externaljobs` | GET `https://{host}/{locale}/{portal}/SearchJobs?jobOffset={n}` | `article.article--result` rows with link, title and location, plus a "<N> results" total. Check the paging step on the fixture. robots.txt allows `/externaljobs`. |
| `radancy` | `host`, e.g. `careers.synopsys.com` | GET `https://{host}/sitemap.xml` | `<loc>` entries matching `/job/{city}/{title-slug}/{tenant}/{jobId}`. `jobId` is the sourceId; the title is the slug with hyphens turned into spaces and each word capitalised; the location is the city slug the same way. A sitemap index (`<sitemapindex>`) is followed one level deep. The read is complete when at least one job address is found. robots.txt forbids `/search-jobs/` and allows the site map. |

### Map data (exact)

- **Countries:** from Natural Earth 50m, the same as now, plus these fields:
  - `n`: `NAME_EN`, or `NAME` when that is missing;
  - `m`: `MAPCOLOR7`, 1–7;
  - `r`: `MIN_LABEL`;
  - `p`: the label point from `LABEL_Y`/`LABEL_X`.
- **Cities:** from `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_populated_places_simple.geojson`, written to `src/renderer/src/assets/places.json` as `[name, lon, lat, scalerank]` rounded to 2 decimals.

**Fill colours** (`m` 1–7):

| Theme | Colours |
|---|---|
| Light | `#f2d7a6 #c9e4b8 #f5c6c6 #c7d7f0 #e6d1f2 #f7e7a1 #cde8e4`, sea `#dcebf7`, borders `#ffffff` |
| Dark | `#6b5a3a #46613d #6e4747 #3f5373 #5d4a6b #6b6436 #3e625d`, sea `#16202b`, borders `#0f1419` |

**Labels:**
- A country label shows when `r <= 2 + 2·log2(k)`, where k is the zoom (1 = world).
- A city label shows when `scalerank <= 2·log2(k)`.
- A job dot's city name shows when k ≥ 3.
- Text stays 12 px on screen (cities 11 px), with a 3 px halo in the sea colour.

## Review Focus

1. **A partial read must never close jobs.**
   - Every new paging reader stops safely.
   - Page reading always gives `complete: false`.
   - A Claude answer that is not valid JSON saves nothing.
   - Tests: Tasks 4–9 and 12.
2. **Page reading obeys robots.txt and the pace, and never disguises the app.**
   - The hidden window's User-Agent is the app's.
   - A forbidden address is never loaded.
   - Two pages of one host never load at once.
   - Tests: Task 11.
3. **Claude cost and failure.**
   - At most one run per company per 7 days.
   - The switch stops it.
   - A missing Claude, a timeout or a usage-limit message records the failure without blocking the company, and the run goes on.
   - Tests: Task 12.
4. **Map labels stay readable.** No overlap storm at world view: only big countries are named and no city names show. Labels keep their pixel size at any zoom. Light and dark themes both have contrast. Tests: Task 2, plus the controller's visual pass.
5. **Re-check after the update.** Only "needs Claude reading" companies with their own link go back to "not checked yet"; blocked and direct companies are untouched. Test: Task 10.

---

### Task 1: Map data: colours, names, label ranks, cities

**Files:**
- Modify: `scripts/build-geo-data.mjs`, `src/renderer/src/assets/countries.json`
- Create: `src/renderer/src/assets/places.json`
- Test: `tests/geo/data.test.ts`

**Interfaces:**
- Produces: countries entries `{ c, g, n, m, r, p: [lat, lon] }` and places entries `[name, lon, lat, scalerank]`.

- [ ] **Step 1: Failing tests.**
  - Every country has `n` (non-empty), `m` in 1–7, a numeric `r` and `p`.
  - SE is named `Sweden`, and SE's `m` differs from NO's and FI's.
  - `places.json` has more than 5000 rows, including `Stockholm` near 59.33, 18.07.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Extend the script, then run `npm run geo-data`.** It fetches Natural Earth twice from raw.githubusercontent.com with the app's User-Agent.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(job-auto): map data carries country colours, names, label ranks and major cities`

### Task 2: Colourful map with labels

**Files:**
- Modify: `src/renderer/src/map/WorldMap.tsx`, `src/renderer/src/assets/main.css`
- Test: `tests/renderer/WorldMap.test.tsx`

**Behaviour:** as in Map data (exact).
- The sea fills the frame and countries are filled by `m`.
- Labels are drawn outside the scaled group, at the projected point × k + translation, so their size stays fixed.
- Labels and city names are not clickable, so dots stay on top and clickable.
- The theme comes from the existing `prefers-color-scheme` handling.

- [ ] **Step 1: Failing tests.**
  - Each country path's fill is one of its theme's 7 colours.
  - At k = 1, `Russia` and `United States` labels show, `Luxembourg` doesn't, and no city label shows.
  - At k = 16, `Luxembourg` and the `Stockholm` city label show.
  - Label `font-size` stays at 12 at any zoom.
  - A dot at Göteborg shows the text `Göteborg` at k ≥ 3 and not at k = 1.
  - No `NaN` in any attribute.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(job-auto): a colourful map with country and city names that appear as you zoom`

### Task 3: Workday "site" addresses

**Files:**
- Modify: `src/main/careers/detect.ts`, `src/main/jobs/readers/workday.ts`
- Test: `tests/careers/detect.test.ts`, `tests/jobs/readers/workday.test.ts`

**Interfaces:**
- `detectFromUrl('https://wd3.myworkdaysite.com/recruiting/magna/Magna')` gives `{ system: 'workday', board: 'wd3.myworkdaysite.com/magna/Magna' }`. A locale segment before `recruiting` is skipped, as for myworkdayjobs.
- The Workday reader accepts both board forms. In site form it uses the site host and the `/wday/cxs/{tenant}/{Site}` path.

- [ ] **Steps:**
  1. Write failing tests: detection, the site-form list URL, and the job link.
  2. Run them and see them fail.
  3. Implement.
  4. Run them and see them pass.
  5. Commit: `feat(job-auto): Workday's myworkdaysite addresses are read like myworkdayjobs ones`

### Tasks 4–9: One reader each

| Task | System | Fixture source |
|---|---|---|
| 4 | `icims` | `careers-rws.icims.com` |
| 5 | `oracle` | `hdjq.fa.us2.oraclecloud.com/CX_1` (Emerson) |
| 6 | `comeet` | `autobrains/57.004` |
| 7 | `eightfold` | `vale.eightfold.ai|vale.com` |
| 8 | `avature` | `jobs.siemens.com/en_US/externaljobs` |
| 9 | `radancy` | `careers.synopsys.com` |

Each task follows the same shape.

**Files:**
- Create: `src/main/jobs/readers/<system>.ts`
- Modify: `src/main/jobs/readers/index.ts` (`READERS`), `src/shared/types.ts` (add the system to `JobSystem`), `src/renderer/src/labels.ts` (`SYSTEM_LABEL`: iCIMS, Oracle, Comeet, Eightfold, Avature, Radancy), `src/main/careers/detect.ts`
- Test: `tests/jobs/readers/<system>.test.ts` and `tests/careers/detect.test.ts`, with fixtures in `tests/fixtures/jobs/`

**Detection, per system:**

| System | detectFromUrl | detectFromHtml (the page contains…) |
|---|---|---|
| `icims` | host `*.icims.com` → board = host | an `*.icims.com` link |
| `oracle` | host `*.oraclecloud.com` with `/sites/{site}` → `host/site` | an Oracle CandidateExperience link |
| `comeet` | `www.comeet.com/jobs/{slug}/{uid}` | a Comeet jobs link, or `COMPANY_POSITIONS_DATA` together with a comeet.com `/jobs/` link |
| `eightfold` | host `*.eightfold.ai` → `host|<domain from ?domain= or the host's first label + '.com'>` | a page whose scripts reference `eightfold.ai` and whose `/api/apply` domain is given as `domain: "…"` |
| `avature` | host with path `/{locale}/{portal}/SearchJobs` or `/{locale}/{portal}` on a page with an `avature` marker | an avature marker plus `/SearchJobs` |
| `radancy` | — | a `tbcdn.talentbrew.com` marker → board = the page's host |

Check each detection against the fixture's real markup and adjust the pattern to what the page really carries. Report what was used.

- [ ] **Step 1: Capture the fixtures.** Use the app's User-Agent and the pace, trimmed to 3–5 jobs, keeping the structure.
- [ ] **Step 2: Failing tests:**
  - the exact URLs requested;
  - the row count and one full RawJob;
  - `complete`;
  - paging, using fake pages;
  - an unrecognised page throws;
  - detection.
- [ ] **Step 3: Run them and see them fail.**
- [ ] **Step 4: Implement.** Reuse `http.ts`, `util.ts` and `employment.ts`.
- [ ] **Step 5: Run them and see them pass.**
- [ ] **Step 6: Commit.** `feat(job-auto): <System> reader`

### Task 10: Re-check after the update

**Files:**
- Modify: `src/main/db/db.ts` (the next migration)
- Test: `tests/db/companies.test.ts`

**Migration (exact intent):**
- Companies with status `needs_claude` and a non-empty `careers_url` that is not a job-board site get `status = 'pending'`.
- `note`, `error`, `careers_url`, `jobs_url` and `lookup_attempts` are kept.
- `job_system`/`board` are cleared.
- Nothing else changes.
- The job-board check is the same host rule as `isJobBoardSite`: linkedin, indeed, glassdoor, stepstone, monster, ziprecruiter. Write it as SQL `LIKE` patterns with a comment pointing to detect.ts.

- [ ] **Steps:**
  1. Write a failing test on a database at the previous version: a needs_claude company with its own link becomes pending; one with a LinkedIn link stays; blocked and direct companies are untouched.
  2. Run it and see it fail.
  3. Implement.
  4. Run it and see it pass.
  5. Commit: `fix(job-auto): needs-Claude companies are re-checked once with the new readers`

### Task 11: Page capture in a hidden window

**Files:**
- Create: `src/main/pages/capture.ts` (Electron), `src/main/pages/types.ts`
- Modify: `src/main/readers/fetcher.ts` (`permits`)
- Test: `tests/readers/fetcher.test.ts`, `tests/pages/capture.test.ts` (the pure parts)

**Interfaces:**
- `Fetcher.permits(url: string): Promise<boolean>`: false when robots.txt forbids. Otherwise it waits for the host's pace slot, books it, and returns true. Fake fetchers in the tests gain it.
- `interface PageCapture { capture(url: string): Promise<{ finalUrl: string; text: string; links: { href: string; text: string }[] } | null> }`. null means robots.txt forbids.
- `createPageCapture(fetcher)` (Electron):
  1. Calls `permits(url)`.
  2. Loads the page in a `BrowserWindow({ show: false, webPreferences: { javascript: true, partition: 'jobauto-pages' } })`, with `webContents.setUserAgent(USER_AGENT)`.
  3. Blocks new windows, downloads, permission requests and navigation to other hosts after load.
  4. Waits for `did-finish-load` plus 6 s, with a 45 s cap.
  5. Reads `document.body.innerText`, capped at 60,000 characters, and up to 400 `a[href]` (absolute href and text, capped at 120 characters each).
  6. Destroys the window, and runs one capture at a time.
- `pageCaptureScript`: the exact JavaScript string run in the page. It returns `{ text, links }`, so it can be tested in jsdom.

- [ ] **Steps:**
  1. Write failing tests: `permits` refuses a forbidden path and books the pace; `pageCaptureScript` in jsdom returns capped text and absolute links.
  2. Run them and see them fail.
  3. Implement. The Electron part isn't unit-tested; the controller's visual pass runs it.
  4. Run them and see them pass.
  5. Commit: `feat(job-auto): the app can read a careers page in a hidden window, obeying robots.txt and the pace`

### Task 12: Claude page reading in the job check

**Files:**
- Create: `src/main/pages/claudeJobs.ts`
- Modify: `src/main/jobs/check.ts`, `src/main/careers/claude.ts` (`pageArgs`), `src/main/db/settings.ts` or `workRights.ts` (setting key `readPages`), `src/shared/api.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/screens/Settings.tsx`
- Test: `tests/pages/claudeJobs.test.ts`, `tests/jobs/check.test.ts`, `tests/renderer/Settings.test.tsx`

**Interfaces:**
- `pageArgs()`: like `lookupArgs`, but `--tools ''` and no `--allowedTools`, with `PAGE_RULES` as the appended system prompt.
- `PAGE_RULES` (exact): `You read one company's careers page for JOB-AUTO, the owner's personal job-search app. You get the page's visible text and its links. Return only a JSON array of the open jobs the page lists: [{"title": string, "location": string, "url": string|null}]. Use only what the page shows; never invent jobs. Use the job's own link from the links list when one matches the title, else null. Return [] when the page lists no jobs.`
- `pagePrompt(company, capture)`: the company name, the final URL, the text, then the links one per line as `text — href`.
- `parsePageJobs(text, pageUrl): RawJob[] | null`:
  - It returns null when there's no JSON array.
  - Each job's `sourceId` is the absolute url when given, else `t:` + the folded title + `|` + the folded location.
  - `countries` come from `countriesIn(location)`, `employment` is `employmentFrom(title)`, and `postedAt` is null.
  - Rows without a title are dropped, and duplicates are merged.
- **The job check**, after the direct companies:
  - It takes companies with status `needs_claude` whose `read_at` is null or older than 7 × 24 h, when the setting `readPages` is on (the default).
  - It reads them one at a time: `capture(jobs_url ?? careers_url)`, then Claude, then `parsePageJobs`.
  - On success it calls `saveRead(db, id, 'page:' + finalUrl, jobs, false, now)`.
  - On failure it calls `noteReadFailed(…, blocked = false)`, or `blocked = true` when capture returns null because robots.txt forbids.
  - Stop works between companies.
  - Progress counts them too; they show as `now: <name> (page)`.
  - A missing Claude path skips page reading with one log line.
- **Settings:** a **Reading** section with the checkbox **Read script-built careers pages with Claude (weekly)**. API `getReadPages()`/`saveReadPages(on)`.

- [ ] **Step 1: Failing tests:**
  - `parsePageJobs` on prose-wrapped JSON, on invalid JSON (null), and with relative and absolute links;
  - the job check reads a stale needs_claude company once with fakes, saving `complete: false`;
  - a fresh one (read 2 days ago) is skipped;
  - the setting off skips all;
  - a Claude failure is recorded and the next company is read;
  - Settings shows and saves the checkbox.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(job-auto): script-built careers pages are read weekly in a hidden window by Claude, never closing jobs`

### Task 13: README, live checks, build

**Files:**
- Modify: `JOB-AUTO/README.md`
- Create: `tests/live/readers2c.live.test.ts`

**Steps:**
- **README:**
  - the colourful map;
  - the new systems;
  - weekly page reading (what it does, the switch, Claude use, no closing);
  - the open routes for the refusing sites, as **Paste link** instructions with the exact links: `https://cat.wd5.myworkdayjobs.com/CaterpillarCareers`, `https://careers.south32.net/search/`, `https://job-boards.greenhouse.io/willowtree`, and `https://careers.synopsys.com` for Ansys;
  - which companies stay blocked and why.
- **Live check**, run only for `JOB_AUTO_LIVE=1`: one board per new reader returns at least one job with a title and an https url. Use the fixture boards, plus Workday site `wd3.myworkdaysite.com/magna/Magna`.
- [ ] **Step 1: Write them.**
- [ ] **Step 2: Verify.** Run `npm test`, `npm run typecheck`, `npm run lint` (0 errors), the live check, then `npm run build:win`.
- [ ] **Step 3: Commit.** `docs(job-auto): README covers the colourful map, the new readers and weekly page reading`

## Not in this plan

- readers for the one-company systems (read as pages instead)
- the similar-name sponsor hint (put off by the owner, §11 Later)
- any way past a site's refusal
