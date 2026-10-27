// De 22 known-answer-bestanden zijn bevroren sinds tag v0.2.23.
//
// WAAROM: de tekst van x402 pull request 3776 noemt vectors/attempt-identity "normative" en verwijst naar
// main, een bewegend doel. Twee mensen buiten dit project hebben precies deze 22 bestanden gecontroleerd
// (ruiruii en NSPG13, x402 pull request 3958). Wie ze later zou wijzigen, maakt hun controle waardeloos
// zonder dat iemand het ziet. Deze toets laat npm test falen als er een van de 22 verandert. Een fout
// herstel je met een NIEUW bestand en een regel in de README, niet door een bestand te overschrijven.
//
// De hashes zijn berekend over de bytes op de tag, met CRLF genormaliseerd naar LF zodat een Windows-werkmap
// dezelfde uitslag geeft.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vectors', 'attempt-identity')
const BEVROREN = {
  'known-answer-body-duplicate-keys-hashed-as-bytes-wrong.json': '31da5339b75d964be3a4ac346947263a14a0bb9bb4b1497dd7081bbf12cb2209',
  'known-answer-body-duplicate-keys-hashed-as-bytes.json': 'cb4b11d902a6acefb17085266b585d50144b180960159d8a5c87d92c78ed7063',
  'known-answer-body-gzip-then-rfc8785-wrong.json': '4f17fa51bd0a419a8770777f882f627f1dba903ddb874115752592b14c36cb42',
  'known-answer-body-gzip-then-rfc8785.json': '83354d0f2bbc51309c2e9d4600babf92c228170bd7f3a2c0ab47fe9bbe614aba',
  'known-answer-body-iso-8859-1-is-latin1-wrong.json': '96b53cb79a75d65407442ba8bab9e75500907b10af08f3ac9d6f0921090c4b4f',
  'known-answer-body-iso-8859-1-is-latin1.json': '8fad0b3787e129da9e71e19fde9d15c7a7219c4abd7ac087d729c031a1987265',
  'known-answer-body-json-rfc8785-wrong.json': '76bea56e7a14d6bb3d02819d00ff2be159ec680d3687bd3509842b34979e9e8f',
  'known-answer-body-json-rfc8785.json': 'bcac0ed706a8ebd5a9ba5a5154e3e161c149bf45bc795a20f9bc52329a2d30ae',
  'known-answer-query-bare-name-stays-bare-wrong.json': '57f4af9162bb139f68c0a061bf596f009efb5d4b7aff237d82767835c3799c2c',
  'known-answer-query-bare-name-stays-bare.json': 'ee120c2520d6797acba145ef3ae078f969dd4be8fe68b0ed825c826997dfe201',
  'known-answer-query-decode-then-encode-wrong.json': '34e68c7dbee1cba587749e46c188adf8bded19341ab94b391d795157c6582a12',
  'known-answer-query-decode-then-encode.json': '558056241a0085e92ffd38e028aa32dc5aca5079288dbdf893f83f0022c72172',
  'known-answer-query-invalid-utf8-stays-octets-wrong.json': '8f068a7e63d94c5fde248c9f7f0477a8b895957f6cad0c14ce32b2f21a3a2e57',
  'known-answer-query-invalid-utf8-stays-octets.json': 'cb4f616cebc44f911e3107833bd8cbcc6510d73a33873224dc9f80a36b82945c',
  'known-answer-query-plus-stays-plus-wrong.json': '6d24b6cc3cd37ee73609e30cd57a5784dd3403f6ff60a53c9f46273c0093e0fc',
  'known-answer-query-plus-stays-plus.json': '9cb4d94a4d2395d3d3b0716f0938af89864623ce2542eb2f21ee93af93f6cc12',
  'known-answer-query-repeated-keys-keep-order-wrong.json': '9ce66c8b3d3bf4ab3aed4d5ab0251142d85dd5528f54b3988bc4e066d9845d65',
  'known-answer-query-repeated-keys-keep-order.json': 'f3a24eaea5557c30bacc5d406dc77894ac4fc002ba63a18345bb5f239a3e3a53',
  'known-answer-query-semicolon-is-not-a-separator-wrong.json': 'df607b1dfe7c9f51444c2da249869057474245906304c841e55ac585265b1429',
  'known-answer-query-semicolon-is-not-a-separator.json': 'a36a2ff3ab00de2798cf8d84cc9dceea76a7bd073dc1e5d94a573a2962185147',
  'known-answer-query-uppercase-hex-and-arrival-order-wrong.json': '193d39db81ac15f6ec4ffa0c1927dff96b39ac7ec8d88e0dc0a5169086093cf0',
  'known-answer-query-uppercase-hex-and-arrival-order.json': 'c15efe457b890a59eb63961f683424cf9dda7585c2b2c2a3ded6e12b17a54834',
}

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  [' + extra + ']' : '')) }
}
const sha = (tekst) => crypto.createHash('sha256').update(tekst.replace(/\r\n/g, '\n')).digest('hex')

console.log('de 22 known-answer-bestanden zijn bevroren')
t('de lijst telt 22 bestanden', Object.keys(BEVROREN).length === 22)
for (const [naam, verwacht] of Object.entries(BEVROREN)) {
  const p = path.join(MAP, naam)
  if (!fs.existsSync(p)) { t(naam + ': bestaat', false, 'ontbreekt'); continue }
  const echt = sha(fs.readFileSync(p, 'utf8'))
  t(naam + ': ongewijzigd', echt === verwacht, echt.slice(0, 12) + ' tegen ' + verwacht.slice(0, 12))
}

console.log('')
console.log('de controle moet ook kunnen falen')
{
  const naam = Object.keys(BEVROREN)[0]
  const tekst = fs.readFileSync(path.join(MAP, naam), 'utf8')
  t('CONTROLE: een kopie met een spatie erbij heeft een andere hash', sha(tekst + ' ') !== BEVROREN[naam])
  const lf = tekst.replace(/\r\n/g, '\n')
  t('CONTROLE: regeleinden CRLF of LF geven dezelfde hash', sha(lf.replace(/\n/g, '\r\n')) === sha(lf))
}

console.log('')
console.log('attempt-identity-bevroren: ' + goed + ' pass, ' + fout + ' fail')
process.exitCode = fout === 0 ? 0 : 1
