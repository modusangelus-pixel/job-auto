import { describe, expect, test } from 'vitest'
import { PAGE_RULES, pageArgs } from '../../src/main/careers/claude'
import { pageBoard, pagePrompt, pageUrlOf, parsePageJobs } from '../../src/main/pages/claudeJobs'

const PAGE = 'https://acme.test/careers/open-roles?team=all'

describe('pageArgs', () => {
  test('a Sonnet run with no tools at all, none of the owner settings, and the page rules', () => {
    const args = pageArgs()
    expect(args.slice(0, 2)).toEqual(['-p', '--output-format'])
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet')
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args).not.toContain('--allowedTools')
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('')
    expect(args).toContain('--strict-mcp-config')
    expect(args.at(-2)).toBe('--append-system-prompt')
    expect(args.at(-1)).toBe(PAGE_RULES)
    expect(PAGE_RULES).toContain('never invent jobs')
  })
})

describe('pagePrompt', () => {
  test('the company, the address, the text, then each link as text — address', () => {
    expect(
      pagePrompt(
        { name: 'Acme' },
        {
          finalUrl: PAGE,
          text: 'Open roles\nEngineer',
          links: [
            { href: 'https://acme.test/jobs/1', text: 'Engineer' },
            { href: 'https://acme.test/about', text: '' }
          ]
        }
      )
    ).toBe(
      [
        'Company: Acme',
        `Page: ${PAGE}`,
        '',
        'Text:',
        'Open roles\nEngineer',
        '',
        'Links:',
        'Engineer — https://acme.test/jobs/1',
        ' — https://acme.test/about'
      ].join('\n')
    )
  })
})

describe('parsePageJobs', () => {
  test('reads the JSON array out of prose, with absolute and relative links', () => {
    const text =
      'Here are the jobs:\n```json\n[' +
      '{"title": "Systems Engineer", "location": "Göteborg, Sweden", "url": "/jobs/42"},' +
      '{"title": "Summer Intern", "location": "Oslo, Norway", "url": "https://jobs.acme.test/7"}' +
      ']\n```\nThat is all.'
    expect(parsePageJobs(text, PAGE)).toEqual([
      {
        sourceId: 'https://acme.test/jobs/42',
        title: 'Systems Engineer',
        location: 'Göteborg, Sweden',
        countries: ['SE'],
        employment: 'unknown',
        url: 'https://acme.test/jobs/42',
        postedAt: null,
        postedRough: false,
        needsDetails: false
      },
      expect.objectContaining({
        sourceId: 'https://jobs.acme.test/7',
        url: 'https://jobs.acme.test/7',
        countries: ['NO'],
        employment: 'intern'
      })
    ])
  })

  test('a job without its own link is known by its folded title and location, and links to the page', () => {
    const [job] = parsePageJobs(
      '[{"title": "Lead Ingeniør", "location": "Køge", "url": null}]',
      PAGE
    )!
    expect(job.sourceId).toBe('t:lead ingenior|koge')
    expect(job.url).toBe(PAGE)
  })

  test('rows without a title are dropped, a link that is not http(s) counts as none, and repeats merge', () => {
    const jobs = parsePageJobs(
      JSON.stringify([
        { title: '', location: 'Oslo', url: '/a' },
        { location: 'Oslo' },
        { title: 'Engineer', location: 'Oslo', url: 'mailto:hr@acme.test' },
        { title: 'Engineer', location: 'Oslo', url: null },
        { title: 'Welder', location: 'Oslo', url: '/w' },
        { title: 'Welder (again)', location: 'Oslo', url: '/w' }
      ]),
      PAGE
    )!
    expect(jobs.map((j) => [j.sourceId, j.title])).toEqual([
      ['t:engineer|oslo', 'Engineer'],
      ['https://acme.test/w', 'Welder']
    ])
  })

  test('an empty array is no jobs; text with no JSON array is no answer', () => {
    expect(parsePageJobs('[]', PAGE)).toEqual([])
    expect(parsePageJobs('Sorry, I could not read the page.', PAGE)).toBeNull()
    expect(parsePageJobs('[{"title": "Engineer",', PAGE)).toBeNull()
  })
})

describe('pageBoard and pageUrlOf', () => {
  test("a page's board is its host and path: a query or fragment doesn't make it a new board", () => {
    expect(pageBoard('https://Acme.test/careers/?utm_source=x#jobs')).toBe(
      'page:acme.test/careers/'
    )
    expect(pageBoard(PAGE)).toBe('page:acme.test/careers/open-roles')
  })

  test('the jobs link, else the careers link, never a job board site', () => {
    expect(pageUrlOf({ jobsUrl: 'https://a.test/jobs', careersUrl: 'https://a.test/c' })).toBe(
      'https://a.test/jobs'
    )
    expect(
      pageUrlOf({
        jobsUrl: 'https://www.linkedin.com/company/a/jobs',
        careersUrl: 'https://a.test/c'
      })
    ).toBe('https://a.test/c')
    expect(
      pageUrlOf({ jobsUrl: null, careersUrl: 'https://www.linkedin.com/company/a/jobs' })
    ).toBeNull()
    expect(pageUrlOf({ jobsUrl: '', careersUrl: null })).toBeNull()
  })
})
