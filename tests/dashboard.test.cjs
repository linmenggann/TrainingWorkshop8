const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('dashboard.html','utf8');
const snapshot=JSON.parse(html.match(/<script id="dashboard-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
class Element {
  constructor(){this.children=[];this.style={setProperty:(k,v)=>this.style[k]=v};this.handlers={};this.textContent='';this.hidden=false;}
  setAttribute(k,v){this[k]=v;} append(...nodes){this.children.push(...nodes);} replaceChildren(){this.children=[];}
  addEventListener(k,fn){this.handlers[k]=fn;}
}
function page(fetcher){
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));elements['dashboard-data'].textContent=JSON.stringify(snapshot);
  const calls=[];let timeout;
  const ctx=vm.createContext({document:{getElementById:id=>elements[id],createElement:()=>new Element()},Intl,URL,AbortController,
    setTimeout:fn=>{timeout=fn;return 1;},clearTimeout(){},
    fetch:async(url,options)=>{calls.push({url,options});return fetcher?fetcher(url,options):{ok:true,json:async()=>({ok:true,service:'workshop-registration',version:1})};}});
  vm.runInContext(source.replace(/\nrefreshDashboard\(\);\s*$/, '\nglobalThis.startup=refreshDashboard();'),ctx);
  return {ctx,elements,calls,timeout:()=>timeout()};
}
test('current snapshot renders four registrations, proportions, professions and seven daily bars',async()=>{
  const p=page();await p.ctx.startup;
  assert.match(p.elements['capacity-status'].textContent,/額滿/);assert.equal(p.elements.total.textContent,'4');assert.equal(p.elements.onsite.textContent,'2');assert.equal(p.elements.online.textContent,'2');assert.equal(p.elements.institutions.textContent,'4');
  assert.equal(p.elements['director-percent'].textContent,'50%');assert.equal(p.elements.professions.children.length,12);assert.equal(p.elements.trend.children.length,7);assert.equal(p.elements.trend.children.at(-1).children[0].textContent,'4');
});
test('old deployment health response keeps timestamped snapshot and never reports fresh data',async()=>{
  const p=page();await p.ctx.startup;assert.equal(p.elements['source-badge'].textContent,'擷取快照');assert.match(p.elements.status.textContent,/尚未取得最新/);assert.equal(p.elements.refresh.disabled,false);
  assert.equal(new URL(p.calls[0].url).searchParams.get('action'),'dashboard');assert.equal(p.calls[0].options.method,'GET');assert.equal(p.calls[0].options.body,undefined);
});
test('valid fresh summary replaces snapshot; empty sheets render zero without NaN',async()=>{
  const result=JSON.parse(JSON.stringify(snapshot));const s=result.summary;s.generatedAt='2026-09-08T00:00:00Z';s.total=0;s.institutionCount=0;
  for(const counts of [s.attendanceCounts,s.directorCounts])for(const key of Object.keys(counts))counts[key]=0;
  s.professionCounts.forEach(p=>p.count=0);s.dailyCounts=[];s.lastRegistrationAt=null;
  const p=page(async()=>({ok:true,json:async()=>result}));await p.ctx.startup;
  assert.match(p.elements['capacity-status'].textContent,/剩餘 4 名/);assert.equal(p.elements.total.textContent,'0');assert.equal(p.elements['source-badge'].textContent,'已更新');assert.equal(p.elements['director-percent'].textContent,'0%');assert.equal(p.elements['empty-state'].hidden,false);assert.equal(p.elements['attendance-chart'].style.background,'#ffffff18');
});
test('network, invalid JSON and invalid totals retain existing data',async()=>{
  const bad=JSON.parse(JSON.stringify(snapshot));bad.summary.total=99;
  for(const fn of [async()=>{throw Error('offline');},async()=>({ok:false}),async()=>({ok:true,json:async()=>{throw Error('html');}}),async()=>({ok:true,json:async()=>bad})]){
    const p=page(fn);await p.ctx.startup;assert.equal(p.elements.total.textContent,'4');assert.match(p.elements.status.textContent,/保留/);assert.equal(p.elements.refresh.disabled,false);
  }
});
test('older snapshots do not overwrite more recent data',async()=>{
  const old=JSON.parse(JSON.stringify(snapshot));old.summary.generatedAt='2026-09-06T00:00:00Z';const p=page(async()=>({ok:true,json:async()=>old}));await p.ctx.startup;assert.equal(p.elements['source-badge'].textContent,'擷取快照');assert.match(p.elements.status.textContent,/尚未取得/);
});
test('timeout preserves snapshot and simultaneous refresh is ignored',async()=>{
  const p=page((url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('timeout')))));
  await p.ctx.refreshDashboard();assert.equal(p.calls.length,1);p.timeout();await p.ctx.startup;assert.equal(p.elements.total.textContent,'4');assert.equal(p.elements.refresh.disabled,false);
});
