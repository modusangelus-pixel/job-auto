import type { CompanyList, Job, Place } from '../../shared/types'

/** A spot on the map: `city|country`, with an empty city for a country's centre. */
export type PlaceKey = string

export const placeKey = (p: Place): PlaceKey => `${p.city ?? ''}|${p.country}`

/** The groups with a place at this key, in their order, and that place; null when none has it. */
export function placeAt(
  groups: JobGroup[],
  key: PlaceKey
): { place: Place; groups: JobGroup[] } | null {
  let place: Place | null = null
  const here: JobGroup[] = []
  for (const g of groups) {
    const p = g.job.places.find((x) => placeKey(x) === key)
    if (!p) continue
    place ??= p
    here.push(g)
  }
  return place && { place, groups: here }
}

/**
 * One row of the Jobs list. A group's brands often share one careers site, so the same job is stored once for each
 * company on that board; the list shows it once, naming them all.
 */
export interface JobGroup {
  /**
   * The first copy, New when any copy is, with the first status and notes any copy has, and the sponsor matches of
   * every copy's company.
   */
  job: Job
  /** Every stored copy: a status or note is saved to all of them. */
  ids: number[]
  companies: string[]
  lists: CompanyList[]
}

/** Copies of one job (the same address) become one group, in the order they first appear. */
export function groupShared(jobs: Job[]): JobGroup[] {
  const byUrl = new Map<string, JobGroup>()
  for (const j of jobs) {
    const group = byUrl.get(j.url)
    if (!group) {
      byUrl.set(j.url, { job: j, ids: [j.id], companies: [j.company], lists: [j.list] })
      continue
    }
    group.ids.push(j.id)
    if (!group.companies.includes(j.company)) group.companies.push(j.company)
    if (!group.lists.includes(j.list)) group.lists.push(j.list)
    const sponsors = [...group.job.sponsors]
    for (const m of j.sponsors) {
      if (!sponsors.some((x) => x.country === m.country && x.name === m.name)) sponsors.push(m)
    }
    group.job = {
      ...group.job,
      isNew: group.job.isNew || j.isNew,
      status: group.job.status ?? j.status,
      notes: group.job.notes !== '' ? group.job.notes : j.notes,
      sponsors
    }
  }
  return [...byUrl.values()]
}
