// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { pageCaptureScript } from '../../src/main/pages/types'

/** Runs the capture script in this jsdom page, as the hidden window runs it in the careers page. */
const run = (): { text: string; links: { href: string; text: string }[] } =>
  new Function(`return ${pageCaptureScript}`)() as {
    text: string
    links: { href: string; text: string }[]
  }

describe('pageCaptureScript', () => {
  test("returns the page's visible text and its links as absolute addresses", () => {
    document.body.innerHTML = `
      <h1>Open positions</h1>
      <a href="/jobs/42">Systems Engineer  -  Göteborg</a>
      <a href="https://other.test/x">Elsewhere</a>
      <a href="mailto:hr@acme.test">Mail us</a>
      <a>No address</a>`
    const r = run()
    expect(r.text).toContain('Open positions')
    expect(r.links).toEqual([
      { href: new URL('/jobs/42', document.baseURI).href, text: 'Systems Engineer - Göteborg' },
      { href: 'https://other.test/x', text: 'Elsewhere' }
    ])
  })

  test('caps the text at 60,000 characters, the links at 400 and each link text at 120', () => {
    const long = 'x'.repeat(200)
    document.body.innerHTML =
      `<p>${'word '.repeat(20_000)}</p>` +
      Array.from({ length: 450 }, (_, i) => `<a href="/j/${i}">${long}</a>`).join('')
    const r = run()
    expect(r.text.length).toBe(60_000)
    expect(r.links).toHaveLength(400)
    expect(r.links[0].text).toHaveLength(120)
  })
})
