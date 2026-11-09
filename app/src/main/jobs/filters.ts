import type { FilterSettings, RawJob, RegionGroup } from '../../shared/types'
import type { Db } from '../db/db'
import { getSetting, setSetting } from '../db/settings'
import { foldText } from './fold'
import { REGION_COUNTRIES, regionGroupsOf } from './location'

export { foldText }

export const DEFAULT_FILTERS: FilterSettings = {
  regions: {
    nordics: true,
    europe: true,
    usa: true,
    canada: true,
    australia: true,
    new_zealand: true,
    turkey: true
  },
  keep: [
    'project',
    'projects',
    'program',
    'programs',
    'programme',
    'programmes',
    'pmo',
    'quality',
    'change',
    'process',
    'processes',
    'continuous improvement',
    'operational excellence',
    'lean',
    'delivery manager',
    'coordinator',
    'proje',
    'projesi',
    'projeler*',
    'kalite*',
    'süreç*',
    'değişim*',
    'sürekli iyileştirme',
    'operasyonel mükemmellik',
    'yalın',
    'koordinatör*'
  ],
  engineer: ['engineer', 'engineers', 'mühendis', 'mühendisi'],
  level: [
    'senior',
    'sr',
    'lead',
    'principal',
    'staff',
    'head of',
    'director',
    'vp',
    'vice president',
    'chief',
    'kıdemli',
    'direktör',
    'direktörü',
    'müdür',
    'müdürü',
    'başkan*',
    'lider*'
  ],
  type: [
    'intern',
    'interns',
    'internship',
    'internships',
    'thesis',
    'working student',
    'werkstudent',
    'student',
    'students',
    'summer',
    'apprentice',
    'apprenticeship',
    'part time',
    'praktikum',
    'praktikant',
    'stajyer',
    'staj',
    'yarı zamanlı'
  ]
}

const tokensOf = (s: string): string[] => foldText(s).match(/[\p{L}\p{N}]+/gu) ?? []
// Entry tokens keep a trailing * (any title token starting with the rest matches).
const entryTokensOf = (s: string): string[] => foldText(s).match(/[\p{L}\p{N}]+\*?/gu) ?? []

/** A word list folded and tokenised: one token list per entry, blank entries left out. */
const prepare = (words: string[]): string[][] =>
  words.map(entryTokensOf).filter((entry) => entry.length > 0)

/** True when the tokens hold any entry: a word as one token, a phrase as consecutive tokens; `x*` matches a prefix. */
function matches(tokens: string[], entries: string[][]): boolean {
  return entries.some((entry) => {
    for (let i = 0; i + entry.length <= tokens.length; i++) {
      if (
        entry.every((e, k) =>
          e.endsWith('*') ? tokens[i + k].startsWith(e.slice(0, -1)) : tokens[i + k] === e
        )
      )
        return true
    }
    return false
  })
}

/** True when the title has any of the words (one token) or phrases (consecutive tokens); `x*` matches a prefix. */
export function hasWord(title: string, words: string[]): boolean {
  return matches(tokensOf(title), prepare(words))
}

export type RuleResult =
  | { fits: true; regionGroups: RegionGroup[]; locationUnclear: boolean }
  | { fits: false; reason: 'type' | 'role' | 'engineer' | 'level' | 'region' }

export interface Rules {
  /** Rules 1-4 on the title alone (type words, keep, engineer, level); used to decide Workday detail reads. */
  titleFits(title: string): boolean
  apply(job: Pick<RawJob, 'title' | 'countries' | 'employment'>): RuleResult
}

/** The rule filters with each word list folded and tokenised once, for matching many jobs. */
export function rulesFor(f: FilterSettings): Rules {
  const type = prepare(f.type)
  const keep = prepare(f.keep)
  const engineer = prepare(f.engineer)
  const level = prepare(f.level)
  /** Why a title fails rules 1-4, or null when it fits them. */
  const titleRule = (title: string): 'type' | 'role' | 'engineer' | 'level' | null => {
    const tokens = tokensOf(title)
    if (matches(tokens, type)) return 'type'
    if (!matches(tokens, keep)) return 'role'
    if (matches(tokens, engineer)) return 'engineer'
    if (matches(tokens, level)) return 'level'
    return null
  }
  return {
    titleFits: (title) => titleRule(title) === null,
    apply(job) {
      if (job.employment === 'intern' || job.employment === 'part_time') {
        return { fits: false, reason: 'type' }
      }
      const reason = titleRule(job.title)
      if (reason !== null) return { fits: false, reason }
      if (job.countries.length === 0) return { fits: true, regionGroups: [], locationUnclear: true }
      const regionGroups = regionGroupsOf(job.countries).filter((g) => f.regions[g])
      if (regionGroups.length === 0) return { fits: false, reason: 'region' }
      return { fits: true, regionGroups, locationUnclear: false }
    }
  }
}

/** Rules 1-4 on the title alone; to match many titles, use rulesFor once. */
export function titleFits(title: string, f: FilterSettings): boolean {
  return rulesFor(f).titleFits(title)
}

/** All five rules on one job; to match many jobs, use rulesFor once. */
export function applyRules(
  job: Pick<RawJob, 'title' | 'countries' | 'employment'>,
  f: FilterSettings
): RuleResult {
  return rulesFor(f).apply(job)
}

const LIST_KEYS = ['keep', 'engineer', 'level', 'type'] as const

export function loadFilters(db: Db): FilterSettings {
  const result: FilterSettings = {
    regions: { ...DEFAULT_FILTERS.regions },
    keep: [...DEFAULT_FILTERS.keep],
    engineer: [...DEFAULT_FILTERS.engineer],
    level: [...DEFAULT_FILTERS.level],
    type: [...DEFAULT_FILTERS.type]
  }
  const text = getSetting(db, 'filters')
  if (text === null) return result
  let saved: unknown
  try {
    saved = JSON.parse(text)
  } catch {
    return result
  }
  if (typeof saved !== 'object' || saved === null) return result
  const obj = saved as Record<string, unknown>
  for (const key of LIST_KEYS) {
    const v = obj[key]
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) result[key] = v as string[]
  }
  const regions = obj.regions
  if (typeof regions === 'object' && regions !== null) {
    for (const g of Object.keys(REGION_COUNTRIES) as RegionGroup[]) {
      const v = (regions as Record<string, unknown>)[g]
      if (typeof v === 'boolean') result.regions[g] = v
    }
  }
  return result
}

export function saveFilters(db: Db, f: FilterSettings): void {
  const clean = (list: string[]): string[] => list.map((w) => w.trim()).filter((w) => w !== '')
  setSetting(
    db,
    'filters',
    JSON.stringify({
      regions: f.regions,
      keep: clean(f.keep),
      engineer: clean(f.engineer),
      level: clean(f.level),
      type: clean(f.type)
    })
  )
}
