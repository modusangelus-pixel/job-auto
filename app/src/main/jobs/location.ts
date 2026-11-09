import type { RegionGroup } from '../../shared/types'
import { foldText } from './fold'

export const REGION_COUNTRIES: Record<RegionGroup, string[]> = {
  nordics: ['SE', 'NO', 'FI', 'DK'],
  europe: [
    'AL',
    'AD',
    'AT',
    'BE',
    'BA',
    'BG',
    'HR',
    'CY',
    'CZ',
    'EE',
    'FR',
    'DE',
    'GR',
    'HU',
    'IS',
    'IE',
    'IT',
    'XK',
    'LV',
    'LI',
    'LT',
    'LU',
    'MT',
    'MD',
    'MC',
    'ME',
    'NL',
    'MK',
    'PL',
    'PT',
    'RO',
    'SM',
    'RS',
    'SK',
    'SI',
    'ES',
    'UA',
    'GB',
    'CH',
    'VA'
  ],
  usa: ['US'],
  canada: ['CA'],
  australia: ['AU'],
  new_zealand: ['NZ'],
  turkey: ['TR']
}

const REGION_ORDER: RegionGroup[] = [
  'nordics',
  'europe',
  'usa',
  'canada',
  'australia',
  'new_zealand',
  'turkey'
]

/** The region groups that contain at least one of the countries, in the fixed region order. */
export function regionGroupsOf(countries: string[]): RegionGroup[] {
  return REGION_ORDER.filter((g) => countries.some((c) => REGION_COUNTRIES[g].includes(c)))
}

const ALPHA2 = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS ' +
  'BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE ' +
  'EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM ' +
  'HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC ' +
  'LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA ' +
  'NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO ' +
  'TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ')

const ALIASES: Record<string, string> = {
  USA: 'US',
  US: 'US',
  'U.S.': 'US',
  'United States of America': 'US',
  UK: 'GB',
  'U.K.': 'GB',
  England: 'GB',
  Scotland: 'GB',
  Wales: 'GB',
  'Northern Ireland': 'GB',
  'Great Britain': 'GB',
  Türkiye: 'TR',
  Turkiye: 'TR',
  Turkey: 'TR',
  Sverige: 'SE',
  Norge: 'NO',
  Suomi: 'FI',
  Danmark: 'DK',
  Deutschland: 'DE',
  Österreich: 'AT',
  Schweiz: 'CH',
  Suisse: 'CH',
  Svizzera: 'CH',
  España: 'ES',
  Italia: 'IT',
  Nederland: 'NL',
  Polska: 'PL',
  Česko: 'CZ',
  Czechia: 'CZ',
  Brasil: 'BR'
}

const US_STATES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming'
}

const CA_PROVINCES: Record<string, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon'
}

const AU_STATES: Record<string, string> = {
  NSW: 'New South Wales',
  VIC: 'Victoria',
  QLD: 'Queensland',
  TAS: 'Tasmania',
  ACT: 'Australian Capital Territory'
}
const AU_EXTRA_NAMES = ['Western Australia', 'South Australia', 'Northern Territory']

const CODE_SET = new Set(ALPHA2)

// Folded country name or alias -> alpha-2 code. Built once.
const COUNTRY_BY_NAME = new Map<string, string>()
{
  const names = new Intl.DisplayNames(['en'], { type: 'region' })
  for (const code of ALPHA2) {
    const name = names.of(code)
    if (name && name !== code) COUNTRY_BY_NAME.set(foldText(name), code)
  }
  for (const [alias, code] of Object.entries(ALIASES)) COUNTRY_BY_NAME.set(foldText(alias), code)
}

function lookupTable(table: Record<string, string>, extraNames: string[] = []): Set<string> {
  const set = new Set<string>()
  for (const [code, name] of Object.entries(table)) {
    set.add(foldText(code))
    set.add(foldText(name))
  }
  for (const n of extraNames) set.add(foldText(n))
  return set
}

const US_KEYS = lookupTable(US_STATES)
const CA_KEYS = lookupTable(CA_PROVINCES)
const AU_KEYS = lookupTable(AU_STATES, AU_EXTRA_NAMES)

/** True for a US state, Canadian province or Australian state code (IL, ON, NSW), which can also be a country code. */
export function isSubdivisionCode(code: string): boolean {
  return code in US_STATES || code in CA_PROVINCES || code in AU_STATES
}

/** A country name or alias, or an alpha-2 code passed as is, mapped to its code; null if unknown. */
export function countryCode(name: string): string | null {
  const key = foldText(name.trim())
  if (key.length === 2 && CODE_SET.has(key.toUpperCase())) return key.toUpperCase()
  return COUNTRY_BY_NAME.get(key) ?? null
}

function resolvePart(part: string): string | null {
  const key = foldText(part.trim())
  if (key === '') return null
  if (key === 'georgia') return 'US'
  const named = COUNTRY_BY_NAME.get(key)
  if (named) return named
  if (US_KEYS.has(key)) return 'US'
  if (CA_KEYS.has(key)) return 'CA'
  if (AU_KEYS.has(key)) return 'AU'
  return null
}

/** The places in a location text, each with its parts, split on ; | and " / " then on , " - " and brackets. */
export function placesIn(text: string): string[][] {
  return text.split(/;|\||\s\/\s/).map((place) => place.split(/,|\s-\s|[()]/))
}

// Folded US state code or name -> its code. Built once: usStateCode runs for every part of every stored job.
const US_STATE_BY_KEY = new Map<string, string>()
for (const [code, name] of Object.entries(US_STATES)) {
  US_STATE_BY_KEY.set(foldText(code), code)
  US_STATE_BY_KEY.set(foldText(name), code)
}

/** A US state name or code mapped to its two-letter code; null if the part is neither. */
export function usStateCode(part: string): string | null {
  return US_STATE_BY_KEY.get(foldText(part.trim())) ?? null
}

/** True for a country name, alias or code, or a US state, Canadian province or Australian state name or code. */
export function isRegionName(part: string): boolean {
  const key = foldText(part.trim())
  if (key === '') return false
  return countryCode(part) !== null || US_KEYS.has(key) || CA_KEYS.has(key) || AU_KEYS.has(key)
}

/** Unique alpha-2 codes found in a location text, in the order found. [] when none is clear. */
export function countriesIn(text: string): string[] {
  const found: string[] = []
  for (const parts of placesIn(text)) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const code = resolvePart(parts[i])
      if (code) {
        if (!found.includes(code)) found.push(code)
        break
      }
    }
  }
  return found
}
