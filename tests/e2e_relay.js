// E2E: the built encrypted page, served under the real Pages origin (document intercepted), talking to the real Worker.
// usage: PAGES_PASSWORD=... node tests/e2e_relay.js   (uses ../dashboard-relay/relay.py for the agent side)
const {spawn,execFileSync}=require('child_process'),fs=require('fs'),path=require('path');
const PW=process.env.PAGES_PASSWORD;if(!PW){console.error('set PAGES_PASSWORD');process.exit(2)}
const ROOT=path.resolve(__dirname,'..'),SH=path.join(ROOT,'..','dashboard','shots');
const URL_='https://sockits.github.io/acme-post-dashboard/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let fails=0;
const ok=(n,c,x)=>{console.log((c?'PASS  ':'FAIL  ')+n+(x!==undefined?' ('+x+')':''));if(!c)fails++};
const agent=(...a)=>JSON.parse(execFileSync('python3',[path.join(ROOT,'..','dashboard-relay','relay.py'),...a],{encoding:'utf8'}));
(async()=>{
const port=9666,ch=spawn('google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars','--remote-debugging-port='+port,'--user-data-dir=/tmp/e2e'+Date.now(),'about:blank'],{stdio:'ignore'});
let tabs;for(let i=0;i<40;i++){try{tabs=await (await fetch('http://127.0.0.1:'+port+'/json')).json();if(tabs.length)break}catch(e){}await sleep(250)}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pend={};
ws.onmessage=async m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id])pend[d.id](d);
  if(d.method==='Fetch.requestPaused'){const u=d.params.request.url;
    if(u===URL_||u===URL_+'index.html'){await send('Fetch.fulfillRequest',{requestId:d.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html; charset=utf-8'}],body:fs.readFileSync(path.join(ROOT,'index.html')).toString('base64')})}
    else await send('Fetch.continueRequest',{requestId:d.params.requestId})}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
const ev=async ex=>{const r=await send('Runtime.evaluate',{expression:ex,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300));return r.result.result.value};
const waitFor=async(ex,ms=60000)=>{const t=Date.now();while(Date.now()-t<ms){try{if(await ev(ex))return true}catch(e){}await sleep(400)}return false};
await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:URL_+'*',requestStage:'Request'}]});
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:URL_});await sleep(2500);
ok('served under real Pages origin',(await ev('location.origin'))==='https://sockits.github.io');
await ev(`document.querySelector('#pw').value=${JSON.stringify(PW)};document.querySelector('#rem').checked=false;document.querySelector('#f').requestSubmit()`);
ok('unlocked (dashboard decrypted)',await waitFor("!!document.querySelector('#tracker')",90000));
ok('connection indicator is Live (CORS ok from Pages origin)',await waitFor("document.getElementById('conn').textContent==='Live'",20000));
ok('no "New posts available" banner (version matches)',await ev("document.getElementById('newbar').hidden"));
ok('tracker shows empty state',await ev("document.querySelectorAll('#trk-list .trk-it').length===0"));
await ev("document.getElementById('gen-btn').click()");
await ev("document.getElementById('gen-notes').value='test e2e request';document.getElementById('gen-by').value='e2e';document.getElementById('gen-go').click()");
ok('request appears in tracker as Queued with the 4-hour text',await waitFor("(()=>{const i=document.querySelector('#trk-list .trk-it');return i&&i.dataset.status==='queued'&&i.textContent.includes('Queued – will be picked up at the next check (about every 4 hours)')&&i.textContent.includes('test e2e request')})()",15000));
const rid=await ev("document.querySelector('#trk-list .trk-it').dataset.rid");
const pend_=agent('pending');
ok('agent sees the request via /agent/pending',pend_.requests.some(r=>r.id===rid&&r.notes==='test e2e request'&&r.by==='e2e'));
agent('status',rid,'working','test working');
ok('tracker -> Working',await waitFor(`document.querySelector('#trk-list .trk-it[data-rid="${rid}"]').dataset.status==='working'`,15000));
agent('status',rid,'failed','test');agent('update','TEST feed item','Posted by the e2e test','failed');agent('heartbeat');
ok('tracker -> Failed with message "test"',await waitFor(`(()=>{const i=document.querySelector('#trk-list .trk-it[data-rid="${rid}"]');return i.dataset.status==='failed'&&i.textContent.includes('test')})()`,15000));
ok('recent updates feed shows the update',await waitFor("document.getElementById('trk-upd').textContent.includes('TEST feed item')",15000));
ok('counts: Failed 1',await ev("document.querySelector('#trk-counts [data-s=failed] b').textContent")==='1');
ok('last check set, next check ~4h later (PT)',await ev("/PT$/.test(document.getElementById('trk-last').textContent)&&/PT$/.test(document.getElementById('trk-next').textContent)"));
await ev("document.getElementById('tracker').scrollIntoView()");await sleep(400);
fs.mkdirSync(SH,{recursive:true});
const sc=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(SH,'tracker_live.png'),Buffer.from(sc.result.data,'base64'));
console.log(fails?'\nFAILED':'\nALL PASSED');ch.kill();process.exit(fails?1:0);
})().catch(e=>{console.log('ERR',e);process.exit(2)});
