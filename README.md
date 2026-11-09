# JOB-AUTO

A Windows desktop app that keeps track of open jobs at your target companies. It is being built in steps. **Step 1 is the company list:** it imports your company tracker, finds each company's careers page, works out which job system the page runs on, and shows every company with a status, so you can review the list and fix the wrong ones. **Step 2 reads the jobs** from those companies and shows them in the Jobs screen (see [Jobs](#jobs)); **step 2b adds a map, sponsor lists and LinkedIn buttons** (see [Map, visa and referrals](#map-visa-and-referrals)); **step 2c colours the map, reads seven more job systems, and reads the remaining careers pages once a week with Claude** (see [Reading careers pages with Claude](#reading-careers-pages-with-claude)). Scoring and the CV come in later steps (see the [design](docs/2026-11-03-job-auto-design.md)).

What step 1 does:

- **Imports your tracker.** The `.xlsx` file with your Master Company List (255 companies: 112 Vehicle, 82 Machinery, 61 Both) goes into the app. After that the list lives in the app: you can add, remove and move companies there.
- **Finds each careers page with Claude.** Claude Code runs in the background on your own Claude login. It searches the web for each company's official careers page, 5 companies at a time. It uses your Claude plan, so there is no API key and no extra cost. It ignores your own Claude settings and CLAUDE.md, and it only searches and reads web pages.
- **Recognises the job system.** From the link, or failing that from the page itself, the app tells whether the company uses Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, Personio, Workday (both its `myworkdayjobs.com` and `myworkdaysite.com` addresses), SuccessFactors, iCIMS, Oracle Recruiting, Comeet, Eightfold, Avature or Radancy (TalentBrew).
- **Gives every company a status.** Nothing is hidden: a company the app can't read still shows up, with the reason.
- **Reads sites politely.** It obeys `robots.txt`, waits at least 1.5 seconds between requests to the same site, and says who it is (`JOB-AUTO/0.1 (personal job search)`). A site that blocks it is marked **blocked**; the app never tries to get around that. LinkedIn, Indeed, Glassdoor and other job boards are never used as a careers link.

## Install

1. Download `JOB-AUTO-Setup-<version>.exe` from the [latest release](https://github.com/modusangelus-pixel/job-auto/releases/latest), or build it yourself (see [Build from source](#build-from-source)).
2. Run it. Windows SmartScreen will warn, because the installer isn't code-signed. Choose **More info → Run anyway**.
3. Start **JOB-AUTO** from the Start menu or the desktop shortcut.

You also need [Claude Code](https://claude.com/claude-code) installed and signed in on this computer. Without it the app still opens and shows your companies, but **Find careers pages** stays off and says so.

## First run

1. Open **Companies** and press **Import your company tracker (.xlsx)**. Pick your tracker file. The app shows how many companies it added and lists any rows it couldn't use. Importing the same file again adds nothing twice.
2. Press **Find careers pages**.
   - It works in batches of 5 companies, with Claude (Sonnet) on 3 batches at a time. For 255 companies that should take about **15–20 minutes**, so leave the app open and the computer awake.
   - It uses your Claude plan for the whole time. If your plan hits a usage limit, the run stops and says so; press **Find careers pages** again later.
   - The line under the button shows how far it is and what Claude is doing now.
   - **Stop** ends it. Press **Find careers pages** again later and it carries on with the companies not checked yet. A batch that was stopped is asked again from the start. A company Claude gave no answer for is asked once more, and is marked **not found** if it still gives none.
   - If a run stops with a message about logging in (for example "Please run /login"), open Claude Code, sign in, and press **Find careers pages** again.
3. Open the Vehicle, Machinery and Both tabs, and use the status buttons above the list to see only the companies in one status.

## What each status means

| Status | Meaning |
|---|---|
| **not checked yet** | The lookup hasn't reached this company. |
| **read directly** | A careers page was found and it runs on a job system the app reads itself: Greenhouse, Lever, Ashby, Workable, Personio, Workday, SuccessFactors, iCIMS, Oracle Recruiting, Comeet, Eightfold, Avature or Radancy. The app reads its jobs from it when it checks for jobs (see [Jobs](#jobs)). |
| **needs Claude reading** | A careers page was found, but its job system isn't one the app reads itself, usually because the page builds its job list with scripts. The app reads that page once a week with Claude (see [Reading careers pages with Claude](#reading-careers-pages-with-claude)). When a page couldn't be opened, the row says what went wrong. |
| **blocked** | The site's `robots.txt` doesn't allow reading it, or the site refuses automated readers. The app doesn't try to get around that. |
| **not found** | No careers page turned up, for example because the company no longer exists or was taken over. The row says why. |

## Jobs

The **Jobs** screen lists the open jobs at your companies that fit your filters.

- **Check now** reads the job lists of every company marked **read directly**. The app also does this by itself when you open it, once a day at most. The line by the button shows when the last check was. It reads sites as politely as step 1 does, so a full check takes about 10–20 minutes (the first real check took about 11 minutes for 45 companies).
- **Filters.** The screen lists only jobs that fit. **Settings → Filters** holds the region switches and the word lists the filters use; change them there and the list follows.
- **New tags.** A company's first read sets the starting point and tags nothing. After that, a job found for the first time gets a **NEW** tag for 7 days, or until you give it a status, and new jobs come first in the list. So the very first check shows no NEW tags; that's expected.
- **Status and notes.** On each job you can set a status and write a note; both are kept between checks.
- **Companies that share one careers site** (for example Volvo CE, Renault Trucks and Volvo Autonomous Solutions on the Volvo Group site) are read once per check, and each of those jobs shows once, naming all of them. A status or note you set on it counts for all of them.
- **Companies that need Claude reading** are read as pages, after the others, at most once a week each (see [Reading careers pages with Claude](#reading-careers-pages-with-claude)).
- **Very large lists.** Siemens (Avature) shows only part of its list ("999+ results") and 6 jobs a page, so the app reads its newest 600 jobs and never marks Siemens jobs closed. iCIMS, Oracle Recruiting and Eightfold boards are read up to 50 pages or 2000 jobs, the same way.
- **SmartRecruiters companies show as blocked.** SmartRecruiters' `robots.txt` forbids reading its job feed, so the app doesn't, and doesn't try to get around it.
- **Very large Workday employers.** Workday shows at most 2000 jobs per company, so for very large Workday employers (such as ABB) the app reads the first 2000 and never marks their jobs closed. Such a job shows **not seen since …** once it drops out of those 2000.
- **A careers site the app can't read** shows the error on the company row, for example CNH Industrial's customised site.
- **After the step 2c update** the companies marked **needs Claude reading** that have their own careers link are back to **not checked yet**. Press **Find careers pages** and the app re-checks them from the links it already has, without Claude: those on one of the new job systems become **read directly**, and the rest go back to **needs Claude reading** and are read as pages.
- **Companies screen.** A company read directly shows how many open jobs it has and when it was last read, for example `12 open jobs · read 5 Nov 09:05`, or `not read yet`; a company read as a page says `read as a page 5 Nov 09:05`. If the last read failed, the row says why.
- **The experience limit** (hiding jobs that ask for too many years) arrives with step 3.

## Map, visa and referrals

All of this sits in the **Jobs** screen and the **Companies** screen. It only decides what the app shows you; it never applies for anything.

**The map.** **Jobs** has a **List | Map** switch. On the map, each city with fitting jobs is one dot: the more jobs, the bigger the dot, and the colour shows the region (Nordics, rest of Europe, USA, Canada, Australia, New Zealand, Turkey). Click a dot to see that city's jobs in a panel beside the map.

- The countries are filled in soft colours on a light-blue sea, and neighbours always differ; the dark theme has a darker set.
- Country names grow in as you zoom: the big countries at world view, all of them close in. City names appear as you zoom in, and from 3× zoom each job dot names its city.

- A job whose location names only a country sits at the country's centre, in a dot called "Somewhere in …".
- A job whose location the app can't make sense of is not lost: it is listed under the map.
- Scroll the wheel to zoom, drag to move the map, and press **Whole world** to start over.
- The line under the map credits where the data comes from: `City positions: GeoNames (CC BY 4.0) · Country outlines: Natural Earth`. The map data ships inside the app, so drawing the map needs no internet.

**Visa tags and sponsor lists.** Some governments publish the list of employers allowed to sponsor a work visa. The app reads four of them: **UK, Netherlands, Denmark and Canada**. A job row gets a tag when the job is in a country you ticked under **Countries I can already work in** (below), or in the UK, the Netherlands, Denmark or Canada once that country's list has been read. Other jobs, and jobs in those four countries before their list is first read, get no tag.

- **No visa needed**: the job is in a country you ticked.
- **On the UK / Netherlands / Denmark / Canada sponsor list**: an entry on that country's list matches the employer's name. A job listed by several companies of one group counts as on the list when any of them is.
- **No match on the … sponsor list**: no entry on the list matches the employer's name. The app matches by name only, so an employer registered under another name is missed; look at the list itself before ruling a company out. If the employer really is missing, what that means depends on the country:
  - **UK:** the employer can't sponsor a Skilled Worker visa without a licence. This is the strongest signal.
  - **Netherlands:** not a recognised sponsor for the highly skilled migrant route.
  - **Denmark:** not on the fast-track scheme. Other routes to a work permit exist.
  - **Canada:** no approved LMIA (the paperwork for hiring from abroad) in the last four quarters.

On a company row, **Sponsor lists: UK (…)** shows the matching list entry; when one list has several matching names, the list is named once with each name after it. Names are matched automatically and can be wrong, for example two different companies with one name. If it is the wrong company, press **Not this company** next to that name and the match is dropped for good, also when a later read of the list spells the name differently. Once the lists are read, a company that matches none of them shows **No match on the UK, Netherlands, Denmark or Canada sponsor lists**, naming only the lists that have been read.

**Why the USA, Ireland and New Zealand have only a line.** Their data can't be read automatically: the US and Irish government sites refuse automated readers, and New Zealand only offers a search form. For these countries (and for the other countries without a list) the city panel shows a short line about hiring from abroad, with a link to the official page.

**Settings → Visa.** Here you tick **Countries I can already work in**: EU/EEA and Switzerland, UK, USA, Canada, Australia, New Zealand, Turkey. Jobs in those countries get **No visa needed**. The same screen shows, for each of the four lists, when it was read, how many employers it holds and the last error, and has **Refresh lists now**. The lists also refresh by themselves, at most once a week, when the app opens. A refresh that fails keeps the previous list.

**LinkedIn buttons.** Each job row has **LinkedIn:** buttons: **Recruiters**, **<field> managers** (or **Hiring managers**), and **People in <city>**. Each opens a LinkedIn search in your own browser, where you are signed in as yourself. The app never contacts LinkedIn: it only builds the search address and hands it to your browser.

## Reading careers pages with Claude

Many companies build their job list with scripts on their own careers page, so there is no job feed to read. The app reads those pages with Claude instead.

- **Which companies:** those marked **needs Claude reading**, with a careers or jobs link of their own. A LinkedIn, Indeed or other job board link is never opened.
- **When:** after the other companies in each job check, at most once a week per company, whether the last try worked or not. At most 20 pages a check, those waiting longest first, so the weekly reads spread over the days and a check stays short. The first full round takes about a week.
- **How:**
  1. The app opens the careers page in a hidden window of its own, under its own name (`JOB-AUTO/0.1 (personal job search)`). It obeys `robots.txt`, waits its turn for the site like any other request, and loads one page at a time. It never logs in, fills in a form, downloads anything or opens another window.
  2. After the page has loaded it waits 6 seconds for the page's scripts to build the job list, then takes the page's text and links.
  3. Claude (Sonnet, on your Claude plan, with no tools at all) picks the open jobs' titles, locations and links out of that text, and is told never to invent jobs.
- **A page that leads to a job system:** once its scripts have run, a page often links to the job system behind it, for example an Ashby board, though a plain read of the page never showed it. When the loaded page lands on or links to a system the app reads itself, the company becomes **read directly** and that board is read at once, without Claude. A SmartRecruiters link doesn't count, since its feed may not be read.
- **Claude use:** one short Claude run per page, about 120 a week for your list, on your plan; no API key and no extra cost.
- **No closing:** a page may show only part of the list (the first page of results, say), so these reads never mark a job closed. A job that drops off the page shows **not seen since …**.
- **When it fails:** the company row says why (`Last read failed: …`), and the page is tried again a week later. A page whose `robots.txt` forbids reading, or that shows a bot check, marks the company **blocked**; the app doesn't try to get around it.
- **Switch:** **Settings → Reading → Read script-built careers pages with Claude (weekly)**, on unless you switch it off. Without Claude Code on the computer, page reading is skipped and the log says so.

## Sites that refuse automated reading

Some careers sites refuse automated readers. Where the company publishes its jobs through another open route, use **Paste link** on its row with that route:

| Company | Paste this link |
|---|---|
| Caterpillar | `https://cat.wd5.myworkdayjobs.com/CaterpillarCareers` |
| South32 | `https://careers.south32.net/search/` |
| TELUS Digital | `https://job-boards.greenhouse.io/willowtree` (its WillowTree arm's board) |
| Ansys | `https://careers.synopsys.com` (Synopsys bought Ansys; its jobs are on Synopsys's site, so each shows once, naming both) |

No open route was found for Bosch Rexroth and JCB (`robots.txt` forbids reading), Hitachi Astemo, TÜV SÜD and Micromine (the sites answer HTTP 403), and EACON Mining (the site can't be reached). They stay as they are, with the reason on the row.

## Fixing a wrong link

If Claude found the wrong page, or none, press **Paste link** on the company's row, paste the right address (starting with `http://` or `https://`, or just the address, like `acme.com/careers`, and the app adds `https://`) and press **Check**. The app checks that link and sets the status again. It must be the company's own careers or jobs page, not a job board. **Look up again** puts a company back to *not checked yet*, so the next **Find careers pages** asks Claude about it once more.

## Where data is stored

Everything the app stores is on this computer, in the folder `%USERPROFILE%\JOB-AUTO` (e.g. `C:\Users\you\JOB-AUTO`): the database `job-auto.db`, `refresh.log` beside it, the program window's own working files in `JOB-AUTO\electron`, and an empty folder for Claude to work from, `JOB-AUTO\claude`. There are no accounts and no running costs. Claude Code itself keeps its own files in the `.claude` folder in your user folder.

The Microsoft Store version of Claude Desktop gives the programs it starts their own private copy of AppData, so the app keeps its data in your user folder instead.

**Test runs.** When a Claude session or a dev build (`npm run dev`) starts JOB-AUTO, it works in `JOB-AUTO\test\`, on a copy of your database made the first time, and nothing is written back. The window says **Test run: working on a copy of your data.** Delete the `test` folder to start again from a fresh copy.

## Build from source

Requirements: Windows and Node.js 24. No Visual Studio is needed: the database library (better-sqlite3) comes with a ready-made build for Windows.

```bash
cd app
npm install
npm test
npm run build:win
```

The installer is written to `app/dist/`. `npm run build:unpack` builds just the app folder, `dist/win-unpacked/`, which is quicker.

`npm test` never touches the network or Claude. One extra check does, and only when asked: it imports your tracker into a temporary database and has the real lookup settle 5 companies with Claude (a few minutes, on your Claude plan). It never touches your `JOB-AUTO` folder:

```bash
JOB_AUTO_LIVE=1 JOB_AUTO_TRACKER="C:\path\to\tracker.xlsx" npx vitest run tests/live
```

The job readers have their own live check, one real board per reader, read politely with the app's own fetcher (about 10 minutes):

```bash
JOB_AUTO_LIVE=1 npx vitest run tests/live/jobs.live.test.ts tests/live/readers2c.live.test.ts
```

## Documents

- [Design](docs/2026-11-03-job-auto-design.md)
- [Step 1 build plan](docs/plans/2026-11-03-step1-companies.md)
