#!/usr/bin/env python3
"""Build the password-protected static site (index.html) for GitHub Pages.

  PAGES_PASSWORD='<shared password>' python3 build_pages.py [path/to/acme-post-dashboard.html]

Reads the (unencrypted) dashboard HTML, patches it for static hosting (note, test banner, client-side
"Due now" check), gzips it, encrypts it with AES-256-GCM (key = PBKDF2-HMAC-SHA256, 1,000,000 iterations,
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

NOTE = 'Static test site: Approved, Post Date and comments are saved in this browser only. Use Export comments to share.'
html = re.sub(r'<div class="localnote">.*?</div></header>',
              lambda m: '<div class="localnote" id="static-note"><b>' + NOTE + '</b> Nothing is posted automatically: when an approved card\'s Post Date passes (Pacific time) while this tab is open, a red <b>Due now</b> bar appears and you post it yourself with Open in X. <button class="btn sm" id="lock-btn" type="button">Lock</button></div></header>',
              html, count=1, flags=re.S)
assert 'id="static-note"' in html
rep('<body>\n<header class="top">', '<body>\n<div class="testbar">Test mode: nothing is posted automatically. Open in X only prefills a compose window; you press Post yourself.</div>\n<header class="top">')
rep('<main>\n', '<main>\n<div id="due-bar" hidden role="alert"><h3>Due now <span id="due-n">0</span></h3><div id="due-list"></div><div class="muted tiny" style="color:#ffb3b6">Checked every 30 s while this tab is open. Nothing is posted for you: press Open in X, then Post in X.</div></div>\n')
rep('</style>', '''.testbar{background:#3a2c0b;border-bottom:2px solid #e3b341;color:#ffd666;font-size:13.5px;font-weight:600;padding:8px 20px;text-align:center}
#due-bar{max-width:1440px;margin:10px auto 0;background:#4a1216;border:2px solid #e5484d;border-radius:10px;padding:10px 14px;color:#ffd1d3}
#due-bar[hidden]{display:none}
#due-bar h3{margin:0 0 6px;font-size:15px;color:#fff}
.due-item{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:6px 0;border-top:1px solid #7a2227;flex-wrap:wrap}.due-item:first-of-type{border-top:0}
.due-b{display:flex;gap:6px;flex-wrap:wrap}
.slot.due{outline:3px solid #e5484d;box-shadow:0 0 0 4px rgba(229,72,77,.25)}
.sched-tag.due{color:#fff;background:#8a1c22;border-color:#e5484d;font-weight:700}
.sched-tag.due .not-live{color:#ffd1d3;font-weight:400}
</style>''')
# JS patches
rep("s.classList.toggle('approved',ap);", "s.classList.toggle('approved',ap);s.classList.toggle('due',dueOf(k));")
rep("""    if(pd){tag.className='sched-tag';tag.innerHTML='';tag.append('Scheduled: '+fmtPD(pd));const nl=document.createElement('span');nl.className='not-live';nl.textContent='Scheduling not active yet (UI only, nothing will post)';tag.appendChild(nl)}
    else{tag.className='sched-tag warn';tag.textContent='Approved, but no Post Date set. Scheduling not active yet.'}}""",
"""    if(pd&&dueOf(k)){tag.className='sched-tag due';tag.innerHTML='';tag.append('DUE NOW: '+fmtPD(pd));const nl=document.createElement('span');nl.className='not-live';nl.textContent='Open the card, press Open in X on each post, then mark it posted.';tag.appendChild(nl)}
    else if(pd){tag.className='sched-tag';tag.innerHTML='';tag.append('Scheduled: '+fmtPD(pd));const nl=document.createElement('span');nl.className='not-live';nl.textContent='Becomes Due now at that time while this tab is open. Nothing posts automatically.';tag.appendChild(nl)}
    else{tag.className='sched-tag warn';tag.textContent='Approved, but no Post Date set: it will never become due.'}}""")
rep("$('#n-comments').textContent=cm;applyFilter();", "$('#n-comments').textContent=cm;applyFilter();renderDue();")
rep("function refresh(){", r"""function ptNow(){return new Date().toLocaleString('sv-SE',{timeZone:'America/Los_Angeles'}).slice(0,16).replace(' ','T')}
function dueOf(k){const st=status(k),pd=postDateOf(k);return approvedOf(k)&&!!pd&&st!=='Posted'&&st!=='Skip'&&pd<=ptNow()}
let lastDueN=0;
function renderDue(){
  const bar=$('#due-bar'),keys=Object.keys(META).filter(dueOf).sort((a,b)=>postDateOf(a).localeCompare(postDateOf(b)));
  bar.hidden=!keys.length;const l=$('#due-list');l.innerHTML='';
  keys.forEach(k=>{const m=META[k],d=document.createElement('div');d.className='due-item';
    d.innerHTML='<span class="due-t"></span><span class="due-b"></span>';
    $('.due-t',d).textContent=m.type+' · '+m.topic+' · due '+fmtPD(postDateOf(k));
    const b=$('.due-b',d),card=document.getElementById('c-'+k),links=card?$$('a.xopen',card):[];
    links.forEach((a,i)=>{const x=document.createElement('a');x.className='btn sm primary';x.target='_blank';x.rel='noopener';x.href=a.href;x.textContent=links.length>1?'Open post '+(i+1)+' in X':'Open in X';b.appendChild(x)});
    const oc=document.createElement('button');oc.type='button';oc.className='btn sm';oc.textContent='Open card';oc.onclick=()=>{if(cur!==k)openCard(k);else $('#sec-exp').scrollIntoView({behavior:'smooth'})};b.appendChild(oc);
    const mp=document.createElement('button');mp.type='button';mp.className='btn sm';mp.textContent='Mark posted';mp.onclick=()=>{const o=load(k);o.status='Posted';save(k,o);refresh();toast('Marked as posted')};b.appendChild(mp);
    l.appendChild(d)});
  $('#due-n').textContent=keys.length;
  document.title=(keys.length?'('+keys.length+' DUE) ':'')+'ACME Content Dashboard';
  $$('.slot').forEach(s=>s.classList.toggle('due',dueOf(s.dataset.key)));
  lastDueN=keys.length;
}
setInterval(refresh,30000);
window.addEventListener('storage',e=>{if(e.key&&e.key.indexOf(PFX)===0)refresh()});
$('#lock-btn').onclick=()=>{try{localStorage.removeItem('acme-pages-key')}catch(e){}location.reload()};
function refresh(){""")
rep("toast(t.checked?'Approved (UI only, scheduling not active yet)':'Approval removed')", "toast(t.checked?'Approved (saved in this browser only; nothing posts automatically)':'Approval removed')")
rep("toast('Post Date saved (UI only)')", "toast('Post Date saved in this browser (Pacific time)')")
rep("' (Pacific time; UI only, scheduling not active yet)'", "' (Pacific time; saved in the exporter\\'s browser; nothing posts automatically)'")
rep("schedulingActive:false", "schedulingActive:false,staticTestSite:true")
rep("window.__dash={load,", "window.__dash={dueOf,renderDue,ptNow,load,")
leftover = [m.group(0) for m in re.finditer(r'.{40}[Ss]cheduling (?:is )?not active.{40}', html)]
if leftover:
    print('note: leftover wording:', leftover[:3])

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
