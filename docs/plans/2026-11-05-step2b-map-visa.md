# JOB-AUTO Step 2b: Map, Visa Evidence and Referral Links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Jobs screen gains a world map of the jobs that fit, each job and company shows whether the company is on an official visa sponsor list, and each job gets one-click LinkedIn searches for referrals.

**Architecture:**

- **Places.** A city list and country outlines are built into the app. Each stored job's location text turns into map places (a city, or a country's centre) when the list is read.
- **Sponsor lists.** Four official lists (UK, Netherlands, Denmark, Canada) are downloaded through the polite fetcher about once a week and stored. They are matched to companies by a cleaned-up name, and the owner can reject a wrong match.
- **Screens.** The Jobs screen gets a **List | Map** switch. Job rows get visa tags and LinkedIn buttons. Company rows show their sponsor-list matches. Settings gets a Visa section.

**Tech Stack:** as step 2: Electron 44, React 19, TypeScript, electron-vite, better-sqlite3, vitest, exceljs. One new **dev** dependency, `cities-with-1000@1.0.4`, which is only read by the data script and not shipped.

**Spec:** `JOB-AUTO/docs/2026-11-03-job-auto-design.md` §16 (agreed with the owner on 2026-11-05). §16.3's "contact named in the ad" belongs to step 3, not this plan.

## Decisions for the owner to check

These are calls made while planning. Facts were checked on 2026-11-05.

1. **City data source.**
   - Cities come from GeoNames' list of places with 1,000+ people, taken from the npm package `cities-with-1000`. It's a 2020 copy, which is fine for city positions.
   - GeoNames' own server forbids automated downloads.
   - Only the countries in your seven regions are kept: about 86,000 places, a 5.6 MB file in the app.
2. **Map style.** The map shows countries and dots, not streets: no internet map tiles. You can zoom with the mouse wheel, drag to move, and press **Whole world** to reset.
3. **Matching companies to sponsor lists.**
   - Names are compared after removing company forms (Ltd, AB, A/S, GmbH, B.V. …).
   - A list name may add country or group words after yours ("Scania (Great Britain) Limited" counts for Scania), but nothing else ("ABB Grain" doesn't count for ABB).
   - Each match shows the name as the list writes it, with a **Not this company** button.
4. **Lists refresh** by themselves when the app opens, at most once a week, and on **Refresh lists now** in Settings. A download that reads far fewer entries than expected is treated as a misread, and the previous list is kept.
5. **Countries you can already work in.** A new Settings choice: EU/EEA and Switzerland, UK, USA, Canada, Australia, New Zealand, Turkey. Jobs there show **No visa needed** and no sponsor tags. None is ticked at first.
6. **What a job row says about visas:**
   - **On the UK sponsor list** or **Not on the UK sponsor list** (likewise for the Netherlands, Denmark and Canada).
   - In other countries the row says nothing, and the map's city panel shows that country's line.
   - "Not on the UK list" matters most: a UK employer can't sponsor a Skilled Worker visa without a licence. In the other three countries, other routes exist.
7. **The country lines** are written below under Global Constraints. They are kept general, with no salary thresholds or quotas that go out of date.
8. **LinkedIn buttons:** **Recruiters**, **<Field> managers** (project, program, quality, change or process, taken from the title; otherwise hiring managers) and **People in <city>**. A job shared by several companies uses the first company's name.
9. **Data in the repo:** the city file (about 5.6 MB) and the country outlines (about 1.5 MB) are committed, along with the script that makes them.

## Global Constraints

### Where things live

- All code is in `JOB-AUTO/app/`, and every command runs from there.
- Commit straight to `main`. Push only when the owner asks.
- Nothing is imported from `DRESS-AUTO/`.

### Data

- **Database:** migrated by appending to `MIGRATIONS` in `src/main/db/db.ts` (this plan adds migration 4). Earlier migrations are never edited.
- **Tests:** tests use temp folders. Times are ISO strings from `toISOString()`.

### Rules for reading sites

These are unchanged:

- Every request goes through `src/main/readers/fetcher.ts`.
- Obey robots.txt.
- Wait 1500 ms between requests to the same host, or the host's Crawl-delay; open.canada.ca asks for 20 s.
- User-Agent `JOB-AUTO/0.1 (personal job search)`.
- Never work around a block.

The app makes **no request to LinkedIn, uscis.gov, gov.ie or download.geonames.org**.

### Folding

Names are matched after `foldText` (`src/main/jobs/fold.ts`), as in step 2.

### Attribution (exact)

The map shows `City positions: GeoNames (CC BY 4.0) · Country outlines: Natural Earth`.

### Sponsor lists (exact)

| Code | Shown as | Page read | Entries below this mean a misread |
|---|---|---|---|
| `GB` | UK | `https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers`, then the CSV it links on `assets.publishing.service.gov.uk` whose file name contains `Worker_and_Temporary_Worker` | 50000 |
| `NL` | Netherlands | `https://ind.nl/en/public-register-recognised-sponsors/public-register-work` | 5000 |
| `DK` | Denmark | `https://www.nyidanmark.dk/en-GB/Words-and-concepts/SIRI/Certified-companies` | 300 |
| `CA` | Canada | `https://open.canada.ca/data/api/action/package_show?id=90fed587-1364-4f33-a9ee-208181dc0b97`, then the 4 resources with format `XLSX` and language `en` that have the newest `created` | 5000 (all 4 quarters together) |

**List formats** (checked on 2026-11-05):

- **UK CSV:** header `Organisation Name,Town/City,County,Type & Rating,Route`. Fields may be quoted, so parse it as RFC 4180. Rows repeat per route.
- **IND:** rows `<tr><th scope="row">NAME</th><td>KVK</td></tr>`.
- **SIRI:** an HTML table whose first row is `Name of company | CVR no.`. Cells may contain markup and `&amp;`.
- **Canada XLSX:**
  - Sheet `positive`. Row 1 is a title and row 2 is the header: `Province/Territory, Program Stream, Employer, Address, Occupation, Incorporate Status, Approved LMIAs, Approved Positions`. Data starts on row 3.
  - Cells may carry padding spaces.
  - The download redirects to `opencanada.blob.core.windows.net`.

**Entry detail text, one entry per list name:**

- **UK:**
  - Start with the routes, joined by `, ` in file order.
  - Then ` · ` and the ratings found in `Type & Rating` (`A rating`, `B rating`), de-duplicated and joined by `, `.
  - Then ` · ` and the town from the first row.
  - Example: `Skilled Worker, Global Business Mobility: Senior or Specialist Worker · A rating · Daresbury`.
- **NL:** `Recognised sponsor (work)`.
- **DK:** `Fast-track certified`.
- **CA:** `<total approved positions> positions in the last 4 quarters`, then ` · ` and the first 2 occupations by positions. Example: `5 positions in the last 4 quarters · 21301-Mechanical engineers, 21232-Software developers and programmers`.

### Name matching (exact)

1. Fold the name. Replace `&` with ` and `. Delete `.` and `/`. Replace every other character that is not a letter, digit or space with a space. Collapse runs of spaces.
2. Remove, repeatedly, a final token in this set: `limited ltd plc llp lp inc incorporated llc corp corporation co company gmbh mbh ag se sa sas sarl spa srl bv nv ab publ as aps asa oy oyj kg kgaa pty pte ulc`.
3. A list entry matches a company when either:
   - the two cleaned names are equal; or
   - the list name is the company name, then a space, then only tokens from `uk gb great britain united kingdom england scotland nederland netherlands holland benelux danmark denmark nordic nordics canada international europe group holding holdings`.
4. A company whose cleaned name is shorter than 3 characters matches nothing.

### Work rights groups (exact)

| Group | Countries |
|---|---|
| `EU/EEA and Switzerland` | `AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH` |
| `UK` | `GB` |
| `USA` | `US` |
| `Canada` | `CA` |
| `Australia` | `AU` |
| `New Zealand` | `NZ` |
| `Turkey` | `TR` |

### Country lines (exact copy)

Each line comes with its link. These are for countries without a readable list.

| Country | Line | Link |
|---|---|---|
| SE | Sweden publishes no sponsor list. After a job offer the employer starts your work permit with the Migration Agency. | https://www.migrationsverket.se |
| NO | Norway publishes no sponsor list. Skilled workers get a residence permit after a job offer. | https://www.udi.no |
| FI | Finland publishes no sponsor list. Specialists and workers get a residence permit after a job offer. | https://migri.fi |
| DE | Germany needs no sponsor licence: an EU Blue Card or a skilled-worker visa follows a job offer. | https://www.make-it-in-germany.com |
| CH | Switzerland publishes no sponsor list. Hires from outside the EU need a permit within yearly quotas. | https://www.sem.admin.ch |
| IE | Ireland's permits-by-company list can't be read automatically. Most hires use a Critical Skills or General Employment Permit. | https://enterprise.gov.ie |
| US | The USA's H-1B employer data can't be read automatically. Most hires need an H-1B visa, drawn by lottery each spring. | https://www.uscis.gov |
| AU | Australia publishes no sponsor list. Employers sponsor skilled workers on the Skills in Demand visa. | https://immi.homeaffairs.gov.au |
| NZ | New Zealand only offers a search: check that the employer is accredited for the Accredited Employer Work Visa. | https://www.immigration.govt.nz |
| TR | Turkey publishes no sponsor list. The employer applies for your work permit. | https://www.csgb.gov.tr |
| other EU/EEA | No public sponsor list. Employers hire from outside the EU on an EU Blue Card or a national work permit. | https://immigration-portal.ec.europa.eu |
| any other | `<Country name>` publishes no sponsor list the app can read. | none |

### Region colours (map dots)

| Region | Colour |
|---|---|
| nordics | `#4c8bf5` |
| europe | `#9b6bd6` |
| usa | `#e5534b` |
| canada | `#f0883e` |
| australia | `#d4a72c` |
| new_zealand | `#3fb950` |
| turkey | `#db61a2` |
| no region | `#8b949e` |

## Review Focus

1. **A misread sponsor list must not wipe a good one.** A gov.uk page with no CSV link, a changed table, or an empty file means the previous list is kept, with the error recorded. Test: Task 5.
2. **False matches.**
   - `ABB` matches `ABB Limited` and `ABB A/S`, but not `ABB Grain Ltd`.
   - `Volvo Construction Equipment` matches `VOLVO CONSTRUCTION EQUIPMENT AB`.
   - `AS Watson` keeps its leading `as`.
   - A rejected match stays hidden after a refresh.
   - Test: Task 5.
3. **Same city name twice in one country.**
   - `Portland, OR` and `Portland, ME` land on different cities, using US state codes.
   - Otherwise the most populous place of that name in that country wins.
   - Accents and hyphens fold, so `Saint Priest` finds `Saint-Priest` and `Göteborg` finds Gothenburg.
   - Test: Task 2.
4. **Empty and odd maps.**
   - No jobs, all jobs with unclear locations, or one city with 500 jobs: the map renders with no `NaN` in any attribute and no horizontal page scroll.
   - Test: Task 8.
5. **Shared jobs on the map.** A job stored for three companies on one board counts once at its place, and its status saves to all three copies. Test: Task 8.

---

### Task 1: Geo data

**Files:**
- Create: `scripts/build-geo-data.mjs`, `src/main/geo/cities.json`, `src/main/geo/countryPoints.json`, `src/renderer/src/assets/countries.json`, `src/shared/attribution.ts`
- Modify: `package.json` (devDependency `cities-with-1000` pinned to `1.0.4`; script `"geo-data": "node scripts/build-geo-data.mjs"`)
- Test: `tests/geo/data.test.ts`

**Interfaces:**
- Produces:
  - `src/main/geo/cities.json`: an array of `[country, admin1, lat, lon, population, names]`.
    - `lat` and `lon` are rounded to 2 decimals.
    - `names` is the place's `name`, `asciiname` and `alternativeNames`, each folded with the step 2 rule, then:
      - with `-` and `'` turned into spaces;
      - kept only when it matches `/^[a-z0-9 .]+$/`;
      - de-duplicated and joined with `|`.
    - Only rows whose country is in `REGION_COUNTRIES` are kept.
  - `src/main/geo/countryPoints.json`: `Record<alpha2, [lat, lon]>` from Natural Earth's `LABEL_Y` and `LABEL_X`.
  - `src/renderer/src/assets/countries.json`: an array of `{ c: alpha2, g: Polygon or MultiPolygon coordinates }`, with numbers rounded to 2 decimals.
  - `ATTRIBUTION` in `src/shared/attribution.ts`: the exact attribution text.
- **Natural Earth source:** `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson`.
  - Use `ISO_A2_EH`, because `ISO_A2` is `-99` for France, Norway and Kosovo.
  - Skip features whose code is `-99`.
  - The script fetches it with the app's User-Agent. raw.githubusercontent.com has no robots.txt.

- [ ] **Step 1: Write the failing test** `tests/geo/data.test.ts`:
  - `cities.json` has more than 50000 rows.
  - There is a SE row whose names include `goteborg` and `gothenburg` near 57.71, 11.97 (±0.05).
  - There is a US row with admin1 `CA` named `poway`.
  - `countryPoints.json` has `FR`, `NO`, `XK` and `SE`.
  - `countries.json` has more than 200 features and every `c` is two upper-case letters.
- [ ] **Step 2: Run it and see it fail.** Run `npx vitest run tests/geo/data.test.ts`.
- [ ] **Step 3: Add the dev dependency and write the script.** Run `npm i -D cities-with-1000@1.0.4`, then `npm run geo-data`.
- [ ] **Step 4: Run the test and see it pass,** together with `npm run typecheck`.
- [ ] **Step 5: Commit.** `feat(job-auto): built-in city positions and country outlines for the map`

### Task 2: Places from location text

**Files:**
- Create: `src/main/geo/place.ts`
- Modify:
  - `src/main/jobs/location.ts`: export `placesIn` and `usStateCode`; `countriesIn` uses `placesIn`.
  - `src/shared/types.ts`: `Place`, and `Job.places`.
  - `src/main/db/jobs.ts`: `storedJobs` fills `places`.
- Test: `tests/geo/place.test.ts`, plus the existing `tests/jobs/location.test.ts` staying green.

**Interfaces:**
- Produces:
  - `placesIn(text: string): string[][]`: places, each with its parts, split exactly as `countriesIn` splits today.
  - `usStateCode(part: string): string | null`: a US state name or code mapped to its two-letter code.
  - `interface Place { city: string | null; country: string; lat: number; lon: number }`, in shared types.
  - `placesOf(location: string, countries: string[]): Place[]`:
    - For each place in `placesIn(location)`, read the parts from last to first.
    - A part is compared after the same treatment as the city names in Task 1: folded, with `-` and `'` turned into spaces.
    - The first part that names a city in one of `countries` gives a `Place` with `city` set to that part, trimmed as written.
    - A US state code or name among the place's parts narrows the choice to that `admin1`. Otherwise the most populous place wins.
    - When no part names a city, each of the place's countries that has a `countryPoints` entry gives a `Place` with `city: null`.
    - Places are unique by `city|country`.
    - `countries` empty gives `[]`.
  - The city index loads lazily on first use, once per process.
  - `Job.places: Place[]`, filled by `storedJobs` (and so by `fittingJobs`).

- [ ] **Step 1: Write the failing test.** A table test `placesOf reads each location shape`:

| location | countries | expected |
|---|---|---|
| `Göteborg, SE, 417 56` | `['SE']` | one place, city `Göteborg`, near 57.71, 11.97 |
| `Saint Priest, FR, 69800` | `['FR']` | city `Saint Priest`, near 45.70, 4.94 |
| `Poway, CA` | `['US']` | city `Poway`, near 32.96, -117.04 |
| `Portland, OR` | `['US']` | near 45.52, -122.68 |
| `Portland, ME` | `['US']` | near 43.66, -70.26 |
| `San Francisco, CA; New York, NY` | `['US']` | two places, San Francisco then New York |
| `Germany` | `['DE']` | one place, `city: null`, at DE's centre |
| `Remote` | `[]` | `[]` |

  Each coordinate is within ±0.1.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run it and see it pass,** together with `npx vitest run tests/jobs tests/db`.
- [ ] **Step 5: Commit.** `feat(job-auto): each job knows its places on the map`

### Task 3: Fetcher: binary downloads and longer waits

**Files:**
- Modify: `src/main/readers/fetcher.ts`, and the fake Fetchers in the tests that `npm run typecheck` flags
- Test: `tests/readers/fetcher.test.ts`

**Interfaces:**
- Produces:
  - `Fetcher.get(url: string, opts?: { timeoutMs?: number }): Promise<FetchResult | null>`
  - `Fetcher.getBytes(url: string, opts?: { timeoutMs?: number }): Promise<{ status: number; bytes: Buffer; url: string } | null>`
- `getBytes` follows every `get` rule: robots, pace, retry, `BlockedError` on 403/429, and the robots.txt failure rule. The challenge-page check doesn't apply to it. The body comes back unchanged, with no gunzip and no text decoding.
- `opts.timeoutMs` replaces the default 30 s for that request only.

- [ ] **Step 1: Write the failing tests:**
  - `getBytes returns the bytes as sent`, using a small PNG header.
  - `getBytes obeys robots.txt and the pace`.
  - `a request's own timeoutMs replaces the default`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** together with `npm run typecheck`.
- [ ] **Step 5: Commit.** `feat(job-auto): the polite fetcher downloads files and can wait longer for big ones`

### Task 4: Sponsor list readers

**Files:**
- Create: `src/main/sponsors/types.ts`, `csv.ts`, `uk.ts`, `nl.ts`, `dk.ts`, `ca.ts`, `index.ts`
- Modify: `src/shared/types.ts` (`SponsorCountry`)
- Test: `tests/sponsors/*.test.ts`, with fixtures in `tests/fixtures/sponsors/`

**Interfaces:**
- Produces:
  - `type SponsorCountry = 'GB' | 'NL' | 'DK' | 'CA'`, in shared types.
  - `interface SponsorEntry { name: string; detail: string }`
  - `interface SponsorReader { country: SponsorCountry; read(fetcher: Fetcher): Promise<{ entries: SponsorEntry[]; source: string }> }`
  - `SPONSOR_READERS: SponsorReader[]`, in the order GB, NL, DK, CA.
  - `parseCsv(text: string): string[][]`, following RFC 4180.
- Each reader returns one entry per list name, with the detail text from Global Constraints.
- A page whose expected markup or link is missing throws `Error('Sponsor list not recognised on <url>')`.
- The UK CSV is read with `timeoutMs: 180000`. Canada's files use `getBytes` with `timeoutMs: 120000` and are read with exceljs.

- [ ] **Step 1: Capture the fixtures.** Use the app's User-Agent and the hosts' pace (20 s at open.canada.ca), and trim each fixture:
  - `uk-page.html`: the publication page, trimmed to the attachment block.
  - `uk.csv`: the header plus about 20 rows. Include ABB Limited's 3 rows, one quoted name with a comma, and one B-rated row.
  - `nl.html`: the table head plus about 20 rows.
  - `dk.html`: the table plus about 20 rows, including `&amp;TRADITION A/S` and `ABB A/S`.
  - `ca-package.json`: trimmed to 6 resources.
  - `ca-q.xlsx`: rewritten with exceljs to the title row, the header and about 10 rows, with padded cells kept.
- [ ] **Step 2: Write the failing tests.** For each reader:
  - the exact URLs requested;
  - the entry count;
  - one full entry against the fixture. ABB Limited's detail is `Skilled Worker, Global Business Mobility: Graduate Trainee, Global Business Mobility: Senior or Specialist Worker · A rating · Daresbury`, with routes in the order the file gives them.
  - Plus: `a page without the expected table throws`; `uk: a page without the CSV link throws`; `ca reads the newest 4 English XLSX files and sums positions per employer`; `parseCsv handles quotes, commas and doubled quotes`.
- [ ] **Step 3: Run them and see them fail.**
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run them and see them pass.**
- [ ] **Step 6: Commit.** `feat(job-auto): readers for the UK, Dutch, Danish and Canadian sponsor lists`

### Task 5: Sponsor store, matching and refresh

**Files:**
- Modify: `src/main/db/db.ts` (migration 4), `src/shared/types.ts`, `src/main/db/companies.ts` (Company gains sponsors), `src/main/db/jobs.ts` (Job gains sponsors)
- Create: `src/main/sponsors/match.ts`, `src/main/sponsors/store.ts`, `src/main/sponsors/refresh.ts`
- Test: `tests/sponsors/match.test.ts`, `tests/sponsors/store.test.ts`, `tests/sponsors/refresh.test.ts`

**Migration 4** (exact):

```sql
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
```

**Interfaces:**
- Produces in shared types:
  - `interface SponsorMatch { country: SponsorCountry; name: string; detail: string }`
  - `interface SponsorListInfo { country: SponsorCountry; fetchedAt: string | null; entries: number; error: string | null }`
  - `Company.sponsors: SponsorMatch[]` and `Job.sponsors: SponsorMatch[]`, which are the company's matches.
- `match.ts`:
  - `cleanName(name: string): string`, following the Name matching rule.
  - `matchesCompany(listNorm: string, companyNorm: string): boolean`
- `store.ts`:
  - `saveSponsorList(db, country, entries, source, now)`: one transaction that replaces the country's entries and sets `fetched_at`, `entries` and `error = NULL`.
  - `noteSponsorListFailed(db, country, error)`: keeps the entries.
  - `sponsorLists(db): SponsorListInfo[]`, one per `SponsorCountry` (with zeros and nulls when the list was never fetched).
  - `sponsorMatches(db, companyId, companyName): SponsorMatch[]`, which leaves out rejected ones.
  - `rejectSponsor(db, companyId, country, name)`.
- `refresh.ts`:
  - `refreshSponsorLists(deps: { db; fetcher; log; readers?; now?; force?: boolean }): Promise<void>`. It never rejects.
  - It reads, one after another, each list whose `fetched_at` is null or older than 7 × 24 h, or every list when `force`.
  - It saves only when the entry count reaches that list's minimum. Otherwise it calls `noteSponsorListFailed(db, country, 'Read <n> entries, expected at least <min>; kept the previous list')`.
  - Logs: `sponsor list <code>: <n> entries` and `sponsor list <code> failed: <error>`.

- [ ] **Step 1: Write the failing tests:**
  - `cleanName` table:

| input | output |
|---|---|
| `ABB Limited` | `abb` |
| `ABB A/S` | `abb` |
| `VOLVO CONSTRUCTION EQUIPMENT AB` | `volvo construction equipment` |
| `Scania (Great Britain) Limited` | `scania great britain` |
| `AS Watson Ltd` | `as watson` |
| `B.V. Machinefabriek` | `bv machinefabriek` |
| `&TRADITION A/S` | `and tradition` |
| `Kion Group AG` | `kion group` |

  - `matchesCompany`: `abb`/`abb` → true. `abb grain`/`abb` → false. `scania great britain`/`scania` → true. `volvo cars uk`/`volvo` → false. `ab`/`ab` → false (too short).
  - Store: a save replaces the old entries; a failure keeps them; a rejected match stays hidden after a new save; removing a company removes its rejects.
  - Refresh:
    - only stale lists are read;
    - `force` reads all;
    - an under-minimum read keeps the old entries and records the error;
    - a throwing reader records the error, and the others still run;
    - it never rejects.
  - `listCompanies` and `storedJobs` carry `sponsors`.
- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run tests/sponsors tests/db`.
- [ ] **Step 3: Implement.**
  - Matching runs per company over entries pre-filtered by `norm LIKE companyNorm || '%'`.
  - Matches are computed once per `storedJobs` call per company.
- [ ] **Step 4: Run them and see them pass,** together with `npx vitest run`.
- [ ] **Step 5: Commit.** `feat(job-auto): sponsor lists stored, matched to companies by name, refreshed weekly`

### Task 6: Visa notes and work rights

**Files:**
- Create: `src/shared/visa.ts`, `src/main/db/workRights.ts` (settings key `workRights`)
- Test: `tests/visa.test.ts`

**Interfaces:**
- Produces in `src/shared/visa.ts`:
  - `WORK_RIGHT_GROUPS: { label: string; countries: string[] }[]`, exactly as in Global Constraints.
  - `SPONSOR_LIST_LABEL: Record<SponsorCountry, string>` (`GB` → `UK`, `NL` → `Netherlands`, `DK` → `Denmark`, `CA` → `Canada`).
  - `countryLine(code: string, countryName: string): { text: string; link: string | null } | null`, following the Country lines table. It returns null for GB, NL, DK and CA.
  - `visaTag(job: Pick<Job, 'countries' | 'sponsors'>, workCountries: string[]): string | null`, which returns:
    - `No visa needed` when any of the job's countries is in `workCountries`;
    - else, for the first job country that is a `SponsorCountry`, `On the <label> sponsor list` or `Not on the <label> sponsor list`;
    - else `null`.
- In the main process: `loadWorkRights(db): string[]` (the selected group labels) and `saveWorkRights(db, labels: string[])`, with settings key `workRights` as JSON. An unknown label is dropped.

- [ ] **Step 1: Write the failing tests:**
  - `visaTag`: a SE job with SE in work countries → `No visa needed`; a GB job matched → `On the UK sponsor list`; a GB job unmatched → `Not on the UK sponsor list`; a DE job → `null`.
  - `countryLine`: SE and US give their exact lines; FR gives the other-EU line; RS (`Serbia`) gives `Serbia publishes no sponsor list the app can read.` with no link; GB gives `null`.
  - Work rights round-trip, with unknown labels dropped.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(job-auto): visa tags, country lines and the countries you can already work in`

### Task 7: Wiring

**Files:**
- Modify: `src/shared/api.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces on `JobAutoApi`:
  - `sponsorLists(): Promise<SponsorListInfo[]>`
  - `refreshSponsorLists(): Promise<void>`, which forces a refresh and never rejects.
  - `rejectSponsor(companyId: number, country: SponsorCountry, name: string): Promise<void>`
  - `getWorkRights(): Promise<string[]>`
  - `saveWorkRights(labels: string[]): Promise<void>`
- Channels: `job-auto:sponsor-lists`, `job-auto:refresh-sponsor-lists`, `job-auto:reject-sponsor`, `job-auto:get-work-rights`, `job-auto:save-work-rights`.
- On opening, after `checkOnOpen`, start `refreshSponsorLists` without `force` and without awaiting it. It shares the one fetcher. Quitting needs nothing extra, because a refresh only writes inside `saveSponsorList`'s transaction.

- [ ] **Step 1: Extend the smoke test** with the new channels: unique, and each starting `job-auto:`.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement the wiring.**
- [ ] **Step 4: Run the test and `npm run typecheck`.**
- [ ] **Step 5: Commit.** `feat(job-auto): sponsor lists and work rights reach the window; lists refresh weekly on opening`

### Task 8: Map view

**Files:**
- Create: `src/renderer/src/map/projection.ts`, `src/renderer/src/map/WorldMap.tsx`
- Modify: `src/renderer/src/screens/Jobs.tsx` (List | Map switch, place panel, unclear list), `src/renderer/src/assets/main.css`
- Test: `tests/renderer/WorldMap.test.tsx`, `tests/renderer/Jobs.test.tsx`

**Interfaces:**
- **Projection:** `equalEarth(lon: number, lat: number): [number, number]`. The formula is fixed:

```ts
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2
// l, p in radians; t = asin(M · sin p)
// x = l · cos t / (M · (A1 + 3·A2·t² + t⁶·(7·A3 + 9·A4·t²)))
// y = t · (A1 + A2·t² + t⁶·(A3 + A4·t²))   → SVG y is −y
```

- **`WorldMap` props:** `{ groups: JobGroup[]; onPick(place: PlaceKey | null): void; picked: PlaceKey | null }`, with `type PlaceKey = string` (`city|country`).
  - **Countries:** drawn from `countries.json` as SVG paths.
  - **Dots:** one per place key.
    - The radius is `4 + 3·√n` screen pixels, where `n` counts unique groups at that place. It stays the same at any zoom.
    - The fill is the region colour of the group's first `regionGroups` entry, or the no-region colour.
    - Each dot has an `aria-label`: `<City or "Somewhere in <Country>">: <n> jobs`.
  - **Zoom and pan:** the mouse wheel zooms about the pointer, dragging pans, and a **Whole world** button resets the view.
  - **First view:** fits all dots with 10% padding, or the whole world when there are none.
  - **Attribution:** the `ATTRIBUTION` line sits under the map.
- **Jobs screen:**
  - A `List` / `Map` switch sits beside the region select. The tabs, region and status selects apply to both.
  - In Map view, clicking a dot opens a panel beside the map. Its header is `<City>, <Country> · <n> jobs`, or `Somewhere in <Country> · <n> jobs`. Then:
    - the country's `countryLine` with its link, opened through `openExternal`, when not null;
    - the place's `JobRow`s.
  - Below the map, `Location unclear (<n>)` lists those groups' rows when n > 0.

- [ ] **Step 1: Write the failing tests:**
  - `equalEarth(0, 0)` is `[0, 0]`.
  - `equalEarth(180, 0)[0]` is about 2.7067.
  - The map draws one dot per place, and a job with two cities gives two dots.
  - A group shared by 3 companies counts once.
  - No jobs gives no dots and no `NaN` in any `d`, `cx`, `cy` or `r`.
  - Clicking a dot calls `onPick`.
  - In the Jobs screen, switching to Map shows the map. Clicking a dot shows its panel with the jobs and the country line. Status changes in the panel save to every copy.
  - Unclear jobs list under the map.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(job-auto): a world map of the jobs that fit, with a panel per city`

### Task 9: Visa tags, LinkedIn buttons, company sponsor lines, Settings → Visa

**Files:**
- Modify:
  - `src/renderer/src/screens/Jobs.tsx` (JobRow)
  - `src/renderer/src/screens/Companies.tsx`
  - `src/renderer/src/screens/Settings.tsx`
  - `src/renderer/src/assets/main.css`
- Create: `src/renderer/src/linkedin.ts`
- Test: `tests/renderer/Jobs.test.tsx`, `tests/renderer/Companies.test.tsx`, `tests/renderer/Settings.test.tsx`, `tests/linkedin.test.ts`

**Interfaces:**
- **`linkedin.ts`:** `linkedInSearches(company: string, title: string, city: string | null): { label: string; url: string }[]`.
  - The base URL is `https://www.linkedin.com/search/results/people/?keywords=` followed by `encodeURIComponent(query)`.
  - The searches, in order:
    1. `Recruiters` with query `"<company>" recruiter`.
    2. `<Field> managers` with query `"<company>" <field> manager`. `field` is the first of `project`, `program`, `quality`, `change` or `process` found in the folded title; `programme` and `pmo` count as `program`, `proje` counts as `project`, `kalite` as `quality`, `surec` as `process`, `degisim` as `change`. With none found, the label is `Hiring managers` and the query is `"<company>" hiring manager`.
    3. `People in <city>` with query `"<company>" <city>`, only when `city` is not null.
- **JobRow:**
  - The visa tag (`visaTag`) shows after the location.
  - A `LinkedIn:` line with the buttons, each opened through `openExternal`. The city is the job's first place with a city.
- **Companies row:**
  - With matches: `Sponsor lists: ` followed by one item per match: `<label>` plus `` (`<list name>`) `` when the list name's `cleanName` differs from the company's, with the detail as hover text and a **Not this company** button.
  - Without matches, once at least one list has been fetched: `Not on the <labels of fetched lists joined with ", " and the last with " or "> sponsor lists`.
- **Settings → Visa:**
  - `Countries I can already work in` checkboxes for `WORK_RIGHT_GROUPS`, saved with **Save visa settings**.
  - A table of the sponsor lists: country, `updated <d MMM yyyy>` or `never`, the entry count and the error.
  - A **Refresh lists now** button showing `Refreshing…` while it runs.

- [ ] **Step 1: Write the failing tests:**
  - `linkedInSearches` URLs and labels for `Quality Manager` at `Volvo CE` in `Göteborg`, and for `Software Developer` with no city.
  - A job row shows `On the UK sponsor list` and the three buttons. Clicking one calls `openExternal` with the URL.
  - A company row shows a match and its **Not this company** button, which calls `rejectSponsor`.
  - The Settings Visa section saves work rights and runs a refresh.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(job-auto): visa tags and LinkedIn searches on jobs, sponsor lists on companies, Settings → Visa`

### Task 10: README, live check, build

**Files:**
- Modify: `JOB-AUTO/README.md`
- Create: `tests/live/sponsors.live.test.ts`

**Steps:**

- **README:** add a "Map, visa and referrals" section:
  - the map: dots, the city panel, unclear locations, the attribution;
  - the four sponsor lists, what "on" and "not on" mean, and the **Not this company** button;
  - why the USA, Ireland and New Zealand have only a line;
  - **Countries I can already work in**;
  - the LinkedIn buttons, and that the app never contacts LinkedIn itself.
- **Live check:** it runs only for `JOB_AUTO_LIVE === '1'`. It reads each sponsor list once and expects at least its minimum count, and that UK's entries include an `abb` match.
- [ ] **Step 1: Write the README section and the live test.**
- [ ] **Step 2: Verify.** Run `npm test`, `npm run typecheck`, `npm run lint` (0 errors), then `JOB_AUTO_LIVE=1 npx vitest run tests/live/sponsors.live.test.ts`, then `npm run build:win`.
- [ ] **Step 3: Commit.** `docs(job-auto): README covers the map, the sponsor lists and the LinkedIn buttons`

## Not in this plan

- the contact named in the ad (step 3, §6)
- demand over time and the Metrics tab (step 4)
- US, Irish and New Zealand lists (their sites can't be read automatically)
- reading or contacting LinkedIn in any way
