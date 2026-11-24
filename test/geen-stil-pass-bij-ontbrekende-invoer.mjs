// Een controle die een invoer MIST mag nooit PASS zeggen. Voor elke PASS-vector van de rejection-receipt-checker
// halen we elk veld uit de context weg, een voor een, en maken we elk tekstveld leeg of blanco; de uitkomst mag
// dan nooit meer PASS zijn. Dit is de weglating uit de mutatiematrix, toegepast op de ingangen van de checker
// (aanleiding: 24 nov 2026, een lezer van pull request 4215 vond dat een ontbrekend payTo-adres PASS gaf).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toetsAfwijzingsBon } from '../src/rejection-receipt.mjs'

const map = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vectors', 'rejection-receipt')
let pass = 0
let fail = 0
const t = (naam, ok, extra = '') => {
  if (ok) { pass++; console.log('  pass  ' + naam) } else { fail++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

const vectoren = fs.readdirSync(map).filter((b) => b.endsWith('.json')).sort()
  .map((b) => ({ b, v: JSON.parse(fs.readFileSync(path.join(map, b), 'utf8')) }))
  .filter(({ v }) => v.input && v.input.receipt !== undefined && v.expected && v.expected.outcome === 'PASS')

console.log('weglating van elk contextveld bij elke PASS-vector')
t('er zijn PASS-vectoren om te beproeven', vectoren.length >= 10, String(vectoren.length))
let beproefd = 0
for (const { b, v } of vectoren) {
  const context = v.input.context ?? {}
  t(b.replace('.json', '') + ': de vector zelf is PASS', toetsAfwijzingsBon(v.input.receipt, context).outcome === 'PASS')
  for (const sleutel of Object.keys(context)) {
    const zonder = { ...context }
    delete zonder[sleutel]
    const u = toetsAfwijzingsBon(v.input.receipt, zonder)
    beproefd++
    t(b.replace('.json', '') + ': zonder ' + sleutel + ' is het nooit PASS', u.outcome !== 'PASS', JSON.stringify(u))
    if (typeof context[sleutel] === 'string') {
      for (const leeg of ['', '   ']) {
        const u2 = toetsAfwijzingsBon(v.input.receipt, { ...context, [sleutel]: leeg })
        beproefd++
        t(b.replace('.json', '') + ': ' + sleutel + ' ' + JSON.stringify(leeg) + ' is nooit PASS', u2.outcome !== 'PASS', JSON.stringify(u2))
      }
    }
  }
}
t('er is echt iets beproefd', beproefd >= 30, String(beproefd))
console.log('')
console.log('geen-stil-pass-bij-ontbrekende-invoer: ' + pass + ' pass, ' + fail + ' fail')
if (fail > 0) process.exitCode = 1
