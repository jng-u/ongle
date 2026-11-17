import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {blankJournal} from '../src/model.js';
import {createJournalStore,JOURNAL_KEY} from '../src/data/journalStore.js';
const day='2026-11-16';
const fixture=()=>({...blankJournal(),slots:[{id:'s',name:'아침',time:'08:00',from:'2026-01-01'}],meds:[{id:'m',name:'원래 약',dose:'1정',note:'',slotIds:['s'],from:'2026-01-01'}],checks:{[`${day}|s|m`]:true}});
const nodes=n=>n&&typeof n==='object'?[n,...n.children.flatMap(nodes)]:[];
const text=n=>typeof n==='string'||typeof n==='number'?String(n):n&&typeof n==='object'?n.children.map(text).join(''):'';
async function harness(data, name='med', payload=name==='med'?{id:'m'}:{}) {
 let raw=JSON.stringify(data);const storage={getItem:key=>key===JOURNAL_KEY?raw:null,setItem(key,value){if(key===JOURNAL_KEY)raw=value;}};
 const store=createJournalStore(storage),states=[];let cursor=0;
 const calls=[];const app={data:store.read(),date:day,close(){calls.push('closed');},notify(){},update(fn,options){calls.push(options);try{app.data=store.update(fn,options?.base,options?.check);return true;}catch{return false;}}};
 const runtime={app,useEffect(){},useRef:value=>({current:value}),useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},createElement(type,props,...children){return {type,props:props||{},children:children.flat(Infinity)};}};
 globalThis.__medicineForms=runtime;
 const built=await build({entryPoints:[new URL('../src/features/Medicines.jsx', import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent',plugins:[{name:'forms',setup(p){
 p.onResolve({filter:/^(react|lucide-react)$|core\.jsx$|ui\.jsx$/},a=>({path:a.path,namespace:'mock'}));
 p.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='react'?'export const {useEffect,useRef,useState}=globalThis.__medicineForms;export default globalThis.__medicineForms;':a.path==='lucide-react'?'export const Clock3=()=>null,Pill=Clock3,Plus=Clock3,Pencil=Clock3,Search=Clock3,Trash2=Clock3,ExternalLink=Clock3,ArrowRight=Clock3;':a.path.endsWith('core.jsx')?'export const useApp=()=>globalThis.__medicineForms.app;':'export const PageHead=()=>null,Empty=PageHead,Modal=PageHead;',loader:'js'}));
 }}]});
 const {MedicineDialog}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}#${Math.random()}`);
 const component=MedicineDialog({name,payload}).type;
 return {app,store,calls,render(){cursor=0;return component({payload});},submit(tree){nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});}};
}
test('medicine and slot forms retain opening base across remote restore and keep stale editors open',async()=>{
 for(const name of ['med','slots']) {
  const h=await harness(fixture(),name);let tree=h.render();const base=h.app.data;
  h.app.data=h.store.replace(fixture());tree=h.render();h.submit(tree);tree=h.render();
  assert.strictEqual(h.calls.find(c=>c&&typeof c==='object')?.base,base);
  assert.ok(!h.calls.includes('closed'));assert.match(text(tree),/다른 창|최신/);
 }
});
test('forms show relevant history and future prescriptions; swallowed mutation errors retain exact reason',async()=>{
 const d=fixture();d.meds.push({...d.meds[0],id:'future',name:'예약 약',from:'2026-12-01'});
 d.checks['2026-11-15|s|m']=true;d.checks['2026-11-15|unrelated|other']=true;
 const h=await harness(d,'slots');let tree=h.render();
 nodes(tree).find(n=>n.props['aria-label']==='아침 시간 삭제').props.onClick();tree=h.render();
 // Keep today's medicine mapped to a new slot; future prescription is still orphaned.
 nodes(tree).find(n=>n.type==='button'&&text(n).includes('시간 추가')).props.onClick();tree=h.render();
 const inputs=nodes(tree).filter(n=>n.type==='input'&&n.props.placeholder==='예: 자기 전');inputs[0].props.onChange({target:{value:'밤'}});tree=h.render();
 nodes(tree).find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});tree=h.render();
 assert.match(text(tree),/2026-11-16.*1회/);assert.ok(!text(tree).includes('2026-11-15')); assert.match(text(tree),/2026-12-01.*예약 약|예약 약.*2026-12-01/);
 h.submit(tree);tree=h.render();assert.match(text(tree),/예약 약.*2026-12-01.*시간/);assert.ok(!h.calls.includes('closed'));
});

test('medication history preview is scoped and normal remote saves cannot overwrite a stale form',async()=>{
 const d=fixture();d.checks['2026-11-16|s|other']=true;
 const h=await harness(d);let tree=h.render();const base=h.app.data;
 assert.match(text(tree),/2026-11-16.*1회/);assert.ok(!text(tree).includes('2회'));
 // Edit the same field after opening, then attempt a same-version form save.
 const nameInput=nodes(tree).find(n=>n.props.placeholder==='약 봉투에 적힌 이름');
 nameInput.props.onChange({target:{value:'폼에서 수정'}});tree=h.render();
 h.app.data=h.store.update(draft=>{draft.meds[0].name='다른 창 수정';});
 // Apply on the original start so the conflicting field has the same version identity.
 nodes(tree).find(n=>n.type.name==='EffectiveDate').props.onChange('2026-01-01');tree=h.render();
 nodes(tree).find(n=>n.props.placeholder==='약 봉투에 적힌 이름').props.onChange({target:{value:'폼에서 수정'}});tree=h.render();
 h.submit(tree);tree=h.render();
 assert.strictEqual(h.calls.find(c=>c&&typeof c==='object').base,base);
 assert.ok(!h.calls.includes('closed'));assert.equal(h.store.read().meds[0].name,'다른 창 수정');
 assert.match(text(tree),/최신/);
});
test('medicine removal also passes the opening base after restore',async()=>{
 const h=await harness(fixture());let tree=h.render();const base=h.app.data;
 nodes(tree).find(n=>n.type==='button'&&text(n).includes('약 삭제')).props.onClick();tree=h.render();
 h.app.data=h.store.replace(fixture());tree=h.render();
 nodes(tree).find(n=>n.type==='button'&&text(n)==='목록에서 제외').props.onClick();tree=h.render();
 assert.strictEqual(h.calls.find(c=>c&&typeof c==='object').base,base);assert.ok(!h.calls.includes('closed'));assert.match(text(tree),/최신/);
});
test('merged future slot cutoffs keep exact reason when update swallows post-merge validation errors',async()=>{
 const d=fixture();d.meds=[];d.checks={};const h=await harness(d,'med',{});let tree=h.render();
 nodes(tree).find(n=>n.props.placeholder==='약 봉투에 적힌 이름').props.onChange({target:{value:'신규 처방'}});tree=h.render();
 const slotLabel=nodes(tree).find(n=>n.type==='label'&&text(n).includes('아침')&&nodes(n).some(c=>c.props.type==='checkbox'));
 nodes(slotLabel).find(n=>n.props.type==='checkbox').props.onChange({target:{checked:true}});tree=h.render();
 h.app.data=h.store.update(draft=>{draft.slots[0].until='2026-12-01';});tree=h.render();
 h.submit(tree);tree=h.render();assert.match(text(tree),/신규 처방.*2026-12-01.*시간/);assert.ok(!h.calls.includes('closed'));assert.equal(h.store.read().meds.length,0);
});
