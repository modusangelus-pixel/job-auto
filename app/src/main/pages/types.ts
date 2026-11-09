/** A link on a captured page: its absolute address and its text. */
export interface PageLink {
  href: string
  text: string
}

/** What a careers page showed once its scripts had run. */
export interface CapturedPage {
  /** The address the page ended on, after any redirects. */
  finalUrl: string
  text: string
  links: PageLink[]
}

export interface PageCapture {
  /** The page as shown; null when robots.txt forbids reading it. Fails when it can't be loaded. */
  capture(url: string): Promise<CapturedPage | null>
}

export const MAX_PAGE_TEXT = 60_000
export const MAX_PAGE_LINKS = 400
export const MAX_LINK_TEXT = 120

/**
 * The JavaScript the hidden window runs in the loaded page: one expression giving `{ text, links }`, the page's
 * visible text (capped) and its http(s) links with their text (absolute, capped). Pages in tests have no innerText,
 * so textContent stands in.
 */
export const pageCaptureScript = String.raw`(() => {
  const textOf = (el) => (el.innerText ?? el.textContent ?? '');
  const body = document.body;
  const text = (body ? textOf(body) : '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, ${MAX_PAGE_TEXT});
  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    if (links.length >= ${MAX_PAGE_LINKS}) break;
    const href = a.href;
    if (!/^https?:/i.test(href)) continue;
    links.push({ href, text: textOf(a).replace(/\s+/g, ' ').trim().slice(0, ${MAX_LINK_TEXT}) });
  }
  return { text, links };
})()`
