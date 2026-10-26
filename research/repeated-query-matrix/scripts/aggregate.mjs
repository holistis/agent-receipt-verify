// Usage: node aggregate.mjs <results-dir>
import fs from 'node:fs';
const dir = process.argv[2];
const rows = ['node.json', 'python.json', 'go.json', 'php.json'].flatMap((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')));
const J = (x) => JSON.stringify(x);
const fam = (l) => /^Express/.test(l) ? 'Express' : /^FastAPI/.test(l) ? 'FastAPI' : /^Django/.test(l) ? 'Django' : /^Go net\/(url|http)/.test(l) ? 'Go net/url+net/http' : /^Node URL/.test(l) ? 'Node URLSearchParams' : l;
const show = (v) => (Array.isArray(v) ? '[' + v.join(',') + ']' : v === null || v === undefined ? 'null' : String(v));
const T1 = [];
let sTot = 0, sDiff = 0, aTot = 0, aDiff = 0;
const famS = new Map(), famA = new Map();
for (const r of rows) {
  const ab = r.rep.ab, ba = r.rep.ba;
  const sApplicable = !/^n\/a/.test(r.single_accessor) && ab.single !== 'n/a';
  const sDiffers = sApplicable && J(ab.single) !== J(ba.single);
  const listOf = (o) => (Array.isArray(o.all) ? o.all : o.all === 'same-as-single' && Array.isArray(o.single) ? o.single : null);
  const la = listOf(ab), lb = listOf(ba);
  const aApplicable = la !== null && lb !== null;
  const aDiffers = aApplicable && J(la) !== J(lb);
  if (sApplicable) { sTot++; if (sDiffers) sDiff++; famS.set(fam(r.lib), (famS.get(fam(r.lib)) || false) || sDiffers); }
  if (aApplicable) { aTot++; if (aDiffers) aDiff++; famA.set(fam(r.lib), (famA.get(fam(r.lib)) || false) || aDiffers); }
  const stype = Array.isArray(ab.single) ? ' (array)' : '';
  T1.push(`| ${r.lib} | ${r.version} | ${r.transport} | ${r.single_accessor} | ${sApplicable ? show(ab.single) + ' / ' + show(ba.single) + stype : 'n/a'} | ${aApplicable ? show(la) + ' / ' + show(lb) : 'n/a'} | ${sApplicable ? (sDiffers ? 'YES' : 'no') : '-'} | ${aApplicable ? (aDiffers ? 'YES' : 'no') : '-'} |`);
}
console.log('TABLE 1  (cells: ?q=a&q=b  /  ?q=b&q=a)');
console.log('| library | version | transport | single accessor | single value | get-all list | single differs | list differs |');
console.log('|---|---|---|---|---|---|---|---|');
console.log(T1.join('\n'));
console.log(`\nROW COUNTS: single-value differs ${sDiff}/${sTot}; get-all list differs ${aDiff}/${aTot}`);
const fs1 = [...famS.entries()], fa1 = [...famA.entries()];
console.log(`FAMILY COUNTS: single differs ${fs1.filter(([, v]) => v).length}/${fs1.length}; list differs ${fa1.filter(([, v]) => v).length}/${fa1.length}`);
console.log('families with single NOT differing:', fs1.filter(([, v]) => !v).map(([k]) => k));
console.log('families with list NOT differing:', fa1.filter(([, v]) => !v).map(([k]) => k));

console.log('\nTABLE 2  (keys in default iteration order; ?a=1&b=2 vs ?b=2&a=1)');
console.log('| library | keys for a,b | keys for b,a | order of different names exposed |');
console.log('|---|---|---|---|');
let oDiff = 0;
for (const r of rows) {
  const ka = r.cross.ab.keys, kb = r.cross.ba.keys;
  const orders = r.cross.ab.distinct_key_orders_over_300_iterations;
  const exposed = J(ka) !== J(kb) && (orders === undefined || orders === 1);
  if (exposed) oDiff++;
  console.log(`| ${r.lib} | ${show(ka)} | ${show(kb)} | ${exposed ? 'yes' : 'NO' + (orders > 1 ? ` (random: ${orders} orders seen in 300 iterations)` : '')} |`);
}
console.log(`\nORDER EXPOSED: ${oDiff}/${rows.length} rows`);
for (const r of rows) if (r.extra && Object.keys(r.extra).length) console.log('EXTRA', r.lib, J(r.extra));
