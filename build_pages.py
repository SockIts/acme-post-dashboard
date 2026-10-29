#!/usr/bin/env python3
"""Build the password-protected static site (index.html) for GitHub Pages.

  PAGES_PASSWORD='<shared password>' [RELAY_BASE=https://relay.example RELAY_TOKEN=...] python3 build_pages.py [path/to/acme-post-dashboard.html]

Reads the (unencrypted) dashboard HTML, patches it for static hosting (note, test banner, Lock button,
optional live-relay CONFIG from RELAY_BASE / RELAY_TOKEN), gzips it, encrypts it with AES-256-GCM (key = PBKDF2-HMAC-SHA256, 1,000,000 iterations,
random 16-byte salt, random 12-byte IV) and writes index.html = a small login page that decrypts in the
browser (Web Crypto) and renders the dashboard in-page. The password is read from the PAGES_PASSWORD
environment variable only; it is never written anywhere. The dashboard HTML is never copied into this repo.
"""
import os, sys, gzip, json, base64, re
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('DASHBOARD_HTML', os.path.join(HERE, '..', 'dashboard', 'acme-post-dashboard.html'))
ITER = 1_000_000
pw = os.environ.get('PAGES_PASSWORD')
if not pw:
    sys.exit('Set PAGES_PASSWORD in the environment (it is never stored).')

html = open(SRC, encoding='utf-8').read()

# ---------- patch the dashboard for static hosting (every replacement must match exactly once) ----------
def rep(old, new, count=1):
    global html
    n = html.count(old)
    if n != count:
        sys.exit(f'patch failed ({n} matches, expected {count}): {old[:70]!r}')
    html = html.replace(old, new)

NOTE = 'Static test site: Posted links, comments and requests are saved in this browser only. Use Export comments to share.'
html = re.sub(r'<div class="localnote">.*?</div>',
              lambda m: '<div class="localnote" id="static-note"><b>' + NOTE + '</b> Drafts only: nothing is posted automatically. After posting on X, tick Posted and paste the link.</div>',
              html, count=1, flags=re.S)
assert 'id="static-note"' in html
rep('<body>\n<header class="top">', '<body>\n<div class="testbar">Test mode: drafts only. Nothing is posted automatically. After posting on X, tick Posted and paste the link.</div>\n<header class="top">')
# Lock button in the header (the .testbar / .btn styles already live in dashboard.css)
rep('<div class="hdr-r">', '<div class="hdr-r"><button class="btn" id="lock-btn" type="button" title="Forget the saved key on this browser and return to the password screen">Lock</button>')
# live relay (optional): the token is injected here, so it only ever exists inside the ENCRYPTED payload
RB = os.environ.get('RELAY_BASE', '').strip().rstrip('/')
RT = os.environ.get('RELAY_TOKEN', '').strip()
rep("API_BASE:'',API_TOKEN:''", "API_BASE:" + json.dumps(RB) + ",API_TOKEN:" + json.dumps(RT))
# Lock button + cross-tab sync
rep("window.__dash={", """window.addEventListener('storage',e=>{if(e.key&&e.key.indexOf(PFX)===0)refresh()});
$('#lock-btn').onclick=()=>{try{localStorage.removeItem('acme-pages-key')}catch(e){}location.reload()};
window.__dash={""")
for bad in ('Due now', 'due-bar', 'dueOf', 'Scheduling not active'):
    if bad in html:
        sys.exit('leftover scheduling wording in the page: ' + bad)

# ---------- encrypt ----------
raw = html.encode('utf-8')
gz = gzip.compress(raw, 9)
salt, iv = os.urandom(16), os.urandom(12)
key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(pw.encode('utf-8'))
ct = AESGCM(key).encrypt(iv, gz, None)
blob = json.dumps({'v': 1, 'kdf': 'PBKDF2-SHA256', 'iter': ITER, 'alg': 'AES-256-GCM', 'gz': True,
                   'salt': base64.b64encode(salt).decode(), 'iv': base64.b64encode(iv).decode(),
                   'ct': base64.b64encode(ct).decode()})
page = open(os.path.join(HERE, 'login_template.html'), encoding='utf-8').read()
assert '/*BLOB*/' in page
page = page.replace('/*BLOB*/', blob)
out = os.path.join(HERE, 'index.html')
open(out, 'w', encoding='utf-8').write(page)
print(f'dashboard {len(raw)/1e6:.1f} MB -> gzip {len(gz)/1e6:.1f} MB -> index.html {os.path.getsize(out)/1e6:.1f} MB (PBKDF2-SHA256 x{ITER:,}, AES-256-GCM)')
