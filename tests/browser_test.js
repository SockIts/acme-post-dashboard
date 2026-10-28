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
ok('login page shown with test-mode banner',(await ev('document.querySelector(".testbar").innerText')).includes('Test mode: nothing is posted automatically'));
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
ok('12 cards rendered',(await ev(`document.querySelectorAll('.slot').length`))===12);
ok('"Test mode" banner on dashboard',(await ev('document.querySelector(".testbar").innerText')).includes('nothing is posted automatically'));
ok('static-site note visible (exact text)',(await ev('document.querySelector("#static-note").innerText')).includes('Static test site: Approved, Post Date and comments are saved in this browser only. Use Export comments to share.'));
ok('no "scheduling not active" leftovers',!(await ev('document.body.innerText')).toLowerCase().includes('scheduling not active'));
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
// ---- persistence: Approved / Post Date / comment
await ev(`(()=>{const s=document.querySelector('.slot[data-key="${K}"]');const cb=s.querySelector('input.ap');cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await ev(`(()=>{const s=document.querySelector('.slot[data-key="${K}"]');const d=s.querySelector('input.pdate');d.value='2099-12-31T16:45';d.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await ev(`window.__dash.openCard('${K}',false)`);await sleep(400);
await ev(`(()=>{const c=document.getElementById('c-${K}');c.querySelector('textarea').value='Persisted test comment';c.querySelector('button.save').click()})()`);
ok('future date is NOT due',await ev(`!window.__dash.dueOf('${K}')&&document.getElementById('due-bar').hidden`));
await go(BASE);
ok('after reload: login page again (no plaintext persisted)',await ev('!!document.querySelector("#pw")&&!document.querySelector(".card")'));
await unlock(PW,false);await waitFor(`!!window.__dash`);
const p=await ev(`(()=>{const o=window.__dash.load('${K}');return JSON.stringify({a:o.approved,p:o.postDate,c:(o.comments||[]).map(c=>c.text)})})()`);
ok('Approved/Post Date/comment persisted across reload + re-decrypt',p===JSON.stringify({a:true,p:'2099-12-31T16:45',c:['Persisted test comment']}),p);
ok('UI reflects persisted state',await ev(`(()=>{const s=document.querySelector('.slot[data-key="${K}"]');return s.querySelector('input.ap').checked&&s.querySelector('input.pdate').value==='2099-12-31T16:45'&&s.querySelector('.sched-tag').innerText.includes('Scheduled')})()`));
// ---- Due now: past date
const K2='2026-10-29__highlight';
await ev(`(()=>{const s=document.querySelector('.slot[data-key="${K2}"]');const cb=s.querySelector('input.ap');cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));const d=s.querySelector('input.pdate');d.value='2026-10-28T08:00';d.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await sleep(500);
ok('past Post Date -> red Due now bar visible',await ev(`!document.getElementById('due-bar').hidden&&document.getElementById('due-list').children.length===1`));
ok('tab title shows (1 DUE)',(await ev('document.title')).startsWith('(1 DUE)'));
ok('Due bar has Open in X link(s) to x.com intent',(await ev(`[...document.querySelectorAll('#due-list a')].filter(a=>a.href.startsWith('https://x.com/intent/post?text=')).length`))>=1);
ok('card flagged due',await ev(`document.querySelector('.slot[data-key="${K2}"]').classList.contains('due')&&document.querySelector('.slot[data-key="${K2}"] .sched-tag').innerText.includes('DUE NOW')`));
await shot('dashboard_due_now.png',1440,900,false);
await ev(`document.querySelector('#due-list button:last-child').click()`);await sleep(400);
ok('Mark posted clears Due now',await ev(`document.getElementById('due-bar').hidden&&!window.__dash.dueOf('${K2}')`));
// ---- 30 s timer: becomes due without reload
const K3='2026-10-31__overview';
const nowPT=await ev(`window.__dash.ptNow()`);
const d=new Date(Date.UTC(+nowPT.slice(0,4),+nowPT.slice(5,7)-1,+nowPT.slice(8,10),+nowPT.slice(11,13),+nowPT.slice(14,16)+1));
const when=d.toISOString().slice(0,16);
await ev(`(()=>{const s=document.querySelector('.slot[data-key="${K3}"]');const cb=s.querySelector('input.ap');cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));const d=s.querySelector('input.pdate');d.value='${when}';d.dispatchEvent(new Event('change',{bubbles:true}))})()`);
ok('post date ~1 min ahead (PT '+when+') not yet due',await ev(`!window.__dash.dueOf('${K3}')`));
t0=Date.now();ok('30 s timer flips it to Due now without any reload',await waitFor(`!document.getElementById('due-bar').hidden`,110000),Math.round((Date.now()-t0)/1000)+' s');
await ev(`document.querySelector('#due-list button:last-child').click()`);
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
