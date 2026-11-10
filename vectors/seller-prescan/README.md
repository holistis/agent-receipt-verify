# Seller pre-scan: wie publiceert echt een werkend x402-discoverybestand

Gemeten: 2026-11-10T11:49:18.136Z
Zoekopdracht: GitHub code-search `filename:x402.json path:.well-known`, alleen echte (niet-fork) repos, origin afgeleid uit de eerste resource-url (veld `url` of `resource`, beide vormen gezien in echte bestanden) in het bestand.

## Wat dit is, en wat niet

Dit is een READ-ONLY check van een verkoper se discovery-oppervlak (het per-origin `/.well-known/x402.json`-bestand uit [x402-foundation/x402#2582](https://github.com/x402-foundation/x402/issues/2582), nog geen geratificeerde spec): bestaat het, is het geldig, antwoorden de genoemde endpoints. Geen enkele betaling is gedaan; elke status-code (ook 402, dat bewijst juist dat een endpoint leeft en x402 spreekt) telt als "bereikbaar", alleen een netwerk-/DNS-/timeout-fout telt als onbereikbaar. Dit beantwoordt NIET of een betaalde reactie klopt met wat beloofd werd (dat vraagt een echte betaling, een apart, duurder onderzoek, nog niet gedaan).

Dit is iets anders dan `vectors/facilitator-request-binding/` in deze repo: die vectoren tonen een gat in het PROTOCOL zelf. Dit hier beoordeelt losse VERKOPERS vooraf, voor een agent iets koopt.

## De formule, volledig narekenbaar (src/seller-prescan.mjs, `berekenOordeel`)

- Discovery-bestand bereikbaar en geldige JSON: 20% (kan weegt as "bestaat het überhaupt").
- Schema geldig (een leesbare resources-lijst met url's): 30% (een leeg of onleesbaar bestand dat toevallig 200 teruggeeft is net zo nutteloos als geen bestand).
- Fractie van de genoemde endpoints die een echt antwoord geven: 50% (dit is de kern: doet het ook wat het zegt).

Geen geldig schema → altijd VERMIJD, ongeacht de rest. Score ≥ 0.85 → OK, ≥ 0.5 → LET-OP, lager → VERMIJD.

| Origin | Oordeel | Score | Resources | Bereikbaar |
| --- | --- | --- | --- | --- |
| https://solana-ai-platform.netlify.app | OK | 1 | 2 | 2 |
| https://elon00.github.io | VERMIJD | 0 | 0 | 0 |
| https://marketplace-service-template-production-e603.up.railway.app | VERMIJD | 0 | 0 | 0 |
