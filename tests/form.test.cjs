const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html','utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ENDPOINT='https://script.google.com/macros/s/test_deployment/exec';
const fixture={name:'測試使用者',organization:'測試機構',title:'測試職稱',profession:'護理',director:'是',attendance:'線上',email:'test@example.com',phone:'0912345678'};
class Element {
  constructor(){this.handlers={};this.children=[];this.textContent='';this.disabled=false;this.hidden=false;}
  addEventListener(name,fn){this.handlers[name]=fn;}
  emit(name,event={preventDefault(){}}){return this.handlers[name]?.(event);}
  append(...children){this.children.push(...children);}
  replaceChildren(){this.children=[];}
  setAttribute(){} removeAttribute(){} setCustomValidity(){}
  showModal(){this.open=true;} close(){this.open=false;}
}
function page({endpoint=ENDPOINT,fetcher}={}){
  const ids=['workshop-form','preview','send-registration','edit-registration','submission-status','form-status','summary','preview-title','preview-description'];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  const form=elements['workshop-form']; const initialButton=new Element();
  const values={...fixture}; const inputs=['name','title','organization','email','phone'].map(key=>{const input=new Element();Object.defineProperty(input,'value',{get:()=>values[key],set:v=>values[key]=v});return input;});
  form.querySelectorAll=()=>inputs; form.querySelector=()=>initialButton;form.reportValidity=()=>true;
  form.reset=()=>{form.resetCount=(form.resetCount||0)+1;};
  const requests=[];let timer;
  const context=vm.createContext({
    document:{getElementById:id=>elements[id],createElement:()=>new Element()},
    FormData:class{get(key){return values[key];}},URLSearchParams,AbortController,
    crypto:require('node:crypto').webcrypto,Uint8Array,
    setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){},
    fetch:async(url,options)=>{requests.push({url,options});return fetcher?fetcher(url,options):{ok:true,json:async()=>({ok:true,requestId:options.body.get('requestId')})};}
  });
  vm.runInContext(script.replace(/const APPS_SCRIPT_URL = [^;]*;/,'const APPS_SCRIPT_URL = '+JSON.stringify(endpoint)+';'),context);
  return {elements,values,requests,form,open:()=>form.emit('submit'),send:()=>elements['send-registration'].emit('click'),timeout:()=>timer()};
}
test('empty or invalid endpoint allows preview but blocks all network writes',async()=>{
  for(const endpoint of ['', 'https://docs.google.com/spreadsheets/d/example/edit']){const p=page({endpoint});p.open();assert.equal(p.elements['send-registration'].disabled,true);await p.send();assert.equal(p.requests.length,0);assert.match(p.elements['submission-status'].textContent,/尚未啟用/);}
});
test('confirmation uses a POST body and only matching server receipt shows success',async()=>{
  const p=page();p.open();assert.equal(p.requests.length,0);await p.send();
  const {url,options}=p.requests[0];assert.equal(url,ENDPOINT);assert.equal(options.method,'POST');assert.equal(options.mode,'cors');assert.equal(options.redirect,'follow');assert.equal(options.credentials,'omit');assert.equal(options.body.get('email'),fixture.email);assert.equal(options.headers,undefined);
  assert.match(p.elements['preview-title'].textContent,/已收件/);assert.equal(p.form.resetCount,1);assert.equal(p.elements['send-registration'].hidden,true);
});
test('uncertain network result retains values and retries with identical UUID',async()=>{
  let count=0;const p=page({fetcher:async(url,options)=>{if(++count===1)throw Error('network');return {ok:true,json:async()=>({ok:true,duplicate:true,requestId:options.body.get('requestId')})};}});
  p.open();await p.send();assert.equal(p.form.resetCount,undefined);assert.equal(p.values.phone,fixture.phone);assert.match(p.elements['submission-status'].textContent,/尚未收到/);await p.send();
  assert.equal(p.requests[0].options.body.get('requestId'),p.requests[1].options.body.get('requestId'));assert.equal(p.form.resetCount,1);
});
test('HTTP error, invalid JSON, opaque-like and mismatched responses never show success',async()=>{
  for(const response of [{ok:false},{ok:true,json:async()=>{throw Error('not JSON');}},{ok:true,json:async()=>({ok:true,requestId:'wrong'})},{ok:true,json:async()=>({status:'received'})}]){
    const p=page({fetcher:async()=>response});p.open();await p.send();assert.equal(p.form.resetCount,undefined);assert.match(p.elements['submission-status'].textContent,/尚未收到/);assert.equal(p.elements['send-registration'].disabled,false);
  }
});
test('server rejection retains form and displays actionable error',async()=>{
  const p=page({fetcher:async()=>({ok:true,json:async()=>({ok:false,code:'HEADER_MISMATCH'})})});p.open();await p.send();assert.match(p.elements['submission-status'].textContent,/報名表設定有誤/);assert.equal(p.form.resetCount,undefined);
});
test('sending locks buttons, blocks second submission and escape until response',async()=>{
  let resolve;const p=page({fetcher:()=>new Promise(r=>resolve=r)});p.open();const first=p.send();await p.send();assert.equal(p.requests.length,1);assert.equal(p.elements['edit-registration'].disabled,true);
  let prevented=false;p.elements.preview.emit('cancel',{preventDefault(){prevented=true;}});assert.equal(prevented,true);
  resolve({ok:true,json:async()=>({ok:true,requestId:p.requests[0].options.body.get('requestId')})});await first;assert.equal(p.elements['edit-registration'].disabled,false);
});
test('timeout is uncertain and unlocks retry without clearing data',async()=>{
  const p=page({fetcher:(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))))});p.open();const sending=p.send();p.timeout();await sending;
  assert.match(p.elements['submission-status'].textContent,/資料可能已送達/);assert.equal(p.form.resetCount,undefined);assert.equal(p.elements['send-registration'].disabled,false);
});
test('same preview retains UUID; changed data generates another; user text remains text',async()=>{
  const p=page({fetcher:async()=>{throw Error('offline');}});p.values.name='<img src=x onerror=alert(1)>';p.open();assert.equal(p.elements.summary.children[0].children[1].textContent,p.values.name);await p.send();
  p.open();await p.send();assert.equal(p.requests[0].options.body.get('requestId'),p.requests[1].options.body.get('requestId'));
  p.values.phone='0987654321';p.open();await p.send();assert.notEqual(p.requests[1].options.body.get('requestId'),p.requests[2].options.body.get('requestId'));
});
