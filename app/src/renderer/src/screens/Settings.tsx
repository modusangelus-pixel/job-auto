import { useEffect, useState } from 'react'
import type { FilterSettings, RegionGroup, SponsorListInfo } from '../../../shared/types'
import { SPONSOR_LIST_LABEL, WORK_RIGHT_GROUPS } from '../../../shared/visa'
import { dayMonthYear } from '../dates'
import { REGION_LABEL } from '../labels'

type ListKey = 'keep' | 'engineer' | 'level' | 'type'

const REGIONS = Object.keys(REGION_LABEL) as RegionGroup[]
const LISTS: { key: ListKey; label: string }[] = [
  { key: 'keep', label: 'Keep titles with' },
  { key: 'engineer', label: 'Drop engineer titles with' },
  { key: 'level', label: 'Drop senior titles with' },
  { key: 'type', label: 'Drop job types with' }
]

const SAVED_MESSAGE = 'Saved. The Jobs list uses these filters now.'

// A rejected call carries a message written for the owner, so it is shown as it is.
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The form holds each list as the text of its textarea, one entry per line (or between commas). */
interface Form {
  regions: Record<RegionGroup, boolean>
  text: Record<ListKey, string>
}

const toForm = (f: FilterSettings): Form => ({
  regions: { ...f.regions },
  text: {
    keep: f.keep.join('\n'),
    engineer: f.engineer.join('\n'),
    level: f.level.join('\n'),
    type: f.type.join('\n')
  }
})

const toLines = (text: string): string[] =>
  text
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

/** Work rights and the sponsor lists. It reads and saves on its own, apart from the filters form. */
function VisaSettings(): React.JSX.Element {
  const [labels, setLabels] = useState<string[] | null>(null)
  const [lists, setLists] = useState<SponsorListInfo[]>([])
  const [saved, setSaved] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    const api = window.jobAuto
    api
      .getWorkRights()
      .then(setLabels)
      .catch((err: unknown) => setProblem(messageOf(err)))
    api
      .sponsorLists()
      .then(setLists)
      .catch((err: unknown) => setProblem(messageOf(err)))
  }, [])

  async function save(): Promise<void> {
    if (labels === null) return
    try {
      // Saved in the order of the groups, whatever order they were ticked in.
      await window.jobAuto.saveWorkRights(
        WORK_RIGHT_GROUPS.map((g) => g.label).filter((l) => labels.includes(l))
      )
      setProblem(null)
      setSaved(true)
    } catch (err) {
      setSaved(false)
      setProblem(messageOf(err))
    }
  }

  async function refresh(): Promise<void> {
    setRefreshing(true)
    try {
      // The refresh never rejects; each list's own error is in its row.
      await window.jobAuto.refreshSponsorLists()
      setLists(await window.jobAuto.sponsorLists())
      setProblem(null)
    } catch (err) {
      setProblem(messageOf(err))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <h3>Visa</h3>
      {problem && <p className="warn">{problem}</p>}
      {labels !== null && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <fieldset className="regions">
            <legend>Countries I can already work in</legend>
            {WORK_RIGHT_GROUPS.map((g) => (
              <label key={g.label} className="check">
                <input
                  type="checkbox"
                  checked={labels.includes(g.label)}
                  onChange={(e) => {
                    setLabels(
                      e.target.checked ? [...labels, g.label] : labels.filter((l) => l !== g.label)
                    )
                    setSaved(false)
                  }}
                />
                {g.label}
              </label>
            ))}
          </fieldset>
          <div className="row-buttons">
            <button type="submit">Save visa settings</button>
          </div>
          {saved && <p className="ok">Saved. The Jobs list uses these countries now.</p>}
        </form>
      )}
      <table className="sponsor-lists">
        <tbody>
          {lists.map((l) => (
            <tr key={l.country}>
              <td>{SPONSOR_LIST_LABEL[l.country]}</td>
              <td>{l.fetchedAt === null ? 'never' : `updated ${dayMonthYear(l.fetchedAt)}`}</td>
              <td>{l.entries}</td>
              <td className="warn">{l.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-buttons">
        <button type="button" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? 'Refreshing…' : 'Refresh lists now'}
        </button>
      </div>
    </>
  )
}

/** Whether script-built careers pages are read with Claude, weekly. Saved as soon as it is switched. */
function ReadingSettings(): React.JSX.Element {
  const [on, setOn] = useState<boolean | null>(null)
  const [saved, setSaved] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    window.jobAuto
      .getReadPages()
      .then(setOn)
      .catch((err: unknown) => setProblem(messageOf(err)))
  }, [])

  async function save(next: boolean): Promise<void> {
    setOn(next)
    try {
      await window.jobAuto.saveReadPages(next)
      setProblem(null)
      setSaved(true)
    } catch (err) {
      setSaved(false)
      setProblem(messageOf(err))
    }
  }

  return (
    <>
      <h3>Reading</h3>
      {problem && <p className="warn">{problem}</p>}
      {on !== null && (
        <label className="check">
          <input type="checkbox" checked={on} onChange={(e) => void save(e.target.checked)} />
          Read script-built careers pages with Claude (weekly)
        </label>
      )}
      <p className="muted">
        For companies marked &ldquo;needs Claude reading&rdquo;: the app opens each careers page in
        a hidden window once a week, and Claude reads the jobs from it on your Claude plan. These
        reads never mark a job closed.
      </p>
      {saved && <p className="ok">Saved.</p>}
    </>
  )
}

export function Settings(): React.JSX.Element {
  const [form, setForm] = useState<Form | null>(null)
  const [saved, setSaved] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.jobAuto
      .getFilters()
      .then((f) => setForm(toForm(f)))
      .catch((err: unknown) => setProblem(messageOf(err)))
  }, [])

  // Any change to the form takes the "Saved" line away: it no longer describes what is on screen.
  const edit = (next: Form): void => {
    setForm(next)
    setSaved(false)
  }

  async function save(): Promise<void> {
    if (form === null) return
    setBusy(true)
    try {
      await window.jobAuto.saveFilters({
        regions: form.regions,
        keep: toLines(form.text.keep),
        engineer: toLines(form.text.engineer),
        level: toLines(form.text.level),
        type: toLines(form.text.type)
      })
      setProblem(null)
      setSaved(true)
    } catch (err) {
      setSaved(false)
      setProblem(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  async function reset(): Promise<void> {
    try {
      edit(toForm(await window.jobAuto.defaultFilters()))
      setProblem(null)
    } catch (err) {
      setProblem(messageOf(err))
    }
  }

  return (
    <div className="settings">
      <h2>Settings</h2>
      <h3>Filters</h3>
      {problem && <p className="warn">{problem}</p>}
      {form !== null && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <fieldset className="regions">
            <legend>Regions</legend>
            {REGIONS.map((r) => (
              <label key={r} className="check">
                <input
                  type="checkbox"
                  checked={form.regions[r]}
                  onChange={(e) =>
                    edit({ ...form, regions: { ...form.regions, [r]: e.target.checked } })
                  }
                />
                {REGION_LABEL[r]}
              </label>
            ))}
          </fieldset>
          <p className="muted">
            One word or phrase per line. End a word with * to match every word that starts with it.
            Upper and lower case, and accents, don&apos;t matter.
          </p>
          {LISTS.map(({ key, label }) => (
            <label key={key} className="word-list">
              {label}
              <textarea
                rows={6}
                value={form.text[key]}
                onChange={(e) => edit({ ...form, text: { ...form.text, [key]: e.target.value } })}
              />
            </label>
          ))}
          <div className="row-buttons">
            <button type="submit" disabled={busy}>
              Save filters
            </button>
            <button type="button" className="secondary" onClick={() => void reset()}>
              Reset to defaults
            </button>
          </div>
          {saved && <p className="ok">{SAVED_MESSAGE}</p>}
        </form>
      )}
      <VisaSettings />
      <ReadingSettings />
    </div>
  )
}
