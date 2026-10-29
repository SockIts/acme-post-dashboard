// Headless Chrome end-to-end test for the encrypted static site.
// usage: PAGES_PASSWORD='<shared password>' SHOTS=/path/to/shots node tests/browser_test.js   (node >= 22, google-chrome)
const {spawn}=require('child_process'),fs=require('fs'),path=require('path'),http=require('http');
const PW=process.env.PAGES_PASSWORD;if(!PW){console.error('set PAGES_PASSWORD');process.exit(2)}
const ROOT=path.resolve(__dirname,'..'),SHOTS=process.env.SHOTS||path.join(ROOT,'..','dashboard-pages-shots');fs.mkdirSync(SHOTS,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let fails=0;
const ok=(n,c,x)=>{console.log((c?'PASS  ':'FAIL  ')+n+(x!==undefined?' ('+x+')':''));if(!c)fails++};
const srv=http.createServer((q,s)=>{if(q.url.split('?')[0]!=='/'&&q.url.split('?')[0]!=='/index.html'){s.writeHead(404);return s.end()}s.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});fs.createReadStream(path.join(ROOT,'index.html')).pipe(s)});
(async()=>{
await new Promise(r=>srv.listen(0,'127.0.0.1',r));const BASE='http://127.0.0.1:'+srv.address().port+'/';
const port=9555,prof='/tmp/pages'+Date.now();
const ch=spawn('google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars','--remote-debugging-port='+port,'--user-data-dir='+prof,'about:blank'],{stdio:'ignore'});
let tabs;for(let i=0;i<40;i++){try{tabs=await (await fetch('http://127.0.0.1:'+port+'/json')).json();if(tabs.length)break}catch(e){}await sleep(250)}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pend={};ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id])pend[d.id](d)};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
const ev=async ex=>{const r=await send('Runtime.evaluate',{expression:ex,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,400));return r.result.result.value};
await send('Page.enable');
const go=async u=>{await send('Page.navigate',{url:u});await sleep(1500)};
const shot=async(name,w,h,full)=>{await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<600});await sleep(500);
  if(full){const H=await ev('document.documentElement.scrollHeight');await send('Emulation.setDeviceMetricsOverride',{width:w,height:Math.min(H,5000),deviceScaleFactor:1,mobile:w<600});await sleep(800)}
  const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(SHOTS,name),Buffer.from(r.result.data,'base64'));console.log('      shot',name)};
const waitFor=async(ex,ms=60000)=>{const t=Date.now();while(Date.now()-t<ms){try{if(await ev(ex))return true}catch(e){}await sleep(400)}return false};
const unlock=async(pw,rem)=>{await ev(`document.querySelector('#pw').value=${JSON.stringify(pw)};document.querySelector('#rem').checked=${!!rem};document.querySelector('#f').requestSubmit()`)};
const K='2026-10-30__technical';
// ---- login page + wrong password
await go(BASE);
ok('login page shown with test-mode banner',(await ev('document.querySelector(".testbar").innerText')).includes('Test mode: drafts only. Nothing is posted automatically.'));
ok('login page is dark by default (first visit)',await ev("document.documentElement.classList.contains('dark')&&getComputedStyle(document.body).backgroundColor==='rgb(17, 19, 21)'"));
ok('remember me is OFF by default',await ev('document.querySelector("#rem").checked===false'));
ok('no dashboard content before unlock',await ev('!document.querySelector(".card,.slot,#sec-cards")'));
await shot('login.png',1000,700,false);
let t0=Date.now();await unlock('definitely-wrong');
ok('wrong password -> error message',await waitFor(`document.querySelector('#err').innerText.includes('Wrong password')`),(Date.now()-t0)+' ms');
ok('wrong password -> still no content',await ev('!document.querySelector(".card,.slot,#sec-cards")&&document.body.innerText.length<800'));
await shot('login_wrong_password.png',1000,700,false);
// ---- correct password
t0=Date.now();await unlock(PW,false);
ok('correct password unlocks dashboard (11 MB payload)',await waitFor(`!!window.__dash&&document.querySelectorAll('.slot').length>=12`),(Date.now()-t0)+' ms');
ok('dashboard is dark by default after unlock',await ev("document.documentElement.classList.contains('dark')&&getComputedStyle(document.body).backgroundColor==='rgb(17, 19, 21)'"));
ok('12 cards rendered',(await ev(`document.querySelectorAll('.slot').length`))===12);
ok('"Test mode" banner on dashboard',(await ev('document.querySelector(".testbar").innerText')).includes('Nothing is posted automatically'));
ok('new Drafts-only wording present',(await ev('document.querySelector("#static-note").innerText')).includes('Drafts only: nothing is posted automatically. After posting on X, tick Posted and paste the link.'));
ok('static-site note visible (exact text)',(await ev('document.querySelector("#static-note").innerText')).includes('Static test site: Posted links, comments and requests are saved in this browser only. Use Export comments to share.'));
ok('no scheduling / Due now / Approved checkbox / date pickers left',await ev(`!document.querySelector('input.ap,input.pdate,#due-bar,.sched-tag')&&!/Due now|Post Date|scheduling not active/i.test(document.body.innerText)`));
ok('header chips (All + 11) + Generate button + Offline pill present',await ev(`!!document.getElementById('gen-btn')&&document.querySelectorAll('.fchip').length===12&&document.getElementById('conn').textContent==='Offline (copy mode)'`));
ok('all images loaded (none broken)',await ev(`[...document.images].filter(i=>i.id!=='lb-img').every(i=>i.complete&&i.naturalWidth>0)`),await ev('(document.images.length-1)+" images (lightbox placeholder excluded)"'));
ok('localStorage remember key not stored (remember off)',(await ev(`localStorage.getItem('acme-pages-key')`))===null);
await shot('dashboard_unlocked.png',1440,900,false);
// thread expansion
const thr=await ev(`(()=>{for(const k of Object.keys(META)){if(document.getElementById('c-'+k).querySelectorAll('.tpost').length>1)return k}return null})()`);
ok('a thread card exists',!!thr,thr);
await ev(`window.__dash.openCard('${thr}',false)`);await sleep(600);
const n=await ev(`document.querySelectorAll('#panel .tpost').length`);
ok('thread expands in bottom "Expanded posts" section with every post',n>1&&await ev(`document.getElementById('sec-exp').contains(document.querySelector('#panel .tpost'))`),n+' posts');
ok('each post has an Open in X intent button',(await ev(`document.querySelectorAll('#panel a.xopen[href^="https://x.com/intent/post?text="]').length`))===n);
ok('Copy full thread button present',await ev(`!!document.querySelector('#panel .copyall')`));
ok('Export comments works',(await ev(`document.getElementById('export').click();document.getElementById('ex-t').value`)).startsWith('ACME Content Dashboard: comments export'));
await ev(`document.getElementById('ex-close').click()`);
await shot('dashboard_thread_expanded.png',1440,900,true);
// ---- Posted + link, chips, generate panel, persistence
const X1='https://x.com/ACMEonBTC/status/1234567890123456789';
const slot=k=>`document.querySelector('.slot[data-key="${k}"]')`;
const change=(sel)=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await ev(`(()=>{const c=${slot(K)}.querySelector('input.pst');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}))})()`);
ok('Posted without a link is refused ("Paste the post link")',await ev(`!${slot(K)}.querySelector('input.pst').checked&&${slot(K)}.querySelector('.perr').textContent==='Paste the post link'&&!${slot(K)}.querySelector('.perr').hidden`));
await ev(`(()=>{const i=${slot(K)}.querySelector('input.purl');i.value='https://example.com/status/12';i.dispatchEvent(new Event('change',{bubbles:true}))})()`);
ok('non-X link is rejected',await ev(`!${slot(K)}.querySelector('.perr').hidden&&!window.__dash.load('${K}').postUrl`));
await ev(`(()=>{const i=${slot(K)}.querySelector('input.purl');i.value='${X1}';i.dispatchEvent(new Event('change',{bubbles:true}));const c=${slot(K)}.querySelector('input.pst');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}))})()`);
ok('valid x.com link + Posted: green outline, Posted tag, View on X link',await ev(`(()=>{const s=${slot(K)},a=s.querySelector('.posted-tag a.vx');return s.classList.contains('posted')&&a&&a.href==='${X1}'&&getComputedStyle(s).boxShadow!=='none'})()`));
await ev(`window.__dash.openCard('${K}',false)`);await sleep(400);
await ev(`(()=>{const c=document.getElementById('c-${K}');c.querySelector('textarea.cm-t').value='Persisted test comment';c.querySelector('button.save').click()})()`);
ok('expanded card shows the same Posted + link',await ev(`(()=>{const c=document.querySelector('#panel .card[data-key="${K}"]');return c.querySelector('input.pst').checked&&c.querySelector('input.purl').value==='${X1}'})()`));
ok('Posted chip filters to the posted card; counts match',await ev(`(()=>{document.querySelector('.fchip[data-g="state"][data-v="posted"]').click();const v=document.querySelectorAll('.slot:not(.hid)').length,n=document.querySelector('.fchip[data-g="state"][data-v="posted"] b').textContent;document.getElementById('chip-all').click();return v===1&&n==='1'&&document.querySelectorAll('.slot:not(.hid)').length===12})()`));
await ev(`document.getElementById('gen-btn').click()`);
await ev(`(()=>{const n=document.getElementById('gen-notes');n.value='pages test notes';n.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('gen-go').click()})()`);await sleep(400);
const rq=await ev(`document.getElementById('gen-req').value`);
ok('Generate panel builds "Generate 3 new posts for <date>, notes: ..., types: ..."',/^Generate 3 new posts for \d{4}-\d{2}-\d{2}, notes: pages test notes, types: /.test(rq),rq.split('\n')[0]);
ok('"Requested – waiting for agent" placeholder card appears',await ev(`!!document.querySelector('#req-list .rslot')&&document.querySelector('#req-list').innerText.includes('Requested – waiting for agent')`));
ok('no relay configured -> copy mode, no network calls to a relay',await ev(`window.__dash.config.API_BASE===''&&window.__dash.config.API_TOKEN===''`));
await shot('dashboard_generate.png',1440,900,false);
await go(BASE);
ok('after reload: login page again (no plaintext persisted)',await ev('!!document.querySelector("#pw")&&!document.querySelector(".card")'));
await unlock(PW,false);await waitFor(`!!window.__dash`);
const p=await ev(`(()=>{const o=window.__dash.load('${K}');return JSON.stringify({p:o.posted,u:o.postUrl,c:(o.comments||[]).map(c=>c.text)})})()`);
ok('Posted + link + comment persisted across reload + re-decrypt',p===JSON.stringify({p:true,u:X1,c:['Persisted test comment']}),p);
ok('UI reflects persisted state; placeholder request persisted',await ev(`(()=>{const s=${slot(K)};return s.querySelector('input.pst').checked&&s.querySelector('input.purl').value==='${X1}'&&s.classList.contains('posted')&&window.__dash.requests().length===1})()`));
ok('history merge: 12 cards (data.json days + history.json), Load older hidden (no older days yet)',await ev(`document.querySelectorAll('.slot').length===12&&document.getElementById('more-older').hidden`));
await ev(`localStorage.removeItem('acme-dash:v1:__requests')`);
// ---- remember me
await ev(`localStorage.removeItem('acme-pages-key')`);await go(BASE);await unlock(PW,true);await waitFor(`!!window.__dash`);
ok('remember me ON stores key (not the password)',(await ev(`localStorage.getItem('acme-pages-key')`)||'').length>20&&!(await ev(`JSON.stringify(localStorage)`)).includes(PW));
await go(BASE);ok('auto-unlock when remembered',await waitFor(`!!window.__dash&&document.querySelectorAll('.slot').length===12`));
await ev(`document.getElementById('lock-btn').click()`);await sleep(1800);
ok('Lock forgets key and returns to login',await waitFor(`!!document.querySelector('#pw')`)&&(await ev(`localStorage.getItem('acme-pages-key')`))===null);
// mobile shot
await unlock(PW,false);await waitFor(`!!window.__dash`);
await shot('dashboard_mobile.png',420,800,false);
ch.kill();srv.close();console.log(fails?('FAILED: '+fails):'ALL BROWSER CHECKS PASSED');process.exit(fails?1:0);
})();
