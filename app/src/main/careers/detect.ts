import type { JobBoard, JobSystem } from '../../shared/types'

// When a careers page points at several systems, the one earliest in this list wins. SmartRecruiters comes last:
// its robots.txt forbids reading, so any other system linked beside it is the better choice.
const SYSTEM_ORDER: JobSystem[] = [
  'greenhouse',
  'lever',
  'ashby',
  'workable',
  'recruitee',
  'personio',
  'workday',
  'successfactors',
  'icims',
  'oracle',
  'comeet',
  'eightfold',
  'avature',
  'radancy',
  'smartrecruiters'
]

// Job aggregators: never a company's own careers page. indeed.<tld>, so indeed.co.uk and indeed.com.au count too.
const JOB_BOARD_HOST =
  /(^|\.)(linkedin\.com|ziprecruiter\.com|(indeed|glassdoor|stepstone|monster)\.[a-z]{2,3}(\.[a-z]{2})?)$/

// Workday puts a locale such as en-US before the site name.
const WORKDAY_LOCALE = /^[a-z]{2}-[a-z]{2}$/i

// Where SuccessFactors serves the stylesheets and scripts of career sites hosted on a company's own domain.
const SUCCESSFACTORS_ASSET_HOST = /rmkcdn\.successfactors\.com/i

// SmartRecruiters' own pages that sit where a company's board name would be.
const SMARTRECRUITERS_RESERVED = new Set(['my-applications', 'oneclick-ui'])

// Where Radancy's TalentBrew serves the stylesheets and scripts of the career sites it hosts.
const TALENTBREW_ASSET_HOST = /tbcdn\.talentbrew\.com/i

// Avature puts a locale such as en_US before the portal name.
const AVATURE_LOCALE = /^[a-z]{2}_[a-z]{2}$/i

// iCIMS's own shared hosts (its site, scripts, sign-in, help), which are no company's board.
const ICIMS_RESERVED = new Set([
  'www',
  'static',
  'cdn',
  'assets',
  'api',
  'login',
  'developer',
  'community',
  'support'
])

// Eightfold's own hosts, which are not a company's careers site.
const EIGHTFOLD_RESERVED = new Set(['www', 'app', 'static'])

// An Eightfold careers site on a company's own domain: its scripts name eightfold.ai, call /api/apply and give the
// company's domain as domain: "acme.com".
const EIGHTFOLD_DOMAIN = /\bdomain["']?\s*:\s*["']([a-z0-9-]+(?:\.[a-z0-9-]+)+)["']/i

// A SuccessFactors page path up to the first of these is the company's brand folder (jobs.teradyne.com/MiR/search/).
const SUCCESSFACTORS_PATH_MARKERS = new Set(['search', 'go', 'job', 'viewalljobs', 'content'])

// https://host/... or protocol-relative //host/... ; stops at a quote, angle bracket, space or closing parenthesis.
const ADDRESS = /(?:https?:\/\/|(?<![\w:/.%-])\/\/)[^\s"'<>`\\)]+/gi

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function found(system: JobSystem, board: string | null | undefined): JobBoard | null {
  return board ? { system, board } : null
}

export function isJobBoardSite(url: string): boolean {
  const parsed = parse(url)
  return parsed !== null && JOB_BOARD_HOST.test(parsed.hostname)
}

export function detectFromUrl(url: string): JobBoard | null {
  const u = parse(url)
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) return null
  const host = u.hostname
  if (JOB_BOARD_HOST.test(host)) return null
  const segments = u.pathname.split('/').filter(Boolean)
  const first = segments[0]

  // EU boards (boards.eu.greenhouse.io) are a separate set from the US ones, so the region stays in the board, as
  // with Lever's below.
  const greenhouse = /^(job-)?boards(\.eu)?\.greenhouse\.io$/.exec(host)
  if (greenhouse) {
    const board = first === 'embed' ? u.searchParams.get('for') : first
    return found('greenhouse', board ? `${greenhouse[2] ? 'eu:' : ''}${board}` : null)
  }
  if (host === 'jobs.lever.co') return found('lever', first)
  // Lever's EU boards live on a separate feed host, so the region stays in the board.
  if (host === 'jobs.eu.lever.co') return found('lever', first && `eu:${first}`)
  if (host === 'jobs.ashbyhq.com') return found('ashby', first)
  if (/^(jobs|careers)\.smartrecruiters\.com$/.test(host))
    return SMARTRECRUITERS_RESERVED.has(first?.toLowerCase() ?? '')
      ? null
      : found('smartrecruiters', first)
  if (host === 'apply.workable.com') return found('workable', first)

  const recruitee = /^([a-z0-9-]+)\.recruitee\.com$/.exec(host)
  if (recruitee) return found('recruitee', recruitee[1] === 'www' ? null : recruitee[1])

  const personio = /^([a-z0-9-]+)\.jobs\.personio\.(?:de|com)$/.exec(host)
  if (personio) return found('personio', personio[1])

  const workday = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/.exec(host)
  if (workday) {
    const site = WORKDAY_LOCALE.test(first ?? '') ? segments[1] : first
    return found('workday', site && `${workday[1]}.${workday[2]}/${site}`)
  }

  // iCIMS boards are hosts of their own; icims.com and its shared hosts are iCIMS's own.
  const icims = /^([a-z0-9-]+)\.icims\.com$/.exec(host)
  if (icims) return ICIMS_RESERVED.has(icims[1]) ? null : found('icims', host)

  // Oracle Recruiting Cloud: host.oraclecloud.com/hcmUI/CandidateExperience/<locale>/sites/<site number>.
  if (/\.oraclecloud\.com$/.test(host)) {
    const at = segments.indexOf('sites')
    return found('oracle', at >= 0 && segments[at + 1] ? `${host}/${segments[at + 1]}` : null)
  }

  // Comeet: www.comeet.com/jobs/<company slug>/<company uid>[/<position slug>/<position uid>].
  if (host === 'www.comeet.com' || host === 'comeet.com') {
    const [jobs, slug, uid] = segments
    return jobs === 'jobs' && slug && uid ? found('comeet', `${slug}/${uid}`) : null
  }

  // Eightfold: <company>.eightfold.ai/careers[...][?domain=<domain>]. The feed needs the company's domain; when
  // the address doesn't give it, it is the host's first label + .com (vale.eightfold.ai → vale.com).
  const eightfold = /^([a-z0-9-]+)\.eightfold\.ai$/.exec(host)
  if (eightfold) {
    if (first !== 'careers' || EIGHTFOLD_RESERVED.has(eightfold[1])) return null
    return found('eightfold', `${host}|${u.searchParams.get('domain') ?? `${eightfold[1]}.com`}`)
  }

  // Workday's other address form: wdN.myworkdaysite.com/[locale/]recruiting/tenant/Site.
  if (/^wd\d+\.myworkdaysite\.com$/.test(host)) {
    const rest = WORKDAY_LOCALE.test(first ?? '') ? segments.slice(1) : segments
    const [recruiting, tenant, site] = rest
    return recruiting === 'recruiting' && tenant && site
      ? found('workday', `${host}/${tenant}/${site}`)
      : null
  }

  // Avature: host/<locale>/<portal>/SearchJobs, as jobs.siemens.com/en_US/externaljobs/SearchJobs.
  if (AVATURE_LOCALE.test(first ?? '') && segments[1] && segments[2] === 'SearchJobs')
    return found('avature', `${host}/${first}/${segments[1]}`)

  // career<n>.successfactors.* is a shared server, not one company's board: its job feed needs a company id the
  // page doesn't give. A SuccessFactors board is found from the page's asset host instead (see detectFromHtml).
  return null
}

export function detectFromHtml(html: string, pageUrl: string): JobBoard | null {
  // Embed addresses often sit in attributes as ?for=nuro&amp;b=..., and in script data as https:\/\/host\/path.
  const text = html.replace(/&amp;/gi, '&').replace(/\\\//g, '/')
  // A career site on a company's own domain loads SuccessFactors' asset host. It is that site's board, and beats
  // any link on the page (career<n> servers, login links and the like).
  if (SUCCESSFACTORS_ASSET_HOST.test(text)) {
    const page = parse(pageUrl)
    if (!page) return null
    const folder: string[] = []
    for (const segment of page.pathname.split('/').filter(Boolean)) {
      if (SUCCESSFACTORS_PATH_MARKERS.has(segment.toLowerCase())) break
      folder.push(segment)
    }
    return found('successfactors', [page.hostname, ...folder].join('/'))
  }

  let best: JobBoard | null = null
  for (const [address] of text.matchAll(ADDRESS)) {
    const hit = detectFromUrl(address.startsWith('//') ? `https:${address}` : address)
    if (hit && (!best || SYSTEM_ORDER.indexOf(hit.system) < SYSTEM_ORDER.indexOf(best.system)))
      best = hit
  }
  if (best) return best

  // A Radancy (TalentBrew) careers site, read from its own host's site map.
  if (TALENTBREW_ASSET_HOST.test(text)) {
    const page = parse(pageUrl)
    return page ? found('radancy', page.hostname) : null
  }

  const eightfoldDomain = EIGHTFOLD_DOMAIN.exec(text)
  if (eightfoldDomain && /eightfold\.ai/i.test(text) && text.includes('/api/apply')) {
    const page = parse(pageUrl)
    return page ? found('eightfold', `${page.hostname}|${eightfoldDomain[1]}`) : null
  }
  return null
}
