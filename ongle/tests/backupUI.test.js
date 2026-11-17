import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {blankJournal} from '../src/model.js';
import {encryptBackup} from '../src/data/backup.js';

const nodes = node => node && typeof node === 'object' ? [node,...(node.children || []).flatMap(nodes)] : [];
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? (node.children || []).map(text).join('') : '';
let harnessSequence = 0;
async function harness(feature, app) {
  const states = [], refs = [];
  let cursor = 0, refCursor = 0;
  const runtime = { app, Fragment:'fragment',useEffect(){},useRef(value){const i=refCursor++;return refs[i] ||= {current:value};},
    useState(initial){const i=cursor++;if (!(i in states)) states[i]=typeof initial==='function'?initial():initial;
      return [states[i],value=>{states[i]=value;}];},
    createElement(type,props,...children){return {type,props:props||{},children:children.flat(Infinity)};} };
  globalThis.__saveUITest=runtime;
  const result = await build({entryPoints:[new URL(`../src/features/${feature}.jsx`,import.meta.url).pathname],bundle:true,
    write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'save-ui',setup(plugin){
      plugin.onResolve({filter:/^(react|react-dom|lucide-react)$|core\.jsx$|ui\.jsx$|\.css$/},args=>({path:args.path,namespace:'mock'}));
      plugin.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='react'
        ? 'export const {useEffect,useRef,useState}=globalThis.__saveUITest;export default globalThis.__saveUITest;'
        :args.path==='react-dom'?'export const createPortal=()=>null;'
        :args.path==='lucide-react'?'export const Download=()=>null,FileText=Download,Printer=Download,Bell=Download,BellOff=Download,CalendarDays=Download,ShieldCheck=Download;'
        :args.path.endsWith('core.jsx')?'export const useApp=()=>globalThis.__saveUITest.app;'
        :args.path.endsWith('ui.jsx')?'export const Modal=()=>null,Empty=Modal;':'',loader:'js'}));
    }}]});
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${++harnessSequence}`);
  return () => {cursor=0;refCursor=0;return module[feature==='Backup'?'BackupSettings':'ReminderSettings']();};
}

test('backup UI keeps passwords and marker on cancel/failure, validates without writing, and restores via replacement contract', async () => {
  const originals=new Map(['window','location','__saveUITest'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const messages=[], writes=[], replacements=[];
  let status='cancelled';
  const token = { raw: 'core-owned-base' };
  const app={captureRestoreBase:()=>token,data:blankJournal(),notify:m=>messages.push(m),demo:false,storageError:'corrupt current storage',
    replaceJournal:(data,base)=>{assert.equal(base,token);replacements.push(data);return false;},update:()=>{throw Error('ordinary update must never restore');}};
  const win={localStorage:{getItem:()=>null,setItem:(...args)=>writes.push(args)},ongyeolFiles:{save:async()=>({status})}};
  try {
    globalThis.window=win;globalThis.location={origin:'https://appassets.androidplatform.net'};
    const render=await harness('Backup',app);
    let tree=render();
    assert.match(text(tree),/현재 기기 기록을 읽지 못했어요/);
    const inputs=nodes(tree).filter(n=>n.type==='input');
    inputs[0].props.onChange({target:{value:'password123'}});
    inputs[1].props.onChange({target:{value:'password123'}});
    app.storageError='';
    for (const outcome of ['cancelled','failed','saved']) {
      status=outcome;tree=render();
      await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
      tree=render();
      assert.equal(nodes(tree).find(n=>n.type==='input').props.value,outcome==='saved'?'':'password123');
      assert.equal(writes.length,outcome==='saved'?1:0);
      assert.equal(messages.length,outcome==='saved'?1:0);
    }
    const encrypted=await encryptBackup(app.data,'password123');
    tree=render();
    nodes(tree).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[{size:encrypted.length,text:async()=>encrypted}]}});
    tree=render();
    nodes(tree).filter(n=>n.type==='input'&&n.props.type==='password').at(-1).props.onChange({target:{value:'password123'}});
    tree=render();app.storageError='corrupt current storage';
    await nodes(tree).filter(n=>n.type==='form')[1].props.onSubmit({preventDefault(){}});
    assert.equal(replacements.length,0,'file validation never writes');
    tree=render();assert.match(text(tree),/현재 기록은 아직 바뀌지 않았어요/);
    nodes(tree).find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
    tree=render();
    await nodes(tree).find(n=>n.type==='button'&&text(n)==='현재 기록 교체하기').props.onClick();
    tree=render();assert.equal(replacements.length,1);assert.equal(replacements[0].reminders,false);
    assert.match(text(tree),/기기에 저장하지 못했어요/);
    app.replaceJournal=(data,base)=>{assert.equal(base,token);replacements.push(data);return true;};
    tree=render();await nodes(tree).find(n=>n.type==='button'&&text(n)==='현재 기록 교체하기').props.onClick();
    tree=render();assert.doesNotMatch(text(tree),/교체할 기록 확인/);
    assert.match(messages.at(-1),/교체했어요/);
  } finally {for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});

test('ICS marker changes only for saved/requested results, never cancelled or failed', async () => {
  const originals=new Map(['window','location','__saveUITest'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const messages=[],writes=[];
  let status='cancelled';
  const data=blankJournal();data.meds=[{id:'m',name:'약',from:'2020-01-01',slotIds:['morning']}];
  const app={data,demo:false,notify:m=>messages.push(m)};
  try {
    globalThis.location={origin:'https://appassets.androidplatform.net'};
    globalThis.window={localStorage:{getItem:()=>null,setItem:(...args)=>writes.push(args)},ongyeolFiles:{save:async()=>({status})}};
    const render=await harness('Reminders',app);
    for (const outcome of ['cancelled','failed','saved']) {
      status=outcome;
      await nodes(render()).find(n=>n.type==='button'&&text(n).includes('캘린더 파일 받기')).props.onClick();
      assert.equal(writes.length,outcome==='saved'?1:0);
      assert.match(messages.at(-1),outcome==='saved'?/기기에 저장했어요/:outcome==='cancelled'?/취소/:/저장하지 못했어요/);
    }
  } finally {for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});

test('live restore button passes the original core CAS base after an intervening tab edit', async () => {
  const originals=new Map(['window','location','__saveUITest'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let raw='original', captured, commits=0;
  const messages=[];
  const app={data:blankJournal(),demo:false,notify:m=>messages.push(m),
    captureRestoreBase:()=>raw,
    replaceJournal(data,base){captured=base;if(base!==raw)return false;commits++;return true;}};
  try {
    globalThis.window={localStorage:{getItem:()=>null}};
    globalThis.location={origin:'https://appassets.androidplatform.net'};
    const render=await harness('Backup',app);
    const encrypted=await encryptBackup(app.data,'password123');
    let tree=render();
    nodes(tree).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[{size:encrypted.length,text:async()=>encrypted}]}});
    tree=render();nodes(tree).filter(n=>n.type==='input'&&n.props.type==='password').at(-1).props.onChange({target:{value:'password123'}});
    tree=render();await nodes(tree).filter(n=>n.type==='form')[1].props.onSubmit({preventDefault(){}});
    raw='changed in another tab';app.data={...app.data,reminders:true};
    tree=render();nodes(tree).find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
    tree=render();await nodes(tree).find(n=>n.type==='button'&&text(n)==='현재 기록 교체하기').props.onClick();
    assert.equal(captured,'original');assert.equal(commits,0);assert.equal(raw,'changed in another tab');
    assert.equal(messages.length,0);assert.match(text(render()),/다른 창의 변경 여부/);
  } finally {for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
