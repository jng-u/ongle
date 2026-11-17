import test from 'node:test';
import assert from 'node:assert/strict';
import {blankJournal} from '../src/model.js';
import {validateBackupData, encryptBackup, decryptBackup} from '../src/data/backup.js';
const data = () => ({...blankJournal(), entries:{'2026-11-15':{condition:null,pain:null,stools:null,blood:null,note:'x'.repeat(20001)}}});
test('existing long notes survive validation and encrypted backup', async()=>{
  const d=data(); assert.deepEqual(validateBackupData(d),d);
  assert.deepEqual(await decryptBackup(await encryptBackup(d,'password123'),'password123'),d);
});
test('duplicate identities and overlapping effective versions are rejected; adjacent versions survive',()=>{
  const d=data(); d.slots.push({...d.slots[0]}); assert.throws(()=>validateBackupData(d));
  d.slots[0].until='2026-11-16'; d.slots.at(-1).from='2026-11-16'; assert.doesNotThrow(()=>validateBackupData(d));
  d.visits=[{id:'v',date:'2026-11-15',time:'',title:'',place:'',note:'',type:'visit'}];
  d.visits.push({...d.visits[0]}); assert.throws(()=>validateBackupData(d));
});
test('storage boundary protects malformed original and replaces only verified data',async()=>{
  const {createJournalStore,JOURNAL_KEY}=await import('../src/data/journalStore.js');
  const map=new Map([[JOURNAL_KEY,'{broken']]); const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  const store=createJournalStore(storage); assert.throws(()=>store.read());
  assert.throws(()=>store.update(d=>{d.reminders=true;})); assert.equal(map.get(JOURNAL_KEY),'{broken');
  assert.throws(()=>store.replace({})); assert.equal(map.size,1);
  store.replace(data()); assert.equal(store.read().entries['2026-11-15'].note.length,20001);
  assert.ok([...map].some(([k,v])=>k!==JOURNAL_KEY&&v==='{broken'));
});
test('three-way edits merge independent fields and custom answers but reject same-field edits and stale deletion',async()=>{
  const {mergeJournal,JournalConflict}=await import('../src/data/journalStore.js');
  const base=data(), current=structuredClone(base), edit=structuredClone(base);
  current.entries['2026-11-15'].condition=4; edit.entries['2026-11-15'].note='edited';
  const merged=mergeJournal(base,edit,current); assert.equal(merged.entries['2026-11-15'].condition,4); assert.equal(merged.entries['2026-11-15'].note,'edited');
  current.entries['2026-11-15'].note='other'; assert.throws(()=>mergeJournal(base,edit,current),JournalConflict);
  delete edit.entries['2026-11-15']; assert.throws(()=>mergeJournal(base,edit,current),JournalConflict);
  base.entries['2026-11-15'].custom=[{id:'a',value:0},{id:'b',value:0}];
  const a=structuredClone(base),b=structuredClone(base); a.entries['2026-11-15'].custom[0].value=1;b.entries['2026-11-15'].custom[1].value=2;
  assert.deepEqual(mergeJournal(base,a,b).entries['2026-11-15'].custom.map(x=>x.value),[1,2]);
});
test('legacy partial entries and new medication schedules/snapshots share the storage and backup boundary',async()=>{
  const {createJournalStore,JOURNAL_KEY}=await import('../src/data/journalStore.js');
  const d=data(); d.entries['2026-11-14']={custom:[{id:'walk',label:'산책',type:'boolean',value:false}]};
  d.meds=[{id:'m',name:'약',dose:'1정',note:'',from:'2026-01-01',slotIds:[],schedule:{type:'prn'},extra:{alarm:false}}];
  d.checks['2026-11-15|prn-1|m']={name:'약',dose:'1정',note:'',slotName:'필요시',time:'',takenAt:'2026-11-15T01:00:00.000Z'};
  const map=new Map([[JOURNAL_KEY,JSON.stringify(d)]]), store=createJournalStore({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)});
  assert.deepEqual(store.read(),d);
  assert.deepEqual(await decryptBackup(await encryptBackup(d,'password123'),'password123'),d);
  for(const schedule of [{type:'weekdays',days:[1,3]},{type:'interval',every:2,anchor:'2026-11-15'},{type:'daily'}]) {
    d.meds[0].schedule=schedule; assert.doesNotThrow(()=>validateBackupData(d));
  }
  for(const schedule of [{type:'weekdays',days:[]},{type:'interval',every:0,anchor:'2026-11-15'},{type:'unknown'}]) {
    d.meds[0].schedule=schedule; assert.throws(()=>validateBackupData(d));
  }
  d.meds[0].schedule={type:'prn'};d.checks['2026-11-15|prn-1|m'].time={};assert.throws(()=>validateBackupData(d));
});
test('failed archive or replacement writes never discard the original',async()=>{
  const {createJournalStore,JOURNAL_KEY}=await import('../src/data/journalStore.js');
  for(const failArchive of [true,false]) {
    const map=new Map([[JOURNAL_KEY,'bad original']]);
    const store=createJournalStore({getItem:k=>map.get(k)??null,setItem(k,v){if(failArchive||k===JOURNAL_KEY)throw Error('quota');map.set(k,v);}});
    assert.throws(()=>store.replace(data())); assert.equal(map.get(JOURNAL_KEY),'bad original');
  }
});
test('latest storage is merged at commit, mutation exceptions and validation failures do not write',async()=>{
  const {createJournalStore,JOURNAL_KEY}=await import('../src/data/journalStore.js');
  const base=data(), map=new Map([[JOURNAL_KEY,JSON.stringify(base)]]);
  const store=createJournalStore({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)});
  store.update(d=>{d.entries['2026-11-15'].condition=4;});
  store.update(d=>{d.entries['2026-11-15'].note='local';},base);
  assert.equal(store.read().entries['2026-11-15'].condition,4);
  const raw=map.get(JOURNAL_KEY);
  assert.throws(()=>store.update(d=>{d.reminders='bad';}));
  assert.throws(()=>store.update(d=>{d.reminders=true;throw Error('failed');}));
  assert.throws(()=>store.update(d=>{d.reminders=true;},undefined,()=>false));
  assert.equal(map.get(JOURNAL_KEY),raw);
});
test('normal replacement uses no recovery storage; a single damaged recovery slot cannot be overwritten',async()=>{
  const {createJournalStore,JOURNAL_KEY,RECOVERY_KEY}=await import('../src/data/journalStore.js');
  const map=new Map([[JOURNAL_KEY,JSON.stringify(data())]]);
  const store=createJournalStore({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)});
  store.replace(data());store.replace(data());assert.equal(map.size,1);assert.equal(store.recoveryInfo(),null);
  map.set(JOURNAL_KEY,'broken one');store.replace(data());
  assert.deepEqual(store.recoveryInfo(),{key:RECOVERY_KEY,bytes:10});assert.equal(store.readRecoveryCopy(),'broken one');
  map.set(JOURNAL_KEY,'broken two'); assert.throws(()=>store.replace(data()));
  assert.equal(map.get(JOURNAL_KEY),'broken two');assert.equal(map.get(RECOVERY_KEY),'broken one');assert.equal(map.size,2);
});
test('forms opened before deletion, storage clearing or restore cannot resurrect old records',async()=>{
  const {createJournalStore,JOURNAL_KEY}=await import('../src/data/journalStore.js');
  const map=new Map([[JOURNAL_KEY,JSON.stringify(data())]]);
  const store=createJournalStore({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)});
  const base=store.read();
  store.update(d=>{delete d.entries['2026-11-15'];});
  assert.throws(()=>store.update(d=>{d.entries['2026-11-15'].note='stale edit';},base));
  assert.equal(store.read().entries['2026-11-15'],undefined);
  map.delete(JOURNAL_KEY);
  assert.throws(()=>store.update(d=>{d.visits.push({id:'v'});},base));
  assert.equal(map.has(JOURNAL_KEY),false);
  store.replace(data());const beforeRestore=store.read();
  store.replace(data());const restoredRaw=map.get(JOURNAL_KEY);
  assert.throws(()=>store.update(d=>{d.entries['2026-11-15'].note='old tab';},beforeRestore));
  assert.throws(()=>store.update(d=>{d.entries['2026-11-14']={note:'old new entry'};},base));
  assert.equal(map.get(JOURNAL_KEY),restoredRaw);
});
test('Provider separates domain/write/read failures, recovers damaged data, and blocks Android raw export',async()=>{
  const {build}=await import('esbuild');
  const {JOURNAL_KEY,RECOVERY_KEY}=await import('../src/data/journalStore.js');
  const names=['__journalProviderTest','localStorage','location'];
  const originals=names.map(name=>Object.getOwnPropertyDescriptor(globalThis,name));
  const map=new Map([[JOURNAL_KEY,JSON.stringify(data())]]);
  let failWrites=false,cursor=0;
  const states=[],refs=[];
  const runtime={
    useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},
    useRef(value){const ref={current:value};refs.push(ref);return ref;},
    useEffect(){},useCallback:fn=>fn,createContext:()=>({Provider:'provider'}),useContext(){},
    createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  };
  try {
    Object.defineProperty(globalThis,'__journalProviderTest',{configurable:true,value:runtime});
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>map.get(k)??null,setItem(k,v){if(failWrites)throw Error('quota');map.set(k,v);},removeItem:k=>map.delete(k)}});
    Object.defineProperty(globalThis,'location',{configurable:true,value:{hash:'#settings',origin:'https://appassets.androidplatform.net'}});
    const built=await build({entryPoints:[new URL('../src/core.jsx',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'provider-runtime',setup(plugin){
      plugin.onResolve({filter:/^react$/},()=>({path:'react',namespace:'mock'}));
      plugin.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const {useState,useRef,useEffect,useCallback,createContext,useContext}=globalThis.__journalProviderTest; export default globalThis.__journalProviderTest;'}));
    }}]});
    const {AppProvider}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
    const render=()=>{cursor=0;return AppProvider({children:null});};
    let tree=render(),app=tree.props.value;
    assert.equal(app.update(()=>{throw Error('예약된 처방의 시간을 먼저 바꿔 주세요.');}),false);
    app=render().props.value;assert.equal(app.storageError,'');assert.equal(app.writeError,'');assert.match(app.updateError,/예약된 처방/);
    failWrites=true;assert.equal(app.update(d=>{d.reminders=true;}),false);
    app=render().props.value;assert.equal(app.storageError,'');assert.match(app.writeError,/쓰지 못/);
    failWrites=false;map.set(JOURNAL_KEY,'broken');assert.equal(app.update(d=>{d.reminders=true;}),false);
    app=render().props.value;assert.ok(app.storageError);assert.equal(map.get(JOURNAL_KEY),'broken');
    const restoreBase=app.captureRestoreBase(); assert.equal(JSON.stringify(restoreBase),'{}');
    assert.equal(app.replaceJournal(data(),restoreBase),true);tree=render();app=tree.props.value;
    assert.equal(app.storageError,'');assert.equal(app.readRecoveryCopy(),'broken');assert.equal(app.recoveryCopy.key,RECOVERY_KEY);
    const nodes=n=>n&&typeof n==='object'?[n,...n.children.flatMap(nodes)]:[];
    const text=n=>typeof n==='string'?n:n&&typeof n==='object'?n.children.map(text).join(''):'';
    assert.match(text(tree),/Android에서는 원본 파일 내보내기를 지원하지/);
    assert.equal(nodes(tree).some(n=>n.type==='button'&&text(n)==='손상 원본 파일 저장'),false);
    const currentRaw=map.get(JOURNAL_KEY);
    nodes(tree).find(n=>n.type==='button'&&text(n)==='복구 사본 삭제').props.onClick();tree=render();
    nodes(tree).find(n=>n.type==='button'&&text(n)==='복구 사본 삭제 확인').props.onClick();
    assert.equal(map.has(RECOVERY_KEY),false);assert.equal(map.get(JOURNAL_KEY),currentRaw);
  } finally {
    for(const ref of refs)clearTimeout(ref.current);
    names.forEach((name,i)=>{if(originals[i])Object.defineProperty(globalThis,name,originals[i]);else delete globalThis[name];});
  }
});
test('restore preview refuses a changed or cleared source including malformed raw data',async()=>{
 const {createJournalStore,JOURNAL_KEY}=await import('../src/data/journalStore.js');
 const map=new Map([[JOURNAL_KEY,'broken']]);const store=createJournalStore({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)});
 const token=store.captureRestoreBase();map.set(JOURNAL_KEY,JSON.stringify(data()));const current=map.get(JOURNAL_KEY);
 assert.throws(()=>store.replace(data(),token));assert.equal(map.get(JOURNAL_KEY),current);assert.equal(map.size,1);
 const validToken=store.captureRestoreBase();map.delete(JOURNAL_KEY);assert.throws(()=>store.replace(data(),validToken));assert.equal(map.size,0);
});
test('restore CAS tokens disclose no raw data and distinguish missing, normal, and damaged sources',async()=>{
 const {createJournalStore,JOURNAL_KEY,RECOVERY_KEY}=await import('../src/data/journalStore.js');
 const map=new Map();const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const store=createJournalStore(storage);
 const missing=store.captureRestoreBase();assert.deepEqual(Object.keys(missing),[]);assert.equal(JSON.stringify(missing),'{}');
 store.replace(data(),missing);assert.equal(map.size,1);
 const normal=store.captureRestoreBase();store.replace(data(),normal);assert.equal(map.size,1);
 map.set(JOURNAL_KEY,'broken');const damaged=store.captureRestoreBase();assert.equal(JSON.stringify(damaged),'{}');
 store.replace(data(),damaged);assert.equal(map.get(RECOVERY_KEY),'broken');
 assert.throws(()=>store.replace(data(),{}));
 const oldRaw=store.readRecoveryCopy();store.deleteRecoveryCopy(oldRaw);assert.equal(store.recoveryInfo(),null);
 map.set(JOURNAL_KEY,'another broken original');store.replace(data(),store.captureRestoreBase());assert.equal(store.readRecoveryCopy(),'another broken original');
});
