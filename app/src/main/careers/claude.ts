// The careers-page lookup: Claude Code's CLI run headless on the owner's own Claude login, with only web search and
// page reading, asked for a few companies at a time. Nothing here may import 'electron'.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'
import { createInterface } from 'node:readline'
import { z } from 'zod'
import type { Company } from '../../shared/types'
import { isJobBoardSite } from './detect'

export const LOOKUP_RULES = `You find the official careers pages of companies for JOB-AUTO, the owner's personal job-search app.
For each company in the request:
- Find the company's own official careers page with WebSearch. Never LinkedIn, Indeed, Glassdoor or any other job board.
- Open it with WebFetch and follow it to the page that lists the open jobs, for example a "Search jobs" or "View all jobs" link. That page is often on a job system such as Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee, Personio or SuccessFactors.
- When the company has a global careers site and country sites, give the global one.
- When the company no longer exists, was taken over, or has no careers page you can find, give null for both links and say why in the note.
- When a page is blocked or asks for a captcha or a login, don't try to get around it: give the link you found and write "blocked" in the note.
- Never guess a link. Give only links you saw.
Answer with only a JSON array, one object per company, in the order asked:
[{"id": <id>, "careersUrl": "<link or null>", "jobsUrl": "<link or null>", "note": "<one short sentence or empty>"}]`

/** Where Claude Code's CLI is: on PATH, else the native installer's or npm's location. */
export function findClaude(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync
): string | null {
  const candidates = [
    ...(env.PATH ?? '')
      .split(';')
      .filter(Boolean)
      .map((dir) => win32.join(dir, 'claude.exe')),
    env.USERPROFILE ? win32.join(env.USERPROFILE, '.local', 'bin', 'claude.exe') : null,
    env.APPDATA
      ? win32.join(
          env.APPDATA,
          'npm',
          'node_modules',
          '@anthropic-ai',
          'claude-code',
          'bin',
          'claude.exe'
        )
      : null
  ]
  return candidates.find((c): c is string => c !== null && exists(c)) ?? null
}

/** CLI arguments for one headless run; the request itself goes in on stdin. */
export function lookupArgs(): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    // The account's default model was Opus, which took twice as long per batch as Sonnet for links as good.
    '--model',
    'sonnet',
    // None of the owner's own Claude settings, hooks or CLAUDE.md: only these rules and tools.
    '--setting-sources',
    '',
    // No config given, so no connectors either.
    '--strict-mcp-config',
    '--tools',
    'WebSearch,WebFetch',
    '--allowedTools',
    'WebSearch,WebFetch',
    '--permission-mode',
    'dontAsk',
    '--append-system-prompt',
    LOOKUP_RULES
  ]
}

export const PAGE_RULES = `You read one company's careers page for JOB-AUTO, the owner's personal job-search app. You get the page's visible text and its links. Return only a JSON array of the open jobs the page lists: [{"title": string, "location": string, "url": string|null}]. Use only what the page shows; never invent jobs. Use the job's own link from the links list when one matches the title, else null. Return [] when the page lists no jobs.`

/** CLI arguments for reading one captured careers page: like the lookup's, but with no tools at all. */
export function pageArgs(): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--model',
    'sonnet',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    // The page is in the prompt; Claude needs nothing else and may use nothing else.
    '--tools',
    '',
    '--permission-mode',
    'dontAsk',
    '--append-system-prompt',
    PAGE_RULES
  ]
}

/** The request for one run: one line per company, with the ids Claude must answer by. */
export function lookupPrompt(companies: Pick<Company, 'id' | 'name' | 'hq' | 'focus'>[]): string {
  const lines = companies.map((c) => {
    const details = [c.hq.trim() && `headquarters: ${c.hq.trim()}`, c.focus.trim()].filter(Boolean)
    return `id ${c.id}: ${c.name}${details.length ? ` (${details.join('; ')})` : ''}`
  })
  return ['Find the careers pages of these companies:', ...lines].join('\n')
}

export interface LookupAnswer {
  id: number
  careersUrl: string | null
  jobsUrl: string | null
  note: string
}

// Claude's links are only trusted when they are web links and not on a job board; anything else becomes null.
function webLink(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const link = value.trim()
  return /^https?:\/\//i.test(link) && !isJobBoardSite(link) ? link : null
}

// .optional() so a missing field is read as null or '' instead of dropping the whole answer.
const Answer = z.object({
  id: z.number(),
  careersUrl: z.unknown().optional().transform(webLink),
  jobsUrl: z.unknown().optional().transform(webLink),
  note: z
    .unknown()
    .optional()
    .transform((n) => (typeof n === 'string' ? n.trim() : ''))
})

// The first JSON array in the text. Claude sometimes ends with a source list of [name](link) pairs, so the array
// can't be taken as everything from the first '[' to the last ']'.
export function firstJsonArray(text: string): unknown[] | null {
  for (let start = text.indexOf('['); start !== -1; start = text.indexOf('[', start + 1)) {
    for (let end = text.indexOf(']', start); end !== -1; end = text.indexOf(']', end + 1)) {
      try {
        const value: unknown = JSON.parse(text.slice(start, end + 1))
        if (Array.isArray(value)) return value
      } catch {
        // Not a whole array yet: try the next ']'.
      }
    }
  }
  return null
}

/** Reads the JSON array out of Claude's final text; ids it was not asked about and repeated ids are dropped. */
export function parseLookupResult(text: string, ids: number[]): LookupAnswer[] {
  const items = firstJsonArray(text)
  if (items === null) return []
  const answers = new Map<number, LookupAnswer>()
  for (const item of items) {
    const parsed = Answer.safeParse(item)
    if (parsed.success && ids.includes(parsed.data.id) && !answers.has(parsed.data.id))
      answers.set(parsed.data.id, parsed.data)
  }
  return [...answers.values()]
}

function shortUrl(url: unknown): string {
  try {
    const u = new URL(String(url))
    return `${u.host}${u.pathname}`.slice(0, 80)
  } catch {
    return String(url).slice(0, 80)
  }
}

export interface LookupDone {
  ok: boolean
  text: string
}

type Block = { type: string; name?: string; input?: Record<string, unknown> }

/** Turns one stream-json line from the CLI into a progress step, or the final result. */
export function readLookupLine(text: string): { step?: string; done?: LookupDone } {
  let e: {
    type?: string
    subtype?: string
    is_error?: boolean
    result?: string
    message?: { content?: Block[] }
  }
  try {
    e = JSON.parse(text)
  } catch {
    return {}
  }
  if (e.type === 'result') {
    const ok = e.subtype === 'success' && e.is_error !== true
    return {
      done: { ok, text: e.result?.trim() || `Claude stopped: ${e.subtype ?? 'unknown reason'}` }
    }
  }
  let step: string | undefined
  if (e.type === 'assistant') {
    for (const b of e.message?.content ?? []) {
      if (b.type !== 'tool_use') continue
      const input = b.input ?? {}
      if (b.name === 'WebSearch') step = `Searching the web: ${String(input.query ?? '')}`
      else if (b.name === 'WebFetch') step = `Reading ${shortUrl(input.url)}`
    }
  }
  return step === undefined ? {} : { step }
}

export interface LookupRun {
  stop(): void
  /** Resolves once, with Claude's final text on success, or the reason it stopped */
  done: Promise<LookupDone>
}

/** Starts one run; every step goes to onStep, and done resolves exactly once. */
export function runClaude(opts: {
  claudePath: string
  args: string[]
  prompt: string
  cwd: string
  timeoutMs: number
  onStep(text: string): void
}): LookupRun {
  const child = spawn(opts.claudePath, opts.args, {
    cwd: opts.cwd,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stderr = ''
  let finished = false
  let stopReason: string | null = null

  // The CLI starts helper processes of its own; take the whole tree down.
  const kill = (): void => {
    if (child.pid !== undefined && child.exitCode === null)
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  }
  const timer = setTimeout(() => {
    stopReason = `Stopped after ${Math.round(opts.timeoutMs / 60000)} minutes.`
    kill()
  }, opts.timeoutMs)

  const done = new Promise<LookupDone>((resolve) => {
    const finish = (result: LookupDone): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve(result)
    }
    createInterface({ input: child.stdout }).on('line', (l) => {
      const { step, done: result } = readLookupLine(l)
      if (step !== undefined && !finished) opts.onStep(step)
      if (result) finish(result)
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-2000)
    })
    child.on('error', (err) =>
      finish({ ok: false, text: `Could not start Claude: ${err.message}` })
    )
    child.on('close', (code) =>
      finish({
        ok: false,
        text: stopReason ?? (stderr.trim().split('\n').pop() || `Claude exited with code ${code}`)
      })
    )
  })

  child.stdin.end(opts.prompt)
  return {
    stop() {
      stopReason = 'Stopped.'
      kill()
    },
    done
  }
}
