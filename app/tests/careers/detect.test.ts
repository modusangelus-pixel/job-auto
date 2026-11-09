import { describe, expect, test } from 'vitest'
import { detectFromHtml, detectFromUrl, isJobBoardSite } from '../../src/main/careers/detect'

test.each([
  ['https://boards.greenhouse.io/waymo', 'greenhouse', 'waymo'],
  ['https://job-boards.greenhouse.io/scaleai/jobs/123', 'greenhouse', 'scaleai'],
  ['https://job-boards.eu.greenhouse.io/acme', 'greenhouse', 'eu:acme'],
  ['https://boards.eu.greenhouse.io/acme', 'greenhouse', 'eu:acme'],
  ['https://boards.eu.greenhouse.io/embed/job_board?for=nuro', 'greenhouse', 'eu:nuro'],
  ['https://boards.greenhouse.io/embed/job_board?for=nuro', 'greenhouse', 'nuro'],
  ['https://jobs.lever.co/zoox', 'lever', 'zoox'],
  ['https://jobs.eu.lever.co/acme/abc-123', 'lever', 'eu:acme'],
  ['https://jobs.ashbyhq.com/wayve', 'ashby', 'wayve'],
  ['https://jobs.smartrecruiters.com/Konecranes', 'smartrecruiters', 'Konecranes'],
  ['https://careers.smartrecruiters.com/SGS', 'smartrecruiters', 'SGS'],
  ['https://apply.workable.com/exotec/', 'workable', 'exotec'],
  ['https://kion.recruitee.com/o/some-job', 'recruitee', 'kion'],
  ['https://acme.jobs.personio.de/job/1', 'personio', 'acme'],
  ['https://acme.jobs.personio.com', 'personio', 'acme'],
  [
    'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite',
    'workday',
    'nvidia.wd5/NVIDIAExternalCareerSite'
  ],
  ['https://acme.wd3.myworkdayjobs.com/External/job/X', 'workday', 'acme.wd3/External'],
  [
    'https://wd3.myworkdaysite.com/recruiting/magna/Magna',
    'workday',
    'wd3.myworkdaysite.com/magna/Magna'
  ],
  [
    'https://wd3.myworkdaysite.com/en-US/recruiting/magna/Magna/job/X_R1',
    'workday',
    'wd3.myworkdaysite.com/magna/Magna'
  ],
  ['https://careers-rws.icims.com/jobs/search?ss=1&in_iframe=1', 'icims', 'careers-rws.icims.com'],
  [
    'https://Careers-HexagonPositioning.icims.com/',
    'icims',
    'careers-hexagonpositioning.icims.com'
  ],
  [
    'https://hdjq.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1',
    'oracle',
    'hdjq.fa.us2.oraclecloud.com/CX_1'
  ],
  [
    'https://hcog.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/job/123?x=1',
    'oracle',
    'hcog.fa.em2.oraclecloud.com/CX_2001'
  ],
  ['https://www.comeet.com/jobs/autobrains/57.004', 'comeet', 'autobrains/57.004'],
  ['https://vale.eightfold.ai/careers', 'eightfold', 'vale.eightfold.ai|vale.com'],
  [
    'https://jobsearch.harman.com/en_US/careers/SearchJobs',
    'avature',
    'jobsearch.harman.com/en_US/careers'
  ],
  [
    'https://jobs.siemens.com/en_US/externaljobs/SearchJobs/?folderRecordsPerPage=6&folderOffset=6',
    'avature',
    'jobs.siemens.com/en_US/externaljobs'
  ],
  [
    'https://acme.eightfold.ai/careers/job/123?domain=acme-group.com',
    'eightfold',
    'acme.eightfold.ai|acme-group.com'
  ],
  [
    'https://comeet.com/jobs/autobrains/57.004/planner-stack-engineer/DF.077',
    'comeet',
    'autobrains/57.004'
  ]
])('%s is %s %s', (url, system, board) => expect(detectFromUrl(url)).toEqual({ system, board }))

describe('detectFromUrl', () => {
  test('a plain careers page or a job board site is not a job system', () => {
    expect(detectFromUrl('https://www.acme.com/careers')).toBeNull()
    expect(detectFromUrl('https://www.linkedin.com/company/acme/jobs')).toBeNull()
    expect(detectFromUrl('not a url')).toBeNull()
  })

  test('hosts match in any case and over http, while the board keeps the path case', () => {
    expect(detectFromUrl('HTTP://Jobs.SmartRecruiters.com/Konecranes')).toEqual({
      system: 'smartrecruiters',
      board: 'Konecranes'
    })
    expect(detectFromUrl('https://ACME.WD3.MyWorkdayJobs.com/en-us/External')).toEqual({
      system: 'workday',
      board: 'acme.wd3/External'
    })
  })

  test('a known host with no board in the path is not a job system', () => {
    expect(detectFromUrl('https://jobs.lever.co/')).toBeNull()
    expect(detectFromUrl('https://boards.greenhouse.io/')).toBeNull()
    expect(detectFromUrl('https://boards.greenhouse.io/embed/job_board')).toBeNull()
    expect(detectFromUrl('https://apply.workable.com')).toBeNull()
    expect(detectFromUrl('https://acme.wd3.myworkdayjobs.com/')).toBeNull()
    expect(detectFromUrl('https://acme.wd3.myworkdayjobs.com/en-US')).toBeNull()
    expect(detectFromUrl('https://wd3.myworkdaysite.com/recruiting/magna')).toBeNull()
    expect(detectFromUrl('https://wd3.myworkdaysite.com/en-US/recruiting/')).toBeNull()
    expect(detectFromUrl('https://wd3.myworkdaysite.com/other/magna/Magna')).toBeNull()
    // iCIMS's own sites are not a company's board.
    expect(detectFromUrl('https://www.icims.com/platform_help')).toBeNull()
    expect(detectFromUrl('https://icims.com/')).toBeNull()
    // iCIMS's shared hosts (scripts, sign-in, help) are no company's board either.
    for (const host of [
      'static',
      'cdn',
      'assets',
      'api',
      'login',
      'developer',
      'community',
      'support'
    ])
      expect(detectFromUrl(`https://${host}.icims.com/x.js`)).toBeNull()
    expect(detectFromUrl('https://hdjq.fa.us2.oraclecloud.com/hcmUI/faces/Home')).toBeNull()
    expect(detectFromUrl('https://www.comeet.com/jobs/autobrains')).toBeNull()
    expect(detectFromUrl('https://www.comeet.com/resources/blog')).toBeNull()
    // Eightfold's own site and asset hosts, and a host with no careers path, are no board.
    expect(detectFromUrl('https://www.eightfold.ai/careers')).toBeNull()
    expect(detectFromUrl('https://static.eightfold.ai/gen/app.js')).toBeNull()
    expect(detectFromUrl('https://vale.eightfold.ai/')).toBeNull()
    // An Avature portal's home has no list in its address; its page links to SearchJobs.
    expect(detectFromUrl('https://jobs.siemens.com/en_US/externaljobs')).toBeNull()
    expect(detectFromUrl('https://example.com/careers/SearchJobs')).toBeNull()
  })

  test('a careers site on its own domain that runs Eightfold is read from that host', () => {
    expect(
      detectFromHtml(
        '<script src="https://static.vscdn.net/eightfold.ai/gen/main.js"></script>' +
          '<script>window._EF_GROUP = {domain: "acme.com", url: "/api/apply/v2/jobs"}</script>',
        'https://jobs.acme.com/careers?query=x'
      )
    ).toEqual({ system: 'eightfold', board: 'jobs.acme.com|acme.com' })
  })

  test('an Avature portal home is found from its SearchJobs links', () => {
    expect(
      detectFromHtml(
        '<a href="https://jobs.siemens.com/en_US/externaljobs/SearchJobs">Search jobs</a>',
        'https://jobs.siemens.com/en_US/externaljobs'
      )
    ).toEqual({ system: 'avature', board: 'jobs.siemens.com/en_US/externaljobs' })
  })

  test('a TalentBrew (Radancy) careers site is read from its own host, unless it links to a known system', () => {
    const marker =
      '<link rel="stylesheet" href="https://tbcdn.talentbrew.com/company/44408/css/site.css">'
    expect(detectFromHtml(marker, 'https://careers.synopsys.com/')).toEqual({
      system: 'radancy',
      board: 'careers.synopsys.com'
    })
    expect(
      detectFromHtml(
        marker + '<a href="https://acme.wd3.myworkdayjobs.com/External">Apply</a>',
        'https://careers.acme.com/'
      )
    ).toEqual({ system: 'workday', board: 'acme.wd3/External' })
  })

  test('a page linking to an Oracle candidate site is Oracle', () => {
    expect(
      detectFromHtml(
        '<a href="https://hdjq.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions">Jobs</a>',
        'https://www.emerson.com/careers'
      )
    ).toEqual({ system: 'oracle', board: 'hdjq.fa.us2.oraclecloud.com/CX_1' })
  })

  test('a page with an iCIMS board in an iframe is iCIMS', () => {
    expect(
      detectFromHtml(
        '<iframe src="https://careers-rws.icims.com/jobs/search?ss=1&amp;in_iframe=1"></iframe>' +
          '<a href="http://www.icims.com/platform_help">www.icims.com</a>',
        'https://www.rws.com/careers/'
      )
    ).toEqual({ system: 'icims', board: 'careers-rws.icims.com' })
  })

  test('EU boards get the eu: prefix, on Lever and on Greenhouse, so they are not mixed up with the US board of the same name', () => {
    expect(detectFromUrl('https://jobs.eu.lever.co/acme')).toEqual({
      system: 'lever',
      board: 'eu:acme'
    })
    expect(detectFromUrl('https://job-boards.eu.greenhouse.io/acme')).toEqual({
      system: 'greenhouse',
      board: 'eu:acme'
    })
    expect(detectFromUrl('https://boards.eu.greenhouse.io/acme/jobs/1')).toEqual({
      system: 'greenhouse',
      board: 'eu:acme'
    })
    // The US hosts stay plain.
    expect(detectFromUrl('https://job-boards.greenhouse.io/acme')).toEqual({
      system: 'greenhouse',
      board: 'acme'
    })
  })

  test('an EU Greenhouse host with no board in it is not a job system', () => {
    expect(detectFromUrl('https://boards.eu.greenhouse.io/')).toBeNull()
    expect(detectFromUrl('https://job-boards.eu.greenhouse.io/embed/job_board')).toBeNull()
  })

  test('a vendor marketing site is not a company board', () => {
    expect(detectFromUrl('https://www.recruitee.com/pricing')).toBeNull()
    expect(detectFromUrl('https://recruitee.com/')).toBeNull()
    expect(detectFromUrl('https://www.personio.de/')).toBeNull()
  })

  test('SuccessFactors: career<n> servers are never boards, and neither are its other hosts', () => {
    expect(detectFromUrl('https://career4.successfactors.com/career?company=Agco')).toBeNull()
    expect(detectFromUrl('https://career5.successfactors.eu/')).toBeNull()
    expect(detectFromUrl('https://career2.successfactors.com/career?company=')).toBeNull()
    expect(detectFromUrl('https://rmkcdn.successfactors.com/abc/main.css')).toBeNull()
    expect(
      detectFromUrl('https://performancemanager5.successfactors.com/login?company=Acme')
    ).toBeNull()
    expect(detectFromUrl('https://www.successfactors.com/en_us.html')).toBeNull()
  })

  test("SmartRecruiters' own pages are not company boards", () => {
    expect(detectFromUrl('https://jobs.smartrecruiters.com/my-applications')).toBeNull()
    expect(detectFromUrl('https://jobs.smartrecruiters.com/oneclick-ui/company/x')).toBeNull()
    expect(detectFromUrl('https://jobs.smartrecruiters.com/BoschGroup')).toEqual({
      system: 'smartrecruiters',
      board: 'BoschGroup'
    })
  })

  test('only http and https addresses count', () => {
    expect(detectFromUrl('ftp://jobs.lever.co/zoox')).toBeNull()
  })
})

describe('isJobBoardSite', () => {
  test('isJobBoardSite knows LinkedIn, Indeed, Glassdoor, StepStone, Monster and ZipRecruiter, subdomains included', () => {
    expect(isJobBoardSite('https://se.indeed.com/jobs?q=x')).toBe(true)
    expect(isJobBoardSite('https://www.glassdoor.co.uk/x')).toBe(true)
    expect(isJobBoardSite('https://www.acme.com/careers')).toBe(false)
  })

  test('covers every listed site, with country domains and subdomains', () => {
    for (const url of [
      'https://linkedin.com/jobs',
      'https://www.linkedin.com/company/acme/jobs',
      'https://uk.linkedin.com/jobs',
      'https://indeed.com/q-x',
      'https://indeed.co.uk/jobs',
      'https://www.indeed.com.au/jobs',
      'https://glassdoor.com/Job',
      'https://www.glassdoor.de/Job',
      'https://www.stepstone.de/jobs',
      'https://www.stepstone.com/jobs',
      'https://www.monster.com/jobs',
      'https://www.monster.co.uk/jobs',
      'https://ziprecruiter.com/jobs',
      'https://www.ziprecruiter.com/jobs'
    ]) {
      expect(isJobBoardSite(url), url).toBe(true)
    }
  })

  test('does not mistake a company site or look-alike host for a job board', () => {
    for (const url of [
      'https://notlinkedin.com/jobs',
      'https://linkedin.com.evil.example/jobs',
      'https://indeed.acme.com/careers',
      'https://www.acme.com/indeed.com',
      'https://www.ziprecruiter.org/jobs',
      'https://jobs.lever.co/zoox'
    ]) {
      expect(isJobBoardSite(url), url).toBe(false)
    }
  })

  test('an unparseable address is not a job board site', () => {
    expect(isJobBoardSite('not a url')).toBe(false)
    expect(isJobBoardSite('')).toBe(false)
  })

  test('detectFromUrl gives null for any job board site', () => {
    expect(detectFromUrl('https://se.indeed.com/jobs?q=x')).toBeNull()
    expect(detectFromUrl('https://www.glassdoor.co.uk/Job/lever.htm?for=zoox')).toBeNull()
    expect(detectFromUrl('https://www.stepstone.de/jobs/greenhouse')).toBeNull()
  })
})

describe('detectFromHtml', () => {
  test('finds the job system linked or embedded in a careers page', () => {
    expect(
      detectFromHtml('<a href="https://jobs.lever.co/zoox">Jobs</a>', 'https://zoox.com/careers')
    ).toEqual({
      system: 'lever',
      board: 'zoox'
    })
    expect(
      detectFromHtml(
        '<script src="https://boards.greenhouse.io/embed/job_board/js?for=nuro"></script>',
        'https://nuro.ai/careers'
      )
    ).toEqual({ system: 'greenhouse', board: 'nuro' })
    expect(
      detectFromHtml(
        '<iframe src="https://acme.wd3.myworkdayjobs.com/en-US/External"></iframe>',
        'https://acme.com/jobs'
      )
    ).toEqual({ system: 'workday', board: 'acme.wd3/External' })
  })

  test('a SuccessFactors career site on its own domain is recognised by its asset host', () =>
    expect(
      detectFromHtml(
        '<link href="https://rmkcdn.successfactors.com/abc/main.css">',
        'https://jobs.acme.com/search'
      )
    ).toEqual({ system: 'successfactors', board: 'jobs.acme.com' }))

  test('a page linking only to LinkedIn has no job system', () =>
    expect(
      detectFromHtml(
        '<a href="https://www.linkedin.com/company/acme/jobs">',
        'https://acme.com/careers'
      )
    ).toBeNull())

  test('with several systems linked, the first in the fixed order wins', () => {
    // order: greenhouse, lever, ashby, workable, recruitee, personio, workday, successfactors, smartrecruiters
    // (SmartRecruiters last: its robots.txt blocks reading, so any other system linked beside it wins;
    // SuccessFactors is found from the page's asset host, not from links, so it has no sample here)
    const samples: [string, string][] = [
      ['greenhouse', 'https://boards.greenhouse.io/g-board'],
      ['lever', 'https://jobs.lever.co/l-board'],
      ['ashby', 'https://jobs.ashbyhq.com/a-board'],
      ['workable', 'https://apply.workable.com/w-board'],
      ['recruitee', 'https://r-board.recruitee.com/'],
      ['personio', 'https://p-board.jobs.personio.de/'],
      ['workday', 'https://wd-board.wd3.myworkdayjobs.com/en-US/Site'],
      ['smartrecruiters', 'https://jobs.smartrecruiters.com/S-Board']
    ]
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        // The later system appears first in the page, so only the fixed order can make the earlier one win.
        const html = `<a href="${samples[j][1]}">x</a><a href="${samples[i][1]}">y</a>`
        const found = detectFromHtml(html, 'https://acme.com/careers')
        expect(found?.system, `${samples[i][0]} beats ${samples[j][0]}`).toBe(samples[i][0])
        expect(found).toEqual(detectFromUrl(samples[i][1]))
      }
    }
  })

  test('with two links to the same system, the first one in the page is used', () => {
    expect(
      detectFromHtml(
        '<a href="https://jobs.lever.co/first">a</a> <a href="https://jobs.lever.co/second">b</a>',
        'https://acme.com/careers'
      )
    ).toEqual({ system: 'lever', board: 'first' })
  })

  test('links that are not job systems are ignored while a real one is still found', () => {
    expect(
      detectFromHtml(
        '<a href="https://www.linkedin.com/company/acme/jobs">in</a> <a href="https://www.acme.com/about">about</a> <a href="https://jobs.lever.co/acme">jobs</a>',
        'https://acme.com/careers'
      )
    ).toEqual({ system: 'lever', board: 'acme' })
  })

  test('decodes &amp; in an address before reading its query', () => {
    expect(
      detectFromHtml(
        '<iframe src="https://boards.greenhouse.io/embed/job_board?b=https%3A%2F%2Facme.com&amp;for=acme"></iframe>',
        'https://acme.com/careers'
      )
    ).toEqual({ system: 'greenhouse', board: 'acme' })
  })

  test('reads addresses whose slashes are JSON-escaped, as in a script blob', () => {
    expect(
      detectFromHtml(
        '<script>{"url":"https:\\/\\/boards.greenhouse.io\\/acme"}</script>',
        'https://acme.com/careers'
      )
    ).toEqual({ system: 'greenhouse', board: 'acme' })
    expect(
      detectFromHtml(
        '<script>{"jobs":"https:\\/\\/jobs.lever.co\\/zoox\\/abc","x":"\\/\\/boards.eu.greenhouse.io\\/embed\\/job_board?for=nuro"}</script>',
        'https://zoox.com/careers'
      )
    ).toEqual({ system: 'greenhouse', board: 'eu:nuro' })
  })

  test('reads protocol-relative addresses as https', () => {
    expect(
      detectFromHtml(
        '<script src="//boards.greenhouse.io/embed/job_board/js?for=nuro"></script>',
        'https://nuro.ai/careers'
      )
    ).toEqual({ system: 'greenhouse', board: 'nuro' })
  })

  test('addresses in single quotes, CSS url() and plain text are found', () => {
    expect(
      detectFromHtml("<a href='https://jobs.ashbyhq.com/wayve'>x</a>", 'https://wayve.ai/careers')
    ).toEqual({
      system: 'ashby',
      board: 'wayve'
    })
    expect(
      detectFromHtml(
        '<div style="background:url(https://jobs.lever.co/zoox)"></div>',
        'https://zoox.com/careers'
      )
    ).toEqual({ system: 'lever', board: 'zoox' })
    expect(
      detectFromHtml('Apply at https://apply.workable.com/exotec today', 'https://exotec.com/jobs')
    ).toEqual({
      system: 'workable',
      board: 'exotec'
    })
  })

  test('a SuccessFactors career site is its own board, with a brand folder kept, even when the page links career<n> servers', () => {
    const html =
      '<link href="https://rmkcdn.successfactors.com/x.css"><a href="https://career5.successfactors.eu/login">x</a>'
    expect(detectFromHtml(html, 'https://jobs.scania.com/go/Jobs-at-Scania/9096601/')).toEqual({
      system: 'successfactors',
      board: 'jobs.scania.com'
    })
    expect(detectFromHtml(html, 'https://jobs.teradyne.com/MiR/search/')).toEqual({
      system: 'successfactors',
      board: 'jobs.teradyne.com/MiR'
    })
    expect(detectFromHtml(html, 'https://jobs.doosan.com/bobcat/content/Global-Page/')).toEqual({
      system: 'successfactors',
      board: 'jobs.doosan.com/bobcat'
    })
    expect(detectFromHtml(html, 'https://jobs.deere.com/search')).toEqual({
      system: 'successfactors',
      board: 'jobs.deere.com'
    })
    expect(detectFromHtml(html, 'https://jobs.acme.com/a/b')).toEqual({
      system: 'successfactors',
      board: 'jobs.acme.com/a/b'
    })
  })

  test('the SuccessFactors asset host beats any other system linked on the page', () => {
    const html =
      '<link href="https://rmkcdn.successfactors.com/abc/main.css"><a href="https://jobs.lever.co/acme">jobs</a>'
    expect(detectFromHtml(html, 'https://jobs.acme.com/search')).toEqual({
      system: 'successfactors',
      board: 'jobs.acme.com'
    })
  })

  test('the asset-host marker works in a protocol-relative address and any case', () => {
    expect(
      detectFromHtml(
        '<script src="//RMKCDN.successfactors.com/x.js"></script>',
        'https://Jobs.Acme.com/search'
      )
    ).toEqual({ system: 'successfactors', board: 'jobs.acme.com' })
  })

  test('the asset-host marker needs a page address to take the host from', () => {
    expect(
      detectFromHtml('<link href="https://rmkcdn.successfactors.com/abc/main.css">', 'not a url')
    ).toBeNull()
  })

  test('a page with no addresses, or none that matter, has no job system', () => {
    expect(detectFromHtml('', 'https://acme.com/careers')).toBeNull()
    expect(detectFromHtml('<p>Join us!</p>', 'https://acme.com/careers')).toBeNull()
    expect(
      detectFromHtml('<a href="https://www.acme.com/jobs/1">x</a>', 'https://acme.com/careers')
    ).toBeNull()
  })
})
