import type { Employment, RawJob } from '../../../shared/types'
import { countriesIn } from '../location'
import { getText } from './http'
import type { Reader } from './types'
import { decode, isoDate } from './util'

/** The text of the first <tag> in xml, CDATA unwrapped and entities decoded; '' when absent. */
function field(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)
  if (!m) return ''
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1])
  return (cdata ? cdata[1] : decode(m[1])).trim()
}

function employmentOf(type: string, schedule: string): Employment {
  if (type === 'intern' || type === 'working_student') return 'intern'
  if (schedule === 'part-time') return 'part_time'
  if (type === 'temporary' || type === 'freelance') return 'fixed_term'
  if (type === 'permanent' || type === 'trainee') return 'full_time'
  return 'unknown'
}

export const personio: Reader = {
  async list(fetcher, board) {
    const url = `https://${board}.jobs.personio.de/xml`
    const xml = await getText(fetcher, url)
    const positions = xml.match(/<position>[\s\S]*?<\/position>/g)
    if (!positions) {
      // An empty feed still has its root element; anything else is not a Personio feed.
      if (/<workzag-jobs\s*\/>|<workzag-jobs[^>]*>\s*<\/workzag-jobs>/.test(xml)) {
        return { jobs: [], complete: true, note: null }
      }
      throw new Error(`Job list not recognised on ${url}`)
    }
    const jobs: RawJob[] = positions.map((p) => {
      // Descriptions hold their own <name> elements, so they are cut out before the fields are read.
      const head = p.replace(/<jobDescriptions>[\s\S]*?<\/jobDescriptions>/, '')
      const id = field(head, 'id')
      const office = field(head, 'office')
      return {
        sourceId: id,
        title: field(head, 'name'),
        location: office,
        countries: countriesIn(office),
        employment: employmentOf(field(head, 'employmentType'), field(head, 'schedule')),
        url: `https://${board}.jobs.personio.de/job/${id}`,
        postedAt: isoDate(field(head, 'createdAt')),
        postedRough: false,
        needsDetails: false
      }
    })
    return { jobs, complete: true, note: null }
  }
}
