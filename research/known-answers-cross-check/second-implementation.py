# Tweede, onafhankelijke berekening van de bekende antwoorden (alleen de standaardbibliotheek van Python).
# Leest een lijst met ruwe verzoeken van stdin en schrijft per verzoek de canonieke query en het SHA-256 van het lichaam.
import sys, json, gzip, zlib, base64, hashlib
from urllib.parse import quote, unquote_to_bytes

def canonical_query(raw):
    q = (raw or '').lstrip('?')
    if q == '':
        return ''
    out = []
    enc = lambda s: quote(unquote_to_bytes(s), safe='-._~')  # uppercase hex over the unreserved set, plus stays a plus
    for part in q.split('&'):  # only '&' separates, ';' does not
        if part == '':
            continue
        if '=' in part:
            n, v = part.split('=', 1)
            out.append(enc(n) + '=' + enc(v))
        else:
            out.append(enc(part))  # a name without '=' stays bare
    return '&'.join(out)  # arrival order, nothing is sorted

def has_dupes(pairs):
    seen = set()
    for k, _ in pairs:
        if k in seen:
            return True
        seen.add(k)
    return False

def body_digest(r):
    data = base64.b64decode(r.get('bodyBase64', ''))
    for enc in reversed([e.strip().lower() for e in (r.get('contentEncoding') or '').split(',') if e.strip()]):
        if enc in ('gzip', 'x-gzip'):
            data = gzip.decompress(data)
        elif enc == 'deflate':
            data = zlib.decompress(data)
        elif enc == 'identity':
            pass
        else:
            raise ValueError('unsupported ' + enc)
    ct = r.get('contentType') or ''
    charset = 'utf-8'
    if 'charset=' in ct.lower():
        charset = ct.lower().split('charset=', 1)[1].split(';')[0].strip().strip('"')
    codec = {'iso-8859-1': 'latin-1', 'latin1': 'latin-1', 'l1': 'latin-1'}.get(charset, charset)
    text = data.decode(codec)
    is_json = ct.strip().lower().startswith('application/') and 'json' in ct.lower().split(';')[0]
    out = text
    if is_json:
        dup = {'v': False}
        def hook(pairs):
            if has_dupes(pairs):
                dup['v'] = True
            return dict(pairs)
        try:
            val = json.loads(text, object_pairs_hook=hook)
            if not dup['v']:
                out = json.dumps(val, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
        except Exception:
            out = text
    return hashlib.sha256(out.encode('utf-8')).hexdigest()

cases = json.load(sys.stdin)
res = []
for c in cases:
    has_body = c.get('bodyBase64', '') != ''
    res.append({'query': canonical_query(c.get('query')), 'body_sha256': body_digest(c) if has_body else None})
print(json.dumps(res))
