// The self tests of the two seller families plant faults by searching and rewriting the text of their own sources. A checkout on
// Windows with core.autocrlf=true has CRLF line ends, and a search written for LF finds nothing there. This test copies the sources
// of each family to a temporary folder with CRLF line ends and lets the self test run there: it must still catch every planted fault.
// No network, no keys.
// Cite as: github.com/holistis/agent-receipt-verify, vectors/settlement-pending and vectors/settle-before-serve, 2026-11-23.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const wortel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CR = String.fromCharCode(13), LF = String.fromCharCode(10)
const FAMILIES = [
  { naam: 'settlement-pending', bestanden: ['src/settlement-pending/decide.mjs', 'src/settlement-pending/twins.mjs', 'src/settlement-pending/run.mjs', 'src/settlement-pending/table.mjs', 'src/settlement-pending/properties.mjs', 'src/settlement-pending/selftest.mjs', 'vectors/settlement-pending/vectors.json', 'vectors/settlement-pending/decision-table.md'], selftest: 'src/settlement-pending/selftest.mjs' },
  { naam: 'settle-before-serve', bestanden: ['src/settle-before-serve/decide.mjs', 'src/settle-before-serve/twins.mjs', 'src/settle-before-serve/run.mjs', 'src/settle-before-serve/properties.mjs', 'src/settle-before-serve/selftest.mjs', 'vectors/settle-before-serve/vectors.json'], selftest: 'src/settle-before-serve/selftest.mjs' },
]

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) } else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

for (const fam of FAMILIES) {
  console.log(fam.naam + ': the self test on a copy with CRLF line ends')
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'crlf-' + fam.naam + '-'))
  try {
    for (const f of fam.bestanden) {
      const tekst = fs.readFileSync(path.join(wortel, f), 'utf8').split(CR + LF).join(LF).split(LF).join(CR + LF)
      fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true })
      fs.writeFileSync(path.join(d, f), tekst)
    }
    t('CONTROL: every copied file really has CRLF line ends', fam.bestanden.every((f) => fs.readFileSync(path.join(d, f), 'utf8').includes(CR + LF)))
    const r = spawnSync(process.execPath, [path.join(d, fam.selftest)], { cwd: d, encoding: 'utf8', timeout: 240000 })
    const uit = r.stdout || ''
    const m = uit.match(/planted faults caught: (\d+) of (\d+)/)
    t('the self test exits 0', r.status === 0, 'exit ' + r.status + ' ' + String(r.stderr || '').split(LF)[0])
    t('it catches every planted fault', !!m && m[1] === m[2] && Number(m[1]) > 0, m ? m[0] : 'no result line')
    t('it did not stop on "planting did nothing"', !/planting did nothing/.test(uit + (r.stderr || '')))
  } finally {
    fs.rmSync(d, { recursive: true, force: true })
  }
  console.log('')
}
console.log('selftest-crlf: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
