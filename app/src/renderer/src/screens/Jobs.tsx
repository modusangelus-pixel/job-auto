import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CompanyList,
  Job,
  JobCheckProgress,
  JobStatus,
  RegionGroup,
  SponsorCountry
} from '../../../shared/types'
import { countryLine, visaTag, WORK_RIGHT_GROUPS } from '../../../shared/visa'
import { dateTime, dayMonth, dayMonthYear, daysAgo, postedText } from '../dates'
import { groupShared, placeAt, type JobGroup, type PlaceKey } from '../jobGroups'
import {
  countryName,
  FIXED_TERM_LABEL,
  JOB_STATUS_LABEL,
  jobCount,
  LIST_LABEL,
  LOCATION_UNCLEAR_LABEL,
  REGION_LABEL,
  shortLink
} from '../labels'
import { linkedInSearches } from '../linkedin'
import { WorldMap } from '../map/WorldMap'

const LISTS = Object.keys(LIST_LABEL) as CompanyList[]
const REGIONS = Object.keys(REGION_LABEL) as RegionGroup[]
const STATUSES = Object.keys(JOB_STATUS_LABEL) as JobStatus[]

type RegionFilter = RegionGroup | 'all' | 'unclear'
type StatusFilter = JobStatus | 'any' | 'none'
type JobsView = 'list' | 'map'

const IDLE: JobCheckProgress = {
  running: false,
  done: 0,
  total: 0,
  current: [],
  lastSummary: null,
  lastCheckAt: null
}

// A rejected call carries a message written for the owner, so it is shown as it is.
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function progressLine(p: JobCheckProgress): string {
  let line = `Checked ${p.done} of ${p.total}`
  if (p.current.length > 0) line += ` · now: ${p.current.join(', ')}`
  return line
}

/** New first, then the newest by posted date, or by first seen when there is none. */
function byNewest(a: Job, b: Job): number {
  if (a.isNew !== b.isNew) return a.isNew ? -1 : 1
  return Date.parse(b.postedAt ?? b.firstSeen) - Date.parse(a.postedAt ?? a.firstSeen)
}

function passesRegion(j: Job, f: RegionFilter): boolean {
  if (f === 'all') return true
  if (f === 'unclear') return j.locationUnclear
  return j.regionGroups.includes(f)
}

function passesStatus(j: Job, f: StatusFilter): boolean {
  if (f === 'any') return true
  if (f === 'none') return j.status === null
  return j.status === f
}

function postedPart(j: Job): string {
  if (j.postedAt === null) return `first seen ${dayMonth(j.firstSeen)}`
  return j.postedRough ? 'posted 30+ days ago' : postedText(j.postedAt)
}

/** The location text, with the unclear note after it; the note alone when there is no text. */
function locationPart(j: Job): string {
  if (!j.locationUnclear) return j.location
  return j.location === '' ? LOCATION_UNCLEAR_LABEL : `${j.location} · ${LOCATION_UNCLEAR_LABEL}`
}

/** An open job last seen on a day before the last check's day: the check did not find it. */
function notSeenPart(j: Job, lastCheckAt: string | null): string | null {
  if (j.closedAt !== null || lastCheckAt === null) return null
  return daysAgo(j.lastSeen, new Date(lastCheckAt)) > 0
    ? `not seen since ${dayMonth(j.lastSeen)}`
    : null
}

function JobRow({
  group,
  lastCheckAt,
  workCountries,
  readLists,
  onProblem,
  onSaved
}: {
  group: JobGroup
  /** When the last job check finished, if one has. */
  lastCheckAt: string | null
  /** The countries the owner can already work in. */
  workCountries: string[]
  /** The sponsor lists read at least once. */
  readLists: SponsorCountry[]
  onProblem(message: string | null): void
  /** A save went through: the screen keeps the jobs' stored values. */
  onSaved(ids: number[], patch: Partial<Pick<Job, 'status' | 'notes'>>): void
}): React.JSX.Element {
  const j = group.job
  const [notes, setNotes] = useState(j.notes)
  const notSeen = notSeenPart(j, lastCheckAt)
  const tag = visaTag(j, workCountries, readLists)
  const city = j.places.find((p) => p.city !== null)?.city ?? null
  const searches = linkedInSearches(group.companies[0], j.title, city)

  const save = (
    call: () => Promise<unknown>,
    patch?: Partial<Pick<Job, 'status' | 'notes'>>
  ): void =>
    void call().then(
      () => {
        onProblem(null)
        if (patch) onSaved(group.ids, patch)
      },
      (err: unknown) => onProblem(messageOf(err))
    )
  /** The same change saved to every stored copy of the job. */
  const toAll = (one: (id: number) => Promise<void>) => () => Promise.all(group.ids.map(one))

  return (
    <li className="company job">
      <div className="company-line">
        {j.isNew && <span className="new-tag">NEW</span>}
        <button
          className="link job-title"
          onClick={() => save(() => window.jobAuto.openExternal(j.url))}
        >
          {j.title}
        </button>
        <span className="company-name">{group.companies.join(', ')}</span>
        <span className="muted">{locationPart(j)}</span>
        {tag !== null && <span className="visa-tag">{tag}</span>}
        {j.employment === 'fixed_term' && <span className="muted">{FIXED_TERM_LABEL}</span>}
      </div>
      <div className="company-line">
        <span className="muted">{postedPart(j)}</span>
        {j.closedAt !== null && (
          <span className="warn">{`closed on ${dayMonthYear(j.closedAt)}`}</span>
        )}
        {notSeen !== null && <span className="warn">{notSeen}</span>}
      </div>
      <div className="company-line linkedin-line">
        <span className="muted">LinkedIn:</span>
        {searches.map(({ label, url }) => (
          <button
            key={label}
            className="link"
            onClick={() => save(() => window.jobAuto.openExternal(url))}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="job-edit">
        <select
          aria-label={`Status of ${j.title}`}
          value={j.status ?? ''}
          onChange={(e) => {
            const next = e.target.value === '' ? null : (e.target.value as JobStatus)
            save(
              toAll((id) => window.jobAuto.setJobStatus(id, next)),
              { status: next }
            )
          }}
        >
          <option value="">—</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {JOB_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          aria-label={`Notes for ${j.title}`}
          placeholder="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== j.notes)
              save(
                toAll((id) => window.jobAuto.setJobNotes(id, notes)),
                { notes }
              )
          }}
        />
      </div>
    </li>
  )
}

/** The picked place's name, its country's note on hiring from abroad, and its jobs. */
function PlacePanel({
  groups,
  picked,
  row,
  onProblem
}: {
  groups: JobGroup[]
  picked: PlaceKey | null
  row(g: JobGroup): React.JSX.Element
  onProblem(message: string | null): void
}): React.JSX.Element {
  const at = picked === null ? null : placeAt(groups, picked)
  if (!at) return <p className="muted">Click a dot to see its jobs.</p>
  const country = countryName(at.place.country)
  const where = at.place.city === null ? `Somewhere in ${country}` : `${at.place.city}, ${country}`
  const line = countryLine(at.place.country, country)
  const link = line?.link ?? null
  return (
    <>
      <h3>{`${where} · ${jobCount(at.groups.length)}`}</h3>
      {line && (
        <p className="country-line">
          <span>{line.text}</span>
          {link !== null && (
            <button
              className="link"
              onClick={() =>
                void window.jobAuto
                  .openExternal(link)
                  .then(() => onProblem(null))
                  .catch((err: unknown) => onProblem(messageOf(err)))
              }
            >
              {shortLink(link)}
            </button>
          )}
        </p>
      )}
      <ul className="rows">{at.groups.map(row)}</ul>
    </>
  )
}

export function Jobs(): React.JSX.Element {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [tab, setTab] = useState<CompanyList | 'all'>('all')
  const [region, setRegion] = useState<RegionFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('any')
  const [view, setView] = useState<JobsView>('list')
  const [picked, setPicked] = useState<PlaceKey | null>(null)
  const [progress, setProgress] = useState<JobCheckProgress>(IDLE)
  const [workCountries, setWorkCountries] = useState<string[]>([])
  const [readLists, setReadLists] = useState<SponsorCountry[]>([])
  const [starting, setStarting] = useState(false)
  // A problem from a button or a save, and a problem reading the list, which a later read clears.
  const [problem, setProblem] = useState<string | null>(null)
  const [listProblem, setListProblem] = useState<string | null>(null)
  const lastProgress = useRef<JobCheckProgress>(IDLE)

  // The sponsor lists are read with the jobs: a list read for the first time meanwhile can then speak in the tags.
  const load = useCallback(() => {
    const api = window.jobAuto
    void api
      .listJobs()
      .then((list) => {
        setJobs(list)
        setListProblem(null)
      })
      .catch((err: unknown) => setListProblem(messageOf(err)))
    void api
      .sponsorLists()
      .then((lists) =>
        setReadLists(lists.filter((l) => l.fetchedAt !== null).map((l) => l.country))
      )
      .catch((err: unknown) => setProblem(messageOf(err)))
  }, [])

  useEffect(() => {
    const api = window.jobAuto
    load()
    void api
      .jobCheckInfo()
      .then((p) => {
        lastProgress.current = p
        setProgress(p)
      })
      .catch((err: unknown) => setProblem(messageOf(err)))
    // The screen mounts afresh when the owner returns from Settings, so a change there shows here.
    void api
      .getWorkRights()
      .then((labels) =>
        setWorkCountries(
          WORK_RIGHT_GROUPS.filter((g) => labels.includes(g.label)).flatMap((g) => g.countries)
        )
      )
      .catch((err: unknown) => setProblem(messageOf(err)))
    return api.onJobCheckProgress((p) => {
      const before = lastProgress.current
      lastProgress.current = p
      setProgress(p)
      // The jobs change when a check ends, so the list is read again then.
      if (before.running && !p.running) load()
    })
  }, [load])

  async function startCheck(): Promise<void> {
    setStarting(true)
    setProblem(null)
    try {
      await window.jobAuto.startJobCheck()
    } catch (err) {
      setProblem(messageOf(err))
    } finally {
      setStarting(false)
      load()
    }
  }

  async function stopCheck(): Promise<void> {
    try {
      await window.jobAuto.stopJobCheck()
    } catch (err) {
      setProblem(messageOf(err))
    }
  }

  const updateJobs = (ids: number[], patch: Partial<Pick<Job, 'status' | 'notes'>>): void =>
    setJobs((all) => all && all.map((x) => (ids.includes(x.id) ? { ...x, ...patch } : x)))

  const running = starting || progress.running
  // The tab counts show what each list would hold under the region and status selects. A job shared by several
  // companies counts once, under each of their lists.
  const filtered = groupShared(jobs ?? []).filter(
    (g) => passesRegion(g.job, region) && passesStatus(g.job, status)
  )
  const shown = filtered
    .filter((g) => tab === 'all' || g.lists.includes(tab))
    .sort((a, b) => byNewest(a.job, b.job))
  // Jobs the map can't place: an unclear location, or countries without a centre point.
  const unplaced = shown.filter((g) => g.job.places.length === 0)

  const row = (g: JobGroup): React.JSX.Element => (
    <JobRow
      key={g.ids[0]}
      group={g}
      lastCheckAt={progress.lastCheckAt}
      workCountries={workCountries}
      readLists={readLists}
      onProblem={setProblem}
      onSaved={updateJobs}
    />
  )

  return (
    <div className="companies jobs">
      <h2>Jobs</h2>

      <div className="lookup">
        <div className="row-buttons">
          <button disabled={running} onClick={() => void startCheck()}>
            Check now
          </button>
          {running && (
            <button className="secondary" onClick={() => void stopCheck()}>
              Stop
            </button>
          )}
        </div>
        {progress.running ? (
          <p className="muted">{progressLine(progress)}</p>
        ) : (
          <p className="muted">
            {progress.lastCheckAt !== null
              ? `Last check: ${dateTime(progress.lastCheckAt)}`
              : 'Never checked'}
            {progress.lastSummary !== null && ` · ${progress.lastSummary}`}
          </p>
        )}
      </div>
      {problem && <p className="warn">{problem}</p>}
      {listProblem && <p className="warn">{listProblem}</p>}

      <div className="tabs" role="tablist">
        {(['all', ...LISTS] as const).map((l) => (
          <button
            key={l}
            role="tab"
            aria-selected={l === tab}
            className="tab"
            onClick={() => setTab(l)}
          >
            {`${l === 'all' ? 'All' : LIST_LABEL[l]} (${
              l === 'all' ? filtered.length : filtered.filter((g) => g.lists.includes(l)).length
            })`}
          </button>
        ))}
      </div>

      <div className="job-filters">
        <div className="view-switch" role="group" aria-label="View">
          {(['list', 'map'] as const).map((v) => (
            <button key={v} aria-pressed={v === view} onClick={() => setView(v)}>
              {v === 'list' ? 'List' : 'Map'}
            </button>
          ))}
        </div>
        <select
          aria-label="Region"
          value={region}
          onChange={(e) => setRegion(e.target.value as RegionFilter)}
        >
          <option value="all">All regions</option>
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {REGION_LABEL[r]}
            </option>
          ))}
          <option value="unclear">Location unclear</option>
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
        >
          <option value="any">Any status</option>
          <option value="none">No status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {JOB_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {jobs !== null && shown.length === 0 && (
        <p className="muted">
          No jobs to show. Press Check now to read the companies&apos; job lists.
        </p>
      )}
      {view === 'list' && shown.length > 0 && <ul className="rows">{shown.map(row)}</ul>}
      {view === 'map' && jobs !== null && (
        <>
          <div className="map-layout">
            {/* New filters open a new first view, fitted to their dots. */}
            <WorldMap
              key={`${tab}|${region}|${status}`}
              groups={shown}
              picked={picked}
              onPick={setPicked}
            />
            <section className="place-panel" aria-label="Jobs at this place">
              <PlacePanel groups={shown} picked={picked} row={row} onProblem={setProblem} />
            </section>
          </div>
          {unplaced.length > 0 && (
            <section className="unplaced" aria-label={`Location unclear (${unplaced.length})`}>
              <h3>{`Location unclear (${unplaced.length})`}</h3>
              <ul className="rows">{unplaced.map(row)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
