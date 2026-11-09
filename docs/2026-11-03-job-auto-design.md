# JOB-AUTO — Design

Date: 2026-11-03
Status: draft, waiting for owner approval. Nothing is built until it is approved.

Labels used in this document:

- **(owner)**: decided by the owner in conversation.
- **(call)**: a decision made by the designer that the owner has not confirmed yet. Each one can be overruled.

---

## 1. Why this exists

The owner is looking for a new job at a specific set of companies: about 255 companies in autonomous vehicles, vehicle testing, mining and farm machinery, and the technology around them. They are listed in the owner's tracker, `autonomous_vehicle_machinery_company_tracker.xlsx`.

Checking 255 careers pages by hand isn't realistic. Most of the jobs on them are also irrelevant, because the big employers have thousands of openings each.

JOB-AUTO does the checking. Every day it reads each company's own careers site. It keeps only the jobs that fit the owner's roles, level and regions, and has Claude score each one against the owner's CV. The result is one list, with new jobs tagged. It also records how long jobs stay open, so the owner can see how fast these companies hire.

## 2. Goals, non-goals, anti-goals

### Goals

1. **One list of jobs that fit** (owner).
   - It covers every listed company.
   - It applies the owner's filters (§5) and gives a fit score with a reason from Claude (§6).
2. **New jobs tagged** (owner). A job is **New** for 7 days after the app first finds it, or until the owner gives it a status.
3. **Three company lists** (owner). Vehicle, Machinery and Both, as in the tracker.
4. **Every company accounted for** (owner). Each company shows whether it is read directly, needs Claude reading, is blocked, or was not found.
5. **Your own tracking** (owner). Each job takes a status and notes.
6. **Hiring metrics** (owner). How long jobs stay open, how fast they close, and who is hiring more or less over time (§9).
7. **Daily, without effort** (owner). It starts with Windows, checks once a day, and has a **Check now** button.

### Non-goals

- **Alerts, emails or notifications** (owner). The list is the output.
- **LinkedIn, Indeed or other job boards** (owner). It reads company sites only.
- **Applicant counts** (owner). Company job systems don't publish them.
- **Sync between computers** (owner). Each computer keeps its own data. Backup and Restore come later (§11).
- **Applying from inside the app** (call). You always apply on the company's site.
- **Mac or phone versions** (owner: Windows only).
- **Accounts or multiple users** (owner: single user).

### Anti-goals: failure even if the app works

- **Missing a fitting job silently.** A company the app can't read is never hidden. It shows as needs Claude reading, blocked or not found, so the owner knows the gap is there.
- **Presenting Claude's reading as fact.**
  - The score always comes with its reason.
  - "Years not stated" and "visa not mentioned" are shown as such, not guessed.
- **Touching anything outside its own folder** (owner). In particular, no work folders.
- **Hammering company sites.** It reads slowly, respects `robots.txt`, and identifies itself honestly.

## 3. Constraints

| Constraint | Source |
|---|---|
| A Windows desktop app installed from a `.exe` | owner |
| Runs on the owner's computer; reads and writes only its own data folder | owner |
| Company websites only | owner |
| Claude work runs through Claude Code, on the Claude account signed in on the computer; no API key | owner |
| Everything for this project lives under `JOB-AUTO/` in the Project- repo, pushed to `main` | owner |
| A separate app from DRESS-AUTO; it copies the DRESS-AUTO parts that fit, with no shared code | owner |

## 4. Companies

### 4.1 Starting list

- **Import.** The owner's tracker is imported once (owner). Its Master Company List has 255 companies:

  | List | Companies |
  |---|---|
  | Vehicle | 112 |
  | Machinery | 82 |
  | Both | 61 |

- **Columns.** The tracker's Career page, Target countries, Locations and Target positions columns are empty for every company. English-only and Visa sponsorship are "Unknown" for every company.
- **Nothing merged** (owner). That includes "Ford" and "Ford Motor Company", "FEV" and "FEV.io", and Cruise and Phantom Auto, which may no longer be hiring. Each company is looked up on its own. If no careers page turns up, it is marked **not found**.
- **After the import, the list lives in the app** (owner). The owner adds, removes and moves companies there.
- **Fields the app fills in:**
  - careers page
  - job system
  - status
  - countries where the company has jobs
- **Fields that stay the owner's:** Priority, Application status, Notes, English-only and Visa sponsorship. Claude notes language and visa for each job instead.
- **Export to Excel** at any time (owner).

### 4.2 Finding each careers page

1. **Claude looks it up once.** Claude searches the web for the company's official careers page and the job system behind it (owner).
2. **The app recognises the job system from the address**, for example `boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com` or `*.myworkdayjobs.com` (call).
3. **The owner can correct it.** If Claude got the page wrong, the owner pastes the right link and the app tries again.

### 4.3 Company status (owner)

| Status | Meaning |
|---|---|
| **Read directly** | The app reads the job system's public job feed every day |
| **Needs Claude reading** | A careers page exists, but its job system has no reader yet |
| **Blocked** | The site forbids or refuses automated reading. The app does not try to get around it |
| **Not found** | No careers page could be found |

In the first version, "needs Claude reading" companies are counted and listed but not read (§11).

### 4.4 Early check (2026-11-03)

A quick test guessed each company's account name on seven common job systems: Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee and Personio. The test ran from the owner's computer.

- **Results:**
  - 46 companies had a feed with open jobs: 23 Vehicle, 12 Machinery and 11 Both.
  - By system: Greenhouse 18, SmartRecruiters 10, Lever 9, Ashby 6, and one each for the other three.
  - Examples: Waymo, Zoox, Wayve, Mobileye, Nuro, Motional, Scale AI and Konecranes.
- **Some hits are probably a different company with the same name.** For example, "general" was matched for General Motors. About 40 look right.
- **Scale:** those 46 feeds alone listed 9,160 open jobs, and SGS had 4,602 of them. The filters in §5 are what make this manageable.
- **The other roughly 210 companies are mostly large employers.** They need their careers page found first (§4.2). Many are expected to use Workday, SuccessFactors or SmartRecruiters under a different account name. This hasn't been verified.

## 5. Which jobs make the list

All lists in this section can be edited under Settings → Filters (owner).

### 5.1 Region (owner)

- **Groups:** Nordics (Sweden, Norway, Finland, Denmark), Rest of Europe (including the UK and Switzerland), USA, Canada, Australia, New Zealand, and Turkey.
- **Switches:** each group can be switched off on its own. Turkey has its own group so it can be dropped with one click.
- **Remote and on-site are treated the same.** What counts is the country.
- **Unclear locations** (call). A job whose location gives no country, such as a bare "Remote", is kept and marked "location unclear".
- **Everywhere else is dropped**, including Asia, Latin America and Africa.

### 5.2 Role (owner)

- **Keep** titles containing one of:
  - project, program, programme, PMO
  - quality, change, process
  - continuous improvement, operational excellence, lean
  - delivery manager, coordinator
- **Drop** engineer jobs, including "Quality Engineer", "Process Engineer" and "Project Engineer". "Engineering Project Manager" stays, because it is a management job.
- **Title language: English or Turkish** (owner).
  - **How it works:** the keep-words come in English and Turkish, for example proje, kalite, süreç, değişim and sürekli iyileştirme (call). Titles in other languages, such as Projektledare or Projektleiter, therefore don't match.
  - **Why:** those titles almost always mean the job needs that language.

### 5.3 Level and job type (owner)

- **Drop titles with:** Senior, Sr, Lead, Principal, Head of, Director, VP, Chief, and the Turkish equivalents (call), for example Kıdemli.
- **Drop:** internships, thesis jobs, working-student (Werkstudent) jobs, summer jobs, apprenticeships and part-time jobs. Where the feed gives an employment type, it is used. Otherwise the title words decide.
- **Keep:** graduate and trainee programmes, and full-time fixed-term jobs, marked "fixed-term".
- **Experience:** jobs that ask for **more than 3 years** are hidden. Jobs that don't state a number are shown as "years not stated". Claude reads this (§6).

### 5.4 Order of the filters (call)

1. **Region and title rules run first.** They are plain rules, so they are free.
2. **Full job description.** For what passes, the app fetches the description where the feed doesn't already include it.
3. **Claude reads each remaining job once** (§6).
4. **Experience limit.** Jobs over the limit are hidden after Claude has read the years.

## 6. Matching with Claude

**Inputs (owner):**

- **The owner's CV**, added under Settings → Profile as a PDF or Word file. It stays in the app's data folder and is not committed to GitHub.
- **A "what I want" note:** target roles, must-haves, deal-breakers, minimum salary, and language and visa needs. It is drafted with the owner in a short interview during the build.

**For each job that passes the rules, Claude returns:**

| Field | Values |
|---|---|
| Fit score | 0–100 |
| Reason | two lines, in plain words |
| Years asked | a number, or "not stated" |
| Languages required | for example "English", "English + Swedish" |
| Visa | offered / not offered / not mentioned |
| Job type check | flags a job that turns out to be an internship, part-time or a contractor role |
| Contact in the ad | the name and role of a contact person the ad itself names, for example "Anna Svensson, Talent Acquisition"; empty when it names none (added 2026-11-05, §16) |

**Calls:**

- **Shown with no cut-off.** Every job that passes the rules is shown with its score, sorted New first and then by score.
- **Batched, with a small model.** Several jobs go to Claude in one run, and scoring uses a small, fast model if its scores hold up against a larger one on a sample.
- **Scored once.** A job isn't scored again unless the owner presses **Re-score** after changing the CV or the note.
- **Isolated runs.** Claude runs headless and ignores the owner's own Claude settings and CLAUDE.md, the same way DRESS-AUTO's "Search everywhere with Claude" does.
- **Spread out.** The first run may have hundreds of jobs to score, so scoring is spread over the first days if needed. Scores fill in as they arrive.

## 7. Screens (sketch)

The numbers in these sketches are placeholders, not real data.

### 7.1 Jobs (home)

```
+----------------------------------------------------------------------+
|  JOB-AUTO     [Jobs] [Companies] [Metrics] [Settings]   [Check now]  |
+----------------------------------------------------------------------+
|  [ Vehicle 14 ]  [ Machinery 6 ]  [ Both 9 ]      last check: 2h ago |
|  Region: all v   Status: any v   [x] hide closed   Sort: New, fit    |
+----------------------------------------------------------------------+
| NEW  Project Coordinator, Validation      Company A    Gothenburg, SE|
|      fit 82 · 2-3 yrs · English · visa: not mentioned · posted 2d    |
|      "Coordinates test programmes; close to your PMO work. Asks      |
|       for Jira and stakeholder reporting, both on your CV."       >  |
|      Status: [ - v ]   Notes: ________                               |
|----------------------------------------------------------------------|
|      Quality Coordinator                  Company B    Perth, AU     |
|      fit 64 · years not stated · English · visa: offered · posted 9d |
|      ...                                                             |
+----------------------------------------------------------------------+
```

- **Status choices** (owner): Interested, Applied, Interview, Offer, Rejected, Not interested.
- **Closed jobs** are hidden unless they have a status (owner). A job with a status stays visible and shows "closed on <date>".

### 7.2 Companies

```
+----------------------------------------------------------------------+
| Company     List      Job system       Status               Jobs     |
|                                                       yours / field  |
| Waymo       Vehicle   Greenhouse       read directly        3 / 41   |
| Konecranes  Machinery SmartRecruiters  read directly        1 / 18   |
| Company C   Vehicle   (other)          needs Claude reading   -      |
| Company D   Both      -                blocked                -      |
| Company E   Vehicle   -                not found   [paste link]      |
|                                                                      |
| [ Add company ]   [ Export to Excel ]       checked: 2h ago          |
+----------------------------------------------------------------------+
```

"Yours" means jobs in the list. "Field" means jobs counted for metrics (§9).

### 7.3 Metrics

```
+----------------------------------------------------------------------+
| Your field · last 90 days    Opened 312   Closed 188   Median open 34d|
| Filter: List [all v]  Region [all v]  Role type [all v]  [x] only fits|
+----------------------------------------------------------------------+
| Company      Open now  Opened 30d  Closed 30d  Median days open      |
| Company A        41         9          6            27               |
| ...                                                                  |
+----------------------------------------------------------------------+
| Opened vs closed per week   [ bar chart ]                            |
| Quick closers (closed within 14 days): 23 jobs          [show]       |
+----------------------------------------------------------------------+
```

### 7.4 Settings

- **Filters:** region switches, keep-words, drop-words, and the experience limit (§5).
- **Profile:** CV file, the "what I want" note, and **Re-score**.
- **Data:**
  - refresh log
  - start with Windows on or off
  - time of the daily check
  - Claude connection status

## 8. Data: reading, storing, freshness

### 8.1 Readers

- **First version** (owner): Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, Personio, Workday and SuccessFactors.
- **Workday and SuccessFactors need confirming in the build.**
  - Workday career sites load their jobs from a JSON endpoint. Where possible it will be asked to filter by location and search text, so big employers don't have to be read page by page.
  - SuccessFactors sites vary more from company to company.
- **More readers** (call). After the first run, readers are added for whichever job systems cover the most "needs Claude reading" companies. Teamtailor is a likely one, because it is common in the Nordics.
- **Politeness, copied from DRESS-AUTO:**
  - one request at a time to each host, with a pause between requests
  - respect for `robots.txt`
  - an honest user agent
  - a refresh log showing every company read, failure and block

### 8.2 Storage (call)

- **One SQLite database:** `C:\Users\<you>\JOB-AUTO\job-auto.db`.
  - It isn't in AppData, for the same reason as DRESS-AUTO: Claude Desktop's Store version gives everything it starts a private copy of AppData.
- **The CV** is stored next to the database.
- **Test runs.** When a Claude session or a dev build starts the app, it works on a copy in `JOB-AUTO\test\` and writes nothing back, the same as DRESS-AUTO.
- **Nothing else.** The app reads and writes nothing outside that folder (owner).
- **What's stored:**
  - **List jobs:** every job that passes the rules, with its description and Claude's reading.
  - **Field jobs:** every job in "your field" (§9.1), with dates, title, company, list, location and role type, but no description.
  - Everything else is read, checked against the rules, and dropped.

### 8.3 Freshness

- **The daily check** runs at a set time while the app is running. It starts with Windows (owner), and a check missed while the computer was off runs at the next start.
- **Check now** runs a check at any time (owner).
- **Each company shows when it was last read**, and each job shows when it was last seen.
- **First run** (owner): jobs already open get no New tags. The list then shows every currently open job that fits. New tags start from the second check.

## 9. Metrics

### 9.1 Which jobs count (owner)

- **"Your field":** jobs in your regions whose titles match your role words, at any level and in any language. They are stored for metrics and don't appear in the list.
- **Role words in other languages** (call). The role words are also matched in the main languages of your regions (Swedish, Norwegian, Danish, Finnish, German, French and others), so "any language" is real.
- **Left out of the field** (call): engineer jobs, internships and part-time jobs. They aren't your kind of job and would skew the numbers.
- **"Only jobs that fit me"** narrows the metrics to the list's own jobs.

### 9.2 Open and closed (owner)

- **Opened:** the posted date from the company's site when it gives one, otherwise the day the app first saw the job. Some sites only say "Posted 30+ days ago", and those dates are marked rough.
- **Closed:** the first day the job is gone from the site, accurate to within a day.
  - The tab says **closed**, not "filled", because a job can be cancelled or paused.
- **Reposted:** a job that comes back with the same title and location within 30 days is the same job, marked "reposted".
- **Open before tracking:** jobs already open on the first run with no posted date are left out of the days-open numbers.
- **Recording starts at the first run**, because this history can't be filled in later.

### 9.3 What the tab shows (owner)

- **For each company:**
  - jobs open now
  - jobs opened and closed in the last 30 and 90 days
  - the median number of days a job stays open
- **The same numbers by list** (Vehicle, Machinery, Both), **by region**, and **by role type** (project, quality, change, process).
- **Opened vs closed per week.**
- **Quick closers:** jobs that closed within 14 days.

The numbers mean little until a few weeks of data have built up.

## 10. How it is built (calls)

- **App type:** Electron, TypeScript and React, the same stack as DRESS-AUTO.
- **Installer:** electron-builder Windows installer (NSIS). It isn't code-signed, so SmartScreen warns on install.
- **Database:** SQLite through `better-sqlite3`.
- **Background reading:** a worker process, so the screens stay responsive during a long check. The pattern is copied from DRESS-AUTO.
- **Claude:** the Claude Code CLI, run headless on the computer's signed-in account. The runner is copied from DRESS-AUTO.
- **Start with Windows:** the app's own login-item setting, which the owner can switch off in Settings.
- **Code location:** everything under `JOB-AUTO/app/`, with docs in `JOB-AUTO/docs/`.
- **Language:** the app's screens are in English. Job titles and descriptions stay in their original language.
- **Auto-update:** none. A new installer is built when something changes.

## 11. First version vs later

### First version (owner)

Everything in §4–§9, apart from reading the "needs Claude reading" companies.

**Build steps within the first version (call).** Each step ends in something the owner can run:

1. **Companies.** Import the tracker, have Claude find the careers pages, and set company statuses. The owner reviews the statuses and fixes wrong links.
2. **Jobs.** Readers, the rule filters, and the Jobs list with New tags, statuses and notes. Open and close dates are recorded from this step on.
   - **2b. Map, visa evidence and referral links** (added 2026-11-05, §16).
3. **Matching.** The CV, the "what I want" interview and note, and Claude scoring.
4. **Metrics and finish.** The Metrics tab, Excel export, start with Windows, and the installer.

### Later (owner)

- **Claude reading the remaining companies weekly.** Whether it's worth it is decided once the first run shows how many companies need it.
- **Backup and Restore,** to move to another computer.
- **A Claude Desktop connection,** for questions like "which new jobs fit me?"
- **Similar-name hint for the sponsor lists** (designed 2026-11-06, put off by the owner).
  - **Similar name:** a list name that starts with the company's cleaned name plus more words. For example, "Wayve Technologies Ltd" is similar to Wayve.
  - **Company rows:** show up to 3 similar names per list, with **It's this company** and **Not this company**, and "and N more" when there are more.
  - **Job tag:** reads "Similar name on the UK sponsor list — check" until the owner confirms a name.
  - **Measured on the test copy:** 67 companies have such names, and most have 1–3.
  - **Rejected rule:** a list name that merely contains the company's name is mostly noise ("Plus" gives 247 names), so it was dropped.

## 12. What the owner needs

- **Already in place:** the Windows computer, Node.js 24, and Claude Code installed and signed in.
- **Money:** none beyond the existing Claude plan.
- **Time:**
  - adding the CV
  - a short "what I want" interview
  - reviewing company statuses after step 1, and pasting links for "not found" companies the owner knows
  - setting statuses on jobs as they apply
- **Another computer:** the app installs on any Windows PC. Claude Code must be signed in there for the Claude parts, and that PC starts with its own empty data.

## 13. Risks

| Risk | Effect | How we handle it |
|---|---|---|
| Sites block readers or change | Missing jobs for that company | Status per company; refresh log; readers are small and easy to fix |
| Big employers list thousands of jobs | Long daily check | Filter at the source where the job system allows it; read in the background |
| Claude finds the wrong careers page | Wrong or missing jobs | The owner sees the link and can replace it |
| A guessed feed belongs to a different company | Jobs from the wrong company | Careers pages come from Claude's lookup, not name guessing |
| Title words too narrow or too wide | Missed or noisy jobs | Editable word lists; metrics show the wider field for comparison |
| "Posted 30+ days ago"-style dates | Rough days-open numbers | Marked rough; first-seen date used once tracking starts |
| Closed doesn't always mean filled | Misleading "time to fill" | Labelled "closed", not "filled" |
| Claude plan limits during the first run | Scores arrive slowly | Batch and spread scoring; jobs show "not scored yet" |
| Location text without a country | Wrong region | "Location unclear" marker, kept rather than dropped |

## 14. Left to the builder

- the database layout
- how each reader pages through results and filters at the source
- the exact keep and drop word lists in each language, starting from §5
- the Claude prompts and batch sizes
- the visual style of the app

## 15. Decisions the owner should check

- The database lives in `C:\Users\<you>\JOB-AUTO`, with test runs on a copy in `JOB-AUTO\test\`.
- Every job that passes the rules is shown with its score and no cut-off, sorted New first and then by score.
- A job whose location gives no country is kept and marked "location unclear".
- The metrics field leaves out engineer jobs, internships and part-time jobs, and matches role words in the regions' main languages.
- Claude scoring is batched, uses a small model if it holds up, and runs again only when the owner presses **Re-score**.
- After the first run, readers are added for the job systems that cover the most remaining companies.
- Blocked sites are respected and never worked around.
- The first version is built in four steps: companies, jobs, matching, then metrics and finish.

## 16. Step 2b: map, visa evidence and referral links (owner, 2026-11-05)

Agreed with the owner on 2026-11-05. "Owner" marks their decisions; "fact" marks what was checked on that day.

### 16.1 Map (owner)

- **Where:** a **Map** view on the Jobs screen, next to the list. It uses the same list tabs, region select and status select, and works offline.
- **What:**
  - One dot per city, sized by the number of jobs there that fit the filters and coloured by region.
  - Clicking a dot lists that city's jobs, with the same status, notes and links as the list.
  - A job whose location names only a country sits at the country's centre, marked "somewhere in <country>".
  - Jobs with an unclear location are listed beside the map, never guessed onto it.
- **City positions** come from a city list built into the app, with no requests:
  - **Cities:** GeoNames' cities of 1,000+ people, taken from the npm package `cities-with-1000`. GeoNames' own download server forbids automated downloads in its robots.txt, so it is never used.
  - **Country outlines and centres:** Natural Earth (public domain).
  - **Attribution:** GeoNames is CC BY 4.0, so the map credits it.
  - **Fact:** this placed 84% of the first real check's job locations on a city. Most of the rest name only a country.

### 16.2 Visa evidence (owner)

- **Official sponsor lists the app can read** (fact). Each is downloaded through the polite fetcher, then matched against the companies by name:

| Country | List | Form |
|---|---|---|
| UK | Home Office register of licensed sponsors (workers) | CSV linked from its gov.uk page, about 11 MB, updated every working day |
| Netherlands | IND public register of recognised sponsors, Work | one HTML table: organisation and KvK number |
| Denmark | SIRI companies certified for the Fast-track scheme | one HTML table: company and CVR number |
| Canada | employers with a positive LMIA, by quarter | XLSX files on open.canada.ca: employer, address, occupation, positions |

- **Lists the app can't read** (fact):
  - USA's H-1B employer data: uscis.gov refuses automated clients (HTTP 403).
  - Ireland's permits-by-company file: gov.ie refuses automated clients (HTTP 403).
  - New Zealand: publishes only a search page, no list.
- **Countries without a readable list** show one fixed line on how hiring from abroad works there, with a link to the official site.
- **Demand, not supply** (owner):
  - Demand is the number of fitting open jobs per city and country, shown on the map, with its change over time coming in step 4.
  - Candidate supply isn't published anywhere the app can read, so the app shows no supply figure.

### 16.3 Referral links (owner)

- **LinkedIn search buttons.** Each job has buttons that open LinkedIn people searches in the owner's own browser, where LinkedIn ranks the owner's connections first:
  - recruiters at the company
  - managers in the job's field at the company
  - people at the company in the job's city
- **The app sends no request to LinkedIn.** LinkedIn's terms forbid automated searching.
- **Contact named in the ad:** step 3's description reading also picks out a contact person the ad itself names (see §6).
- **No web-wide people search.** The app doesn't collect names of managers, HR people or teammates from across the web. It would build files on private people, often pick the wrong person, and use up the Claude allowance.

## 17. Step 2c: colourful map, more readers, reading script-built pages (owner, 2026-11-06)

Agreed with the owner on 2026-11-06. Facts were checked that day against the owner's 111 "needs Claude reading" companies, with one polite look at each careers page:
- about 33 use a known job system;
- 68 build their job list with scripts on their own site;
- 10 refuse automated reading.

### 17.1 Map (owner)

- **Colours:** a colourful political map, still offline. Each country gets one of 7 soft colours, and neighbours always differ (Natural Earth's MAPCOLOR7).
- **Labels:**
  - Country names show by size: big countries at world view, small ones as you zoom in.
  - Major city names appear when zoomed in.
  - A job dot shows its city's name once you zoom in.
- **Online street maps are not used:** they need internet and send your map views to a tile company.

### 17.2 Readers for more job systems (owner)

- **New readers** for the systems with a public job feed that serve two or more of the owner's companies (fact):

| System | Companies | Feed |
|---|---|---|
| iCIMS | 5 | the job search page |
| Oracle Recruiting | 4 | REST |
| Workday "myworkdaysite" | 3 | JSON |
| Comeet | 3 | job data inside the page |
| Eightfold | 2 | `/api/apply`, which robots.txt allows |
| Avature | 2 | job search pages |
| Synopsys's site map | 2 | the site map, which robots.txt allows while the job search is forbidden |

- **One-company systems** are read the way §17.3 describes, rather than each getting its own reader: Teamtailor, JazzHR, BambooHR, Breezy, UKG, Paylocity, d.vinci, Phenom and Beesite.
- **Re-checking:** after the update, the "needs Claude reading" companies are checked again from their stored links, without Claude, so the new readers pick them up.

### 17.3 Reading script-built careers pages (owner)

- **Which companies:** every company still "needs Claude reading".
- **When:** once a week.
- **How a page is read:**
  1. The app opens the careers page in a hidden window of its own browser, honestly named as JOB-AUTO. robots.txt is obeyed and one page per site is read at a time.
  2. The page's scripts run.
  3. Claude (Sonnet, on the owner's account) picks the job titles, locations and links from what the page shows.
- **Closing:** a list read this way may be incomplete, for example when only the first page of results shows. So it never closes jobs. Missing jobs show "not seen since".
- **Switch:** Settings has a switch to turn it off.

### 17.4 Sites that refuse (owner)

- **Permitted routes only.** The app never disguises itself as a normal browser and never ignores robots.txt. Where a refusing company publishes its jobs through another open route, that route is used.
- **Fact, the open routes:**

| Company | Open route |
|---|---|
| Caterpillar | its Workday job feed (`cat.wd5.myworkdayjobs.com/CaterpillarCareers`, 1,035 jobs) |
| South32 | its SuccessFactors site (`careers.south32.net`) |
| TELUS Digital | the WillowTree arm's Greenhouse board (`job-boards.greenhouse.io/willowtree`) |
| Ansys | Synopsys's site map |

- **No open route found:** Bosch Rexroth and JCB (forbidden by robots.txt), Hitachi Astemo, TÜV SÜD and Micromine (HTTP 403), and EACON Mining (unreachable). These stay blocked, with the reason shown.
