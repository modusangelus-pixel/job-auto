import { expect, test } from 'vitest'
import { foldText } from '../../src/main/jobs/fold'

test('foldText folds Turkish capitals, case and accents', () => {
  expect(foldText('KIDEMLİ')).toBe('kidemli')
  expect(foldText('Süreç')).toBe('surec')
  expect(foldText('ISTANBUL')).toBe('istanbul')
  expect(foldText('yarı zamanlı')).toBe('yari zamanli')
})

test('foldText spells out letters that do not decompose', () => {
  expect(foldText('Køge Sønderborg Tromsø')).toBe('koge sonderborg tromso')
  expect(foldText('ÆRØ Straße Wrocław Łódź')).toBe('aero strasse wroclaw lodz')
  expect(foldText('Œuvre Đakovo Ðað Þórshöfn')).toBe('oeuvre dakovo dad thorshofn')
})
