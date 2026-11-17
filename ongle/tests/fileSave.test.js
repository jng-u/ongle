import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { saveFile } from '../src/data/fileSave.js';
import { backupSnapshot, backupDifference, readBackupMarker } from '../src/data/backupReview.js';
import { blankJournal } from '../src/model.js';

test('native save waits for final status; missing/failed bridge never falls back to a download', async () => {
  for (const status of ['saved', 'cancelled', 'failed']) {
    let complete;
    let settled = false;
    const pending = saveFile({ blob: new Blob(['private']), name: 'file' }, {
      android: true, native: { save: () => new Promise(resolve => { complete = resolve; }) },
    }).then(value => { settled = true; return value; });
    await Promise.resolve();
    assert.equal(settled, false);
    complete({ status });
    assert.deepEqual(await pending, { status });
  }
  for (const native of [null, { save: async () => ({status:'requested'}) }, { save: async () => { throw Error('write'); } }]) {
    assert.deepEqual(await saveFile({}, { android: true, native }), { status: 'failed' });
  }
});

test('web reports only a download request and cleans up when click throws', async () => {
  const events = [];
  const anchor = {click() { events.push('click'); }, remove() { events.push('remove'); }};
  const options = { android:false, document:{body:{append() { events.push('append'); }},createElement:()=>anchor},
    url:{createObjectURL:()=> 'blob:export',revokeObjectURL() {}} };
  // Keep real long URL cleanup timers out of the test process.
  const original = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  try {
    assert.deepEqual(await saveFile({blob:new Blob(['x']),name:'export.json'}, options), {status:'requested'});
    assert.equal(anchor.download, 'export.json');
    assert.deepEqual(events, ['append','click','remove']);
    anchor.click = () => { throw Error('blocked'); };
    assert.deepEqual(await saveFile({blob:new Blob(['x']),name:'export.json'}, options), {status:'failed'});
    assert.equal(events.at(-1), 'remove');
  } finally { globalThis.setTimeout = original; }
});

test('backup comparison detects additions, edits and deletions without plaintext or mutation', async () => {
  const data = blankJournal();
  data.entries['2026-11-16'] = {note:'비공개 메모'};
  const original = structuredClone(data);
  const before = await backupSnapshot(data);
  assert.deepEqual(data, original);
  assert.ok(!JSON.stringify(before).includes('비공개'));
  assert.deepEqual(backupDifference(await backupSnapshot({...data,reminders:!data.reminders}), before), {added:0,changed:0,removed:0,total:0});
  data.entries['2026-11-16'].note = '수정';
  data.checks['2026-11-16|morning|m'] = true;
  data.slots.pop();
  assert.deepEqual(backupDifference(await backupSnapshot(data),before), {added:1,changed:1,removed:1,total:3});
  const reordered = {...original, entries:{'2026-11-16':{note:'비공개 메모'}}};
  assert.deepEqual(backupDifference(await backupSnapshot(reordered),before).total,0);
  assert.equal(readBackupMarker({getItem:()=>'{'}),null);
  assert.equal(readBackupMarker({getItem:()=>JSON.stringify({status:'saved',at:'today',records:{bad:'plaintext'}})}),null);
});

test('installed shell authenticates port and waits for delayed saved/cancelled/failed result', async () => {
  const source = await readFile(new URL('../android/src/kr/ongyeol/journal/ShellScript.java',import.meta.url),'utf8');
  const script = source.split('\n').filter(line=>/^\s*"/.test(line)).map(line=>JSON.parse(line.trim().replace(/,$/,''))).join('\n');
  for (const status of ['saved','cancelled','failed']) {
    const listeners = new Map();
    const timers = new Map();
    let timer = 0, delayed;
    const requests = [];
    const win = { addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),dispatchEvent(){} };
    win.top = win;
    const port = {start(){},postMessage(raw) {
      const message = JSON.parse(raw); requests.push(message);
      const response = {requestId:message.requestId,ok:true};
      if (message.op === 'save') delayed = () => port.onmessage({data:JSON.stringify({...response,value:{status}})});
      else queueMicrotask(()=>port.onmessage({data:JSON.stringify(response)}));
    }};
    function Anchor() {}
    Anchor.prototype.click = () => {};
    runInNewContext(script, {window:win, document:{hidden:true,addEventListener(){}}, navigator:{},
      URL:{createObjectURL(){},revokeObjectURL(){}},HTMLAnchorElement:Anchor,location:{origin:'https://appassets.androidplatform.net'},
      Uint8Array,btoa,Promise,Map,setTimeout:(fn)=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id),alert(){},Event:class{},CustomEvent:class{} });
    listeners.get('message')({source:{},data:'__PORT_TOKEN__',ports:[port]});
    let settled = false;
    const pending = win.ongyeolFiles.save(new Blob(['abc'],{type:'text/calendar'}),'ongle-reminders-2026-11-16.ics').then(result=>{settled=true;return result;});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(requests.length,0,'forged window sender must not receive the native port');
    listeners.get('message')({source:null,data:'__PORT_TOKEN__',ports:[port]});
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(delayed);
    assert.equal(settled,false);
    assert.equal(timers.size,0,'picker save has no arbitrary timeout that can report failure before actual write');
    delayed();
    assert.equal((await pending).status,status);
    assert.deepEqual(requests.map(r=>r.op),['begin','chunk','save']);
  }
});
