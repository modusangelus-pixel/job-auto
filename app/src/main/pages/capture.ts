import { BrowserWindow, session, type Session } from 'electron'
import { BlockedError, USER_AGENT, type Fetcher } from '../readers/fetcher'
import { pageCaptureScript, type CapturedPage, type PageCapture, type PageLink } from './types'

/** The hidden window's own cookie jar and cache, apart from the app window's. */
const PARTITION = 'jobauto-pages'
/** After the page has loaded, its scripts get this long to build the job list. */
const SETTLE_MS = 6_000
/** A page that hasn't finished loading by then is given up. */
const LOAD_CAP_MS = 45_000
/** Reading the text and links out of the page. */
const READ_CAP_MS = 10_000
/** Words of a bot check, on a page that shows little else. The app never tries to get past one. */
const CHALLENGE_TEXT = /verify you are human|checking your browser|are you a robot|access denied/i
const CHALLENGE_MAX_TEXT = 2_000

let pagesSession: Session | null = null

/** The partition's session, set up once: the app's User-Agent, no permissions, no downloads. */
function sessionForPages(): Session {
  if (pagesSession) return pagesSession
  const ses = session.fromPartition(PARTITION)
  ses.setUserAgent(USER_AGENT)
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())
  pagesSession = ses
  return ses
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

const within = <T>(ms: number, what: string, p: Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })

function asCapture(value: unknown, finalUrl: string): CapturedPage {
  const v = (typeof value === 'object' && value !== null ? value : {}) as {
    text?: unknown
    links?: unknown
  }
  const links: PageLink[] = Array.isArray(v.links)
    ? v.links.filter(
        (l): l is PageLink =>
          typeof l === 'object' &&
          l !== null &&
          typeof (l as PageLink).href === 'string' &&
          typeof (l as PageLink).text === 'string'
      )
    : []
  return { finalUrl, text: typeof v.text === 'string' ? v.text : '', links }
}

/** Loads one page in a new hidden window and reads it; the window is always destroyed. */
async function load(url: string): Promise<CapturedPage> {
  sessionForPages()
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      javascript: true,
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // A hidden window's timers would otherwise be slowed, and the job list might never be built.
      backgroundThrottling: false
    }
  })
  const contents = win.webContents
  try {
    contents.setUserAgent(USER_AGENT)
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    let status = 0
    contents.on('did-navigate', (_event, _url, code) => {
      status = code
    })
    let loaded = false
    // Once the page is in, it may not take the window to another site.
    contents.on('will-navigate', (event, to) => {
      if (loaded && hostOf(to) !== hostOf(contents.getURL())) event.preventDefault()
    })
    await new Promise<void>((resolve, reject) => {
      const cap = setTimeout(
        () => reject(new Error(`the page did not load within ${LOAD_CAP_MS / 1000} s`)),
        LOAD_CAP_MS
      )
      contents.once('did-finish-load', () => {
        clearTimeout(cap)
        resolve()
      })
      contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
        // -3 is a load the page itself replaced (a redirect by script); the next load still finishes.
        if (!isMainFrame || code === -3) return
        clearTimeout(cap)
        reject(new Error(`the page could not be loaded (${description})`))
      })
      // A failure arrives as did-fail-load.
      contents.loadURL(url).catch(() => {})
    })
    loaded = true
    if (status >= 400) throw new Error(`HTTP ${status} from ${contents.getURL() || url}`)
    await new Promise((r) => setTimeout(r, SETTLE_MS))
    const finalUrl = contents.getURL() || url
    const page = asCapture(
      await within(READ_CAP_MS, 'Reading the page', contents.executeJavaScript(pageCaptureScript)),
      finalUrl
    )
    if (page.text.length < CHALLENGE_MAX_TEXT && CHALLENGE_TEXT.test(page.text)) {
      throw new BlockedError(hostOf(finalUrl) ?? url, 'the page shows a bot check')
    }
    return page
  } finally {
    win.destroy()
  }
}

/**
 * Reads careers pages that build their job list with scripts, in a hidden window. robots.txt and the host's pace
 * come from the fetcher; the window presents the app's own User-Agent, never logs in, submits nothing, downloads
 * nothing and opens no other window. One page loads at a time.
 */
export function createPageCapture(fetcher: Fetcher): PageCapture {
  let queue: Promise<unknown> = Promise.resolve()
  return {
    capture(url) {
      const run = queue.then(async () => ((await fetcher.permits(url)) ? load(url) : null))
      queue = run.catch(() => {})
      return run
    }
  }
}
