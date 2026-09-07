const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('apps-script/Code.gs', 'utf8');
const headers = fs.readFileSync('apps-script/headers.tsv', 'utf8').trim().split('\t');
const valid = {action:'register',requestId:'12345678-1234-4123-8123-123456789abc',name:'測試使用者',organization:'測試機構',title:'測試職稱',profession:'護理',director:'是',attendance:'實體',email:'test@example.com',phone:'06-0123456 分機 123'};
function service(options = {}) {
  const rows = options.rows || [headers.slice()];
  let releases = 0, writes = 0, flushes = 0;
  const sheet = {
    getLastRow: () => rows.length, getMaxRows: () => 1000,
    setFrozenRows(){}, setColumnWidths(){}, setColumnWidth(){},
    getRange(row, col, height, width) {
      const range = {
        getValues: () => Array.from({length:height}, (_, i) => Array.from({length:width}, (_, j) => rows[row-1+i]?.[col-1+j] ?? '')),
        setValues(values){ writes++; values.forEach((valuesRow,i)=>{ rows[row-1+i] ||= []; valuesRow.forEach((v,j)=>rows[row-1+i][col-1+j]=v); }); return range; },
        createTextFinder(id){ const finder = {matchEntireCell:()=>finder,matchCase:()=>finder,useRegularExpression:()=>finder,findNext:()=>rows.slice(row-1,row-1+height).find(r=>r[col-1]===id) || null}; return finder; }
      };
      for (const name of ['setNumberFormat','setBackground','setFontColor','setFontWeight','setWrap']) range[name] = () => range;
      return range;
    }
  };
  const context = vm.createContext({
    LockService:{getScriptLock:()=>({tryLock:()=>!options.busy,waitLock(){},releaseLock(){releases++;}})},
    SpreadsheetApp:{
      openById(id){assert.equal(id,'1uiACPGdC3mS-bR1mxh_TukK31rS7Z7fcrtqiuKSBkWI'); return {getSheetByName(name){assert.equal(name,'工作坊報名資料');return options.missing ? null : sheet;},insertSheet:()=>sheet};},
      flush(){flushes++; if(options.failFirstFlush && flushes===1) throw Error('private service details');}
    },
    Utilities:{formatDate:(date, zone, format)=>{assert.equal(zone,'Asia/Taipei');assert.equal(format,'yyyy/MM/dd HH:mm:ss');return '2026/09/07 09:30:00';}},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:text=>({setMimeType:()=>text})}
  });
  vm.runInContext(source,context);
  const post = (p={...valid}, extra={}) => JSON.parse(context.doPost({parameter:p,parameters:Object.fromEntries(Object.entries(p).map(([k,v])=>[k,[v]])),postData:{type:'application/x-www-form-urlencoded',contents:new URLSearchParams(p).toString()},contentLength:1000,...extra}));
  return {post,rows,context,get releases(){return releases;},get writes(){return writes;}};
}
test('writes all eight fields in header order, keeps phone zero and Taipei timestamp',()=>{
  const s=service(); const result=s.post(); assert.equal(result.ok,true);
  assert.deepEqual(s.rows[1],['2026/09/07 09:30:00',valid.name,valid.organization,valid.title,valid.profession,valid.director,valid.attendance,valid.email,valid.phone,valid.requestId]);
  assert.equal(s.releases,1);
});
test('same request ID retries produce one row',()=>{const s=service();s.post();assert.equal(s.post().duplicate,true);assert.equal(s.rows.length,2);assert.equal(s.writes,1);});
test('flush uncertainty can retry without adding a second row',()=>{const s=service({failFirstFlush:true});assert.equal(s.post().ok,false);assert.equal(s.post().ok,true);assert.equal(s.rows.length,2);assert.equal(s.releases,2);});
test('every required field rejects whitespace; invalid input never writes',()=>{
  for(const key of ['name','organization','title','profession','director','attendance','email','phone']){const s=service();assert.equal(s.post({...valid,[key]:'   '}).code,'VALIDATION_ERROR');assert.equal(s.writes,0);}
});
test('rejects unknown enums, malformed email, long name, control characters and UUID',()=>{
  for(const changes of [{profession:'醫師'},{director:'也許'},{attendance:'混合'},{email:'invalid'},{name:'a'.repeat(81)},{name:'a\nb'},{requestId:'invalid'}]){const s=service();assert.equal(s.post({...valid,...changes}).ok,false);assert.equal(s.writes,0);}
});
test('rejects unsupported request shape, duplicate parameter and excessive payload',()=>{
  const s=service(); for(const extra of [{postData:null},{postData:{type:'application/json'}},{contentLength:12001},{parameters:{name:['甲','乙']}}])assert.equal(s.post(valid,extra).code,'INVALID_REQUEST');
  assert.equal(JSON.parse(s.context.doPost()).ok,false);assert.equal(s.writes,0);
});
test('all twelve source professions and both radio choices are accepted',()=>{
  for(const profession of ['藥事','醫事放射','醫事檢驗','護理','營養','呼吸治療','聽力','物理治療','職能治療','臨床心理','語言治療','其他'])assert.equal(service().post({...valid,profession,director:'否',attendance:'線上'}).ok,true);
});
test('formula-like input is saved as escaped text',()=>{
  for(const name of ['=1+1','+1','-1','@SUM(A1)','\'literal']){const s=service();s.post({...valid,name});assert.equal(s.rows[1][1],"'"+name);}
});
test('lock contention, missing sheet and bad headers fail without writing',()=>{
  for(const [options,code] of [[{busy:true},'BUSY'],[{missing:true},'SETUP_REQUIRED'],[{rows:[['不相符表頭']]},'HEADER_MISMATCH']]){const s=service(options);assert.equal(s.post().code,code);assert.equal(s.writes,0);}
});
test('setup is repeatable and preserves existing rows; mismatching headers stay unchanged',()=>{
  const s=service({rows:[]});s.context.setupSheet();s.context.setupSheet();assert.deepEqual(s.rows[0],headers);s.post();s.context.setupSheet();assert.equal(s.rows.length,2);
  const bad=service({rows:[['既有資料']]});assert.throws(()=>bad.context.setupSheet());assert.deepEqual(bad.rows,[['既有資料']]);
});
test('public responses never include submitted personal data or internal errors',()=>{
  const s=service({failFirstFlush:true});const response=s.post();assert.equal(JSON.stringify(response).includes('private service details'),false);assert.equal(JSON.stringify(response).includes(valid.email),false);
  const health=JSON.parse(s.context.doGet());assert.deepEqual(health,{ok:true,service:'workshop-registration',version:1});
});
