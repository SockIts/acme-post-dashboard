// v17 check: built page served under ORIGIN_URL (document intercepted) -> Live + UI Approve & schedule on a "test" card only; then reset-test.
// usage: PAGES_PASSWORD=... node tests/sched_origin_check.js [https://sockits.github.io/acme-post-dashboard/]
const {spawn,execFileSync}=require('child_process'),fs=require('fs'),path=require('path');
const PW=process.env.PAGES_PASSWORD;if(!PW){console.error('set PAGES_PASSWORD');process.exit(2)}
const ROOT=path.resolve(__dirname,'..');const URL_=process.argv[2]||'https://sockits.github.io/acme-post-dashboard/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let fails=0;const ok=(n,c,x)=>{console.log((c?'PASS  ':'FAIL  ')+n+(x!==undefined?' ('+x+')':''));if(!c)fails++};
const agent=(...a)=>JSON.parse(execFileSync('python3',[path.join(ROOT,'..','dashboard-relay','relay.py'),...a],{encoding:'utf8'}));
(async()=>{const port=9667,ch=spawn('google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port='+port,'--user-data-dir=/tmp/soc'+Date.now(),'about:blank'],{stdio:'ignore'});
try{let tabs;for(let i=0;i<40;i++){try{tabs=await (await fetch('http://127.0.0.1:'+port+'/json')).json();if(tabs.length)break}catch(e){}await sleep(250)}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const pend={};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
ws.onmessage=async m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id])pend[d.id](d);
  if(d.method==='Fetch.requestPaused'){const u=d.params.request.url;
    if(u===URL_||u===URL_+'index.html')await send('Fetch.fulfillRequest',{requestId:d.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html; charset=utf-8'}],body:fs.readFileSync(path.join(ROOT,'index.html')).toString('base64')});
    else await send('Fetch.continueRequest',{requestId:d.params.requestId})}};
const ev=async ex=>{const r=await send('Runtime.evaluate',{expression:ex,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300));return r.result.result.value};
const waitFor=async(ex,ms=60000)=>{const t=Date.now();while(Date.now()-t<ms){try{if(await ev(ex))return true}catch(e){}await sleep(400)}return false};
await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:URL_+'*',requestStage:'Request'}]});
await send('Page.navigate',{url:URL_});await sleep(2500);console.log('origin:',await ev('location.origin'));
await ev(`document.querySelector('#pw').value=${JSON.stringify(PW)};document.querySelector('#rem').checked=false;document.querySelector('#f').requestSubmit()`);
ok('unlocked',await waitFor("!!window.__dash",90000));
ok('connection indicator Live',await waitFor("document.getElementById('conn').textContent==='Live'",20000));
const TK='test-v17__sched';
const wall=await ev(`(()=>{const d=new Date(Date.now()+6*3600e3),f=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d),g=t=>f.find(x=>x.type===t).value;return g('year')+'-'+g('month')+'-'+g('day')+'T'+g('hour')+':'+g('minute')})()`);
await ev(`(()=>{const k0=Object.keys(META).find(k=>k.startsWith('2026-11-24'))||Object.keys(META)[0];META['${TK}']=JSON.parse(JSON.stringify(META[k0]));META['${TK}'].topic='TEST v17 schedule';const c=document.getElementById('c-'+k0).cloneNode(true);c.id='c-${TK}';c.dataset.key='${TK}';c.hidden=true;c.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));document.body.appendChild(c);return 1})()`);
const sres=await ev(`window.__dash.submitSched('${TK}',false,'${wall}')`);const toast=await ev("document.getElementById('toast').textContent");
ok('UI Approve & schedule succeeds',sres===true,toast);
const sp=agent('schedule-pending').requests.filter(r=>r.cardId===TK);ok('relay queued it (agent view)',sp.length===1&&sp[0].posts.length>0,sp.length&&sp[0].posts.length+' post(s), '+sp[0].posts.reduce((n,p)=>n+p.images.length,0)+' image(s)');
}catch(e){console.log('ERR',e.message);fails++}
finally{try{agent('reset-test');console.log('reset-test done; leftover test cards:',Object.keys(agent('cards').cards).filter(k=>k.startsWith('test')).length)}catch(e){console.log('reset failed',e.message)}ch.kill();process.exit(fails?1:0)}})();
