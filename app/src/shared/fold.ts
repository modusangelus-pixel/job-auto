// Letters NFD does not split into a base letter and a mark, spelled out in plain letters.
const SPELLED: Record<string, string> = {
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th'
}

/**
 * Folds text for matching: İ, I and ı become i, lower-case, ø æ œ ß ł đ ð þ spelled out (Køge becomes koge),
 * accents removed (süreç becomes surec).
 */
export function foldText(s: string): string {
  return s
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .replace(/[øæœßłđðþ]/g, (c) => SPELLED[c])
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}
