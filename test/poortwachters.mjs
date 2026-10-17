// Test voor de poortwachters-meting, zonder netwerk.
//
// De gevallen gaan over de drie manieren waarop juist deze meting scheef gaat, en
// alle drie zijn bij de eerste echte run opgedoken:
//  1. een /supported dat anders heet dan verwacht wordt als "doet niets" gelezen.
//  2. een HTML-pagina op een API-pad wordt als een KAPOTTE poortwachter gelezen in
//     plaats van als "dat endpoint bestaat hier niet".
//  3. concentratie van de eerste pagina wordt als DE concentratie gelezen, terwijl
//     die een ondergrens is: op een echte index gaf de eerste pagina 21,0 procent en
//     een volledige census 51,8 procent voor hetzelfde domein.

import { leesSupported, concentratie, hoogsteTrede, meetPoortwachter, POORTWACHTERS } from '../src/x402-poortwachters.mjs'

let goed = 0
let fout = 0
const t = (naam, ok, extra = '') => {
  if (ok) { goed++; console.log('  pass  ' + naam) }
  else { fout++; console.log('  FAIL  ' + naam + (extra ? '  <- ' + extra : '')) }
}

// ── /supported in meerdere vormen ────────────────────────────────────────────
{
  const kinds = { kinds: [{ network: 'eip155:8453', scheme: 'exact' }] }
  t('vorm met kinds wordt gelezen', leesSupported(kinds).netwerken.length === 1 && leesSupported(kinds).schemes[0] === 'exact')
  t('een kale lijst wordt ook gelezen', leesSupported([{ network: 'a', scheme: 'b' }]).netwerken[0] === 'a')
  t('vorm met supported wordt gelezen', leesSupported({ supported: [{ network: 'x', scheme: 'y' }] }).schemes[0] === 'y')
  t('dubbele netwerken worden een keer geteld',
    leesSupported({ kinds: [{ network: 'a', scheme: 's' }, { network: 'a', scheme: 's' }] }).netwerken.length === 1)
  t('extensies in een object worden gezien',
    leesSupported({ kinds: [{ network: 'a', scheme: 's', extensions: { 'offer-receipt': {} } }] }).extensies[0] === 'offer-receipt')
  t('extensies in een lijst worden ook gezien',
    leesSupported({ kinds: [{ network: 'a', scheme: 's', extensions: ['bazaar'] }] }).extensies[0] === 'bazaar')
  t('niets is niets, en klapt niet', leesSupported(null).netwerken.length === 0 && leesSupported('tekst').schemes.length === 0)
}

// ── concentratie, en dat het een ondergrens is ───────────────────────────────
{
  const items = [
    { resource: 'https://groot.example/a' },
    { resource: 'https://groot.example/b' },
    { resource: 'https://groot.example/c' },
    { resource: 'https://klein.example/x' },
  ]
  const c = concentratie(items)
  t('de grootste host wordt gevonden', c.grootste === 'groot.example')
  t('het aandeel is over de bruikbare adressen', Math.abs(c.aandeel - 0.75) < 1e-9, String(c.aandeel))
  t('hosts worden geteld', c.hosts === 2)
  t('onbruikbare adressen tellen niet mee in de noemer',
    concentratie([{ resource: 'https://a.example/1' }, { resource: 'geen url' }]).gemeten === 1)
  t('een lege lijst geeft geen deling door nul', concentratie([]).aandeel === null)
  t('geen lijst geeft ook geen fout', concentratie(null).hosts === 0)
}

// ── de ladder loopt niet door over een gat heen ──────────────────────────────
{
  t('zonder g0 is het niveau min een', hoogsteTrede({ g0: false, g1: true, g2: true }) === -1)
  t('g0 zonder g1 blijft nul', hoogsteTrede({ g0: true, g1: false, g2: true, g3: true }) === 0)
  t('alles groen is vier', hoogsteTrede({ g0: true, g1: true, g2: true, g3: true, g4: true }) === 4)
  t('index zonder totaal blijft twee', hoogsteTrede({ g0: true, g1: true, g2: true, g3: false, g4: true }) === 2)
}

// ── html op een api-pad is afwezigheid, geen defect ──────────────────────────
{
  const nepFetch = async () => ({ ok: true, status: 200, text: async () => '<!DOCTYPE html><html>een pagina</html>' })
  const m = await meetPoortwachter({ naam: 'test', basis: 'https://x.example' }, { fetchImpl: nepFetch, pauzeMs: 0 })
  t('html geeft geen g0', m.g0 === false)
  t('en de reden zegt dat het html was', /html/.test(m.bewijs.g0), m.bewijs.g0)
  t('het niveau is min een, niet een fout', m.trede === -1)
}
{
  const nepFetch = async () => { throw new Error('ENOTFOUND') }
  const m = await meetPoortwachter({ naam: 'dood', basis: 'https://x.example' }, { fetchImpl: nepFetch, pauzeMs: 0 })
  t('een dode host laat de meting niet klappen', m.trede === -1)
  t('en noemt onbereikbaar in het bewijs', /onbereikbaar/.test(m.bewijs.g0), m.bewijs.g0)
}
{
  // Een volledig werkende poortwachter, zodat de ladder ook groen KAN worden.
  const nepFetch = async (url) => {
    if (url.includes('/supported')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ kinds: [{ network: 'eip155:8453', scheme: 'exact', extensions: { 'offer-receipt': {} } }] }) }
    }
    return {
      ok: true, status: 200, text: async () => JSON.stringify({
        // Drie hosts, want de drempel is "onder de HELFT": met twee hosts zit de
        // grootste op precies 50 procent en dan hoort G4 juist NIET te halen.
        items: [{ resource: 'https://a.example/1' }, { resource: 'https://b.example/1' }, { resource: 'https://c.example/1' }],
        pagination: { total: 3 },
      }),
    }
  }
  const m = await meetPoortwachter({ naam: 'goed', basis: 'https://x.example' }, { fetchImpl: nepFetch, pauzeMs: 0 })
  t('een volledige poortwachter haalt vier', m.trede === 4, 'kreeg ' + m.trede + ' ' + JSON.stringify(m.bewijs))
  t('en het bewijs zegt dat het de EERSTE PAGINA is', /EERSTE PAGINA/.test(m.bewijs.g4), m.bewijs.g4)
}

t('de lijst poortwachters is niet leeg en heeft geen dubbele namen',
  POORTWACHTERS.length > 5 && new Set(POORTWACHTERS.map((p) => p.naam)).size === POORTWACHTERS.length)

console.log('')
console.log('poortwachters: ' + goed + ' pass, ' + fout + ' fail')
if (fout > 0) process.exitCode = 1
