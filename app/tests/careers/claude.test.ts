import { describe, expect, test } from 'vitest'
import {
  findClaude,
  LOOKUP_RULES,
  lookupArgs,
  lookupPrompt,
  parseLookupResult,
  readLookupLine
} from '../../src/main/careers/claude'

const line = (o: unknown): string => JSON.stringify(o)
const toolUse = (...blocks: { name: string; input: unknown }[]): string =>
  line({ type: 'assistant', message: { content: blocks.map((b) => ({ type: 'tool_use', ...b })) } })

describe('findClaude', () => {
  test('PATH first, then the native and npm install locations; null when none exists', () => {
    const env = {
      PATH: 'C:\\tools;C:\\bin',
      USERPROFILE: 'C:\\Users\\me',
      APPDATA: 'C:\\Users\\me\\AppData\\Roaming'
    }
    expect(findClaude(env, (p) => p === 'C:\\bin\\claude.exe')).toBe('C:\\bin\\claude.exe')
    expect(findClaude(env, (p) => p.endsWith('.local\\bin\\claude.exe'))).toBe(
      'C:\\Users\\me\\.local\\bin\\claude.exe'
    )
    expect(findClaude(env, (p) => p.includes('npm'))).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
    )
    expect(findClaude(env, () => false)).toBeNull()
  })
})

describe('lookupArgs', () => {
  test("headless on the owner's login with only web search and page reading", () => {
    const a = lookupArgs()
    const v = (f: string): string => a[a.indexOf(f) + 1]
    expect(a).toContain('-p')
    expect(v('--output-format')).toBe('stream-json')
    expect(a).toContain('--verbose')
    expect(a).toContain('--no-session-persistence')
    expect(a).not.toContain('--bare')
    expect(v('--setting-sources')).toBe('')
    expect(a).toContain('--strict-mcp-config')
    expect(a).not.toContain('--mcp-config')
    expect(v('--tools')).toBe('WebSearch,WebFetch')
    expect(v('--allowedTools')).toBe('WebSearch,WebFetch')
    expect(v('--permission-mode')).toBe('dontAsk')
    expect(v('--append-system-prompt')).toBe(LOOKUP_RULES)
  })

  test('runs on Sonnet whatever the account would pick by default', () => {
    const a = lookupArgs()
    expect(a[a.indexOf('--model') + 1]).toBe('sonnet')
  })
})

describe('lookupPrompt', () => {
  test('the prompt lists each company with its id, headquarters and focus', () =>
    expect(
      lookupPrompt([{ id: 7, name: 'Waymo', hq: 'USA', focus: 'Autonomous driving' }])
    ).toContain('id 7: Waymo (headquarters: USA; Autonomous driving)'))

  test('starts with the request line, then one line per company; an empty headquarters or focus is left out', () => {
    const text = lookupPrompt([
      { id: 7, name: 'Waymo', hq: 'USA', focus: '' },
      { id: 8, name: 'Zoox', hq: '', focus: 'Robotaxis' },
      { id: 9, name: 'Nuro', hq: '', focus: '' }
    ])
    expect(text.split('\n')).toEqual([
      'Find the careers pages of these companies:',
      'id 7: Waymo (headquarters: USA)',
      'id 8: Zoox (Robotaxis)',
      'id 9: Nuro'
    ])
  })
})

describe('parseLookupResult', () => {
  test('reads the JSON array even inside prose or a code fence', () => {
    const text =
      'Here you go:\n```json\n[{"id":7,"careersUrl":"https://waymo.com/careers","jobsUrl":"https://boards.greenhouse.io/waymo","note":""}]\n```'
    expect(parseLookupResult(text, [7])).toEqual([
      {
        id: 7,
        careersUrl: 'https://waymo.com/careers',
        jobsUrl: 'https://boards.greenhouse.io/waymo',
        note: ''
      }
    ])
  })

  test('reads the array when a source list or other bracketed text comes before or after it', () => {
    const text =
      'Checked [2 companies]:\n```json\n[\n  {"id": 1, "careersUrl": "https://a.test/careers", "jobsUrl": null, "note": "see [jobs] page"},\n  {"id": 2, "careersUrl": null, "jobsUrl": null, "note": ""}\n]\n```\n\nSources: [A careers](https://a.test/careers), [A jobs](https://a.test/jobs)'
    expect(parseLookupResult(text, [1, 2])).toEqual([
      { id: 1, careersUrl: 'https://a.test/careers', jobsUrl: null, note: 'see [jobs] page' },
      { id: 2, careersUrl: null, jobsUrl: null, note: '' }
    ])
  })

  test('drops ids it did not ask for and items without a numeric id, keeps the first of a repeated id, and reads a missing note as empty', () => {
    const text = JSON.stringify([
      { id: 1, careersUrl: 'https://a.test/careers', jobsUrl: null, note: ' first ' },
      { id: 99, careersUrl: 'https://z.test/careers', jobsUrl: null, note: 'not asked for' },
      { id: '2', careersUrl: 'https://b.test/careers', jobsUrl: null, note: 'id is a string' },
      { careersUrl: 'https://c.test/careers', jobsUrl: null, note: 'no id' },
      'not an object',
      null,
      { id: 1, careersUrl: 'https://a.test/other', jobsUrl: null, note: 'repeat' },
      { id: 3, careersUrl: 'https://d.test/careers', jobsUrl: 'https://d.test/jobs' }
    ])
    expect(parseLookupResult(text, [1, 2, 3])).toEqual([
      { id: 1, careersUrl: 'https://a.test/careers', jobsUrl: null, note: 'first' },
      { id: 3, careersUrl: 'https://d.test/careers', jobsUrl: 'https://d.test/jobs', note: '' }
    ])
  })

  test('job board links, non-web links, "null" and empty strings become null', () => {
    const text =
      '[{"id":1,"careersUrl":"https://www.linkedin.com/company/x/jobs","jobsUrl":"null","note":"gone"}]'
    expect(parseLookupResult(text, [1])).toEqual([
      { id: 1, careersUrl: null, jobsUrl: null, note: 'gone' }
    ])
  })

  test('missing, non-string, blank and non-http links become null; a link with spaces around it is trimmed', () => {
    const text = JSON.stringify([
      { id: 1, careersUrl: '', jobsUrl: '   ', note: '' },
      { id: 2, careersUrl: 'ftp://x.test/jobs', jobsUrl: 'mailto:hr@x.test', note: '' },
      { id: 3, careersUrl: 42, jobsUrl: ['https://x.test'], note: 5 },
      { id: 4 },
      {
        id: 5,
        careersUrl: '  https://x.test/careers  ',
        jobsUrl: 'https://uk.indeed.com/cmp/x/jobs',
        note: ''
      },
      { id: 6, careersUrl: ' null ', jobsUrl: 'www.x.test/jobs', note: '' }
    ])
    expect(parseLookupResult(text, [1, 2, 3, 4, 5, 6])).toEqual([
      { id: 1, careersUrl: null, jobsUrl: null, note: '' },
      { id: 2, careersUrl: null, jobsUrl: null, note: '' },
      { id: 3, careersUrl: null, jobsUrl: null, note: '' },
      { id: 4, careersUrl: null, jobsUrl: null, note: '' },
      { id: 5, careersUrl: 'https://x.test/careers', jobsUrl: null, note: '' },
      { id: 6, careersUrl: null, jobsUrl: null, note: '' }
    ])
  })

  test('text that is not JSON gives no answers', () => {
    expect(parseLookupResult('Sorry, I could not do that.', [1])).toEqual([])
    expect(parseLookupResult('[{"id":1,', [1])).toEqual([])
    expect(parseLookupResult('{"id":1}', [1])).toEqual([])
    expect(parseLookupResult('', [1])).toEqual([])
  })
})

describe('readLookupLine', () => {
  test('stream lines become steps and a final result', () => {
    expect(
      readLookupLine(toolUse({ name: 'WebSearch', input: { query: 'Waymo careers' } }))
    ).toEqual({ step: 'Searching the web: Waymo careers' })
    expect(
      readLookupLine(toolUse({ name: 'WebFetch', input: { url: 'https://waymo.com/careers/' } }))
    ).toEqual({ step: 'Reading waymo.com/careers/' })
    expect(
      readLookupLine(line({ type: 'result', subtype: 'success', is_error: false, result: '[]' }))
    ).toEqual({ done: { ok: true, text: '[]' } })
    expect(
      readLookupLine(
        line({ type: 'result', subtype: 'error_max_turns', is_error: true, result: '' })
      ).done!.ok
    ).toBe(false)
    expect(readLookupLine('not json')).toEqual({})
  })

  test('with several tool calls in one line the last one is the step; unknown tools give nothing', () => {
    expect(
      readLookupLine(
        toolUse(
          { name: 'WebSearch', input: { query: 'a' } },
          { name: 'WebFetch', input: { url: 'https://b.test/jobs' } }
        )
      )
    ).toEqual({ step: 'Reading b.test/jobs' })
    expect(readLookupLine(toolUse({ name: 'Bash', input: { command: 'ls' } }))).toEqual({})
    expect(readLookupLine(line({ type: 'system', subtype: 'init' }))).toEqual({})
  })

  test('long addresses are cut to 80 characters and an unreadable one is shown as it is', () => {
    const long = `https://example.test/${'a'.repeat(100)}`
    expect(readLookupLine(toolUse({ name: 'WebFetch', input: { url: long } })).step).toBe(
      `Reading ${`example.test/${'a'.repeat(100)}`.slice(0, 80)}`
    )
    expect(readLookupLine(toolUse({ name: 'WebFetch', input: { url: 'not a url' } }))).toEqual({
      step: 'Reading not a url'
    })
  })

  test('a result that is not a success, or an empty one, says why Claude stopped', () => {
    expect(
      readLookupLine(
        line({ type: 'result', subtype: 'success', is_error: true, result: 'Rate limited' })
      )
    ).toEqual({
      done: { ok: false, text: 'Rate limited' }
    })
    expect(
      readLookupLine(line({ type: 'result', subtype: 'error_max_turns', is_error: true }))
    ).toEqual({
      done: { ok: false, text: 'Claude stopped: error_max_turns' }
    })
    expect(readLookupLine(line({ type: 'result', is_error: true }))).toEqual({
      done: { ok: false, text: 'Claude stopped: unknown reason' }
    })
    expect(readLookupLine(line({ type: 'result', subtype: 'success', result: '  [ ]  ' }))).toEqual(
      { done: { ok: true, text: '[ ]' } }
    )
  })
})
