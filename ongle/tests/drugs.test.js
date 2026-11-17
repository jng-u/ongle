import test from 'node:test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import provenance from '../src/data/korean-drugs-source.json' with {type:'json'};
import assert from 'node:assert/strict';
import {searchRxNorm, activeOn, replaceVersion, saveMedicine, saveSlots} from '../src/data/drugs.js';
import {DRUG_CATALOG, searchDrugs} from '../src/data/drugSearch.js';
import {createDrugSearchClient} from '../src/data/drugSearchClient.js';
const date = '2026-11-16';
const slot = {id:'am', name:'아침', time:'08:00', from:'2026-01-01'};
const med = {id:'m1', name:'내 약', dose:' 1/2정 ', note:'식후 그대로', slotIds:['am'], from:'2026-01-01'};
const fresh = () => ({slots:[{...slot}], meds:[{...med, slotIds:[...med.slotIds]}], checks:{'old-check':true}});
test('verified Korean product and ingredient searches normalize spacing, Unicode and units', () => {
  assert.ok(DRUG_CATALOG.length > 80000);
  assert.equal(DRUG_CATALOG.length, provenance.catalogRows);
  assert.equal(searchDrugs(' 아 자 프 린 정 ２５ mg ')[0].name, '아자프린정25밀리그램(아자티오프린)');
  assert.ok(searchDrugs('메살라진').length >= 20);
  assert.ok(searchDrugs('아자티오프린').length >= 10);
  assert.ok(searchDrugs('prednisolone').some(item => item.ingredient.toLowerCase().includes('prednisolone')));
  assert.ok(searchDrugs('소론도').some(item => item.name.startsWith('소론도')));
  assert.deepEqual(searchDrugs('없는약이름'), []);
  assert.deepEqual(searchDrugs('  '), []);
  for (const drug of DRUG_CATALOG) assert.equal(new URL(drug.sourceUrl).hostname, 'www.data.go.kr');
});
test('RxNorm sends only query and handles omitted groups, duplicate IDs and HTTP failure', async () => {
  let call;
  const results = await searchRxNorm('mesalamine', {fetcher: async (...args) => {
    call = args;
    return {ok:true, json: async () => ({drugGroup:{conceptGroup:[{}, {conceptProperties:[{rxcui:'42', name:'name'}, {rxcui:'42', name:'name'}]}]}})};
  }});
  assert.equal(results.length, 1);
  assert.equal(new URL(call[0]).searchParams.get('name'), 'mesalamine');
  assert.equal(new URL(call[0]).searchParams.size, 1);
  assert.equal(call[1].credentials, 'omit');
  assert.deepEqual(await searchRxNorm('한글', {fetcher: () => assert.fail('must not call')}), []);
  assert.deepEqual(await searchRxNorm('aspirin', {fetcher: async () => ({ok:true, json:async () => ({})})}), []);
  await assert.rejects(searchRxNorm('aspirin', {fetcher:async () => ({ok:false})}));
});
test('medicine changes preserve past, future planned versions, checks and verbatim dose', () => {
  const draft = fresh();
  draft.meds[0].until = '2026-12-01';
  draft.meds.push({...med, from:'2026-12-01', dose:'future'});
  saveMedicine(draft, 'm1', date, {...med, dose:' 2 정 / 1회 ', note:'내 메모'});
  assert.equal(draft.meds.find(m => activeOn(m, '2026-11-15')).dose, ' 1/2정 ');
  assert.equal(draft.meds.find(m => activeOn(m, date)).dose, ' 2 정 / 1회 ');
  assert.equal(draft.meds.find(m => activeOn(m, '2026-12-01')).dose, 'future');
  assert.deepEqual(draft.checks, {'old-check':true});
  saveMedicine(draft, 'm1', date, {...med, dose:'third'});
  assert.equal(draft.meds.filter(m => activeOn(m, date)).length, 1);
});
test('16일에 추가한 약을 15일 시작으로 정정하면 첫 버전을 옮기고 실제 체크만 보존한다', () => {
  const draft = fresh();
  draft.meds = [{...med, from:date}];
  draft.checks = {'2026-11-16|am|m1':true, '2026-11-14|am|other':true};
  const checks = structuredClone(draft.checks);
  saveMedicine(draft, 'm1', '2026-11-15', {...med, dose:'정정한 양'});
  assert.equal(draft.meds.length, 1);
  assert.equal(draft.meds[0].from, '2026-11-15');
  for (const day of ['2026-11-15', date, '2026-12-01']) {
    assert.deepEqual(draft.meds.filter(m => activeOn(m, day)).map(m => m.dose), ['정정한 양']);
  }
  assert.deepEqual(Object.keys(draft.checks), Object.keys(checks));
  assert.equal(draft.checks['2026-11-16|am|m1'].dose, med.dose);
  assert.equal(draft.checks['2026-11-14|am|other'], true);
});
test('최초 시작일 정정은 이후 버전과 종료 경계를 보존한다', () => {
  const draft = fresh();
  const future = {...med, from:'2026-11-20', dose:'예약된 양'};
  draft.meds = [future, {...med, from:date, until:future.from}];
  saveMedicine(draft, 'm1', '2026-11-15', {...med, dose:'첫 양'});
  assert.equal(draft.meds.length, 2);
  assert.deepEqual(draft.meds.find(m => m.from === future.from), future);
  assert.deepEqual(draft.meds.filter(m => activeOn(m, '2026-11-19')).map(m => m.dose), ['첫 양']);
  assert.deepEqual(draft.meds.filter(m => activeOn(m, future.from)).map(m => m.dose), ['예약된 양']);
  const before = structuredClone(draft);
  for (const day of [future.from, '2026-11-21']) {
    assert.throws(() => saveMedicine(draft, 'm1', day, med, {correctStart:true}), /최초|시작일/);
    assert.deepEqual(draft, before);
  }
  saveMedicine(draft, 'm1', '2026-11-17', med, {correctStart:true});
  assert.equal(draft.meds.find(m => m.until === future.from).from, '2026-11-17');
  assert.deepEqual(draft.meds.find(m => m.from === future.from), future);
});
test('종료된 첫 버전 정정은 중단 기간을 되살리지 않는다', () => {
  const draft = fresh();
  draft.meds = [{...med, from:date, until:'2026-11-18'}, {...med, from:'2026-11-22', dose:'재시작'}];
  saveMedicine(draft, 'm1', '2026-11-15', med);
  assert.equal(draft.meds.length, 2);
  assert.equal(draft.meds.filter(m => activeOn(m, '2026-11-19')).length, 0);
  assert.throws(() => saveMedicine(draft, 'm1', '2026-11-18', med, {correctStart:true}), /최초|시작일/);
});
test('잘못된 날짜와 누락된 복약 시간은 정정 전에 거부한다', () => {
  const draft = fresh();
  draft.meds = [{...med, from:date}];
  draft.slots[0].from = date;
  const before = structuredClone(draft);
  for (const day of ['', 'garbage', '2026-02-30', '2026-13-01']) {
    assert.throws(() => saveMedicine(draft, 'm1', day, med), /날짜/);
    assert.deepEqual(draft, before);
  }
  for (const slotIds of [[], undefined, null, ['missing'], ['am']]) {
    assert.throws(() => saveMedicine(draft, 'm1', '2026-11-15', {...med, slotIds}), /시간/);
    assert.deepEqual(draft, before);
  }
  assert.throws(() => saveMedicine(draft, 'unknown', date, med, {correctStart:true}), /최초|시작일/);
});
test('medicine supports multiple slots and rejects nonexistent or empty assignments', () => {
  const draft = fresh();
  draft.slots.push({...slot, id:'pm'});
  saveMedicine(draft, 'm1', date, {...med, slotIds:['am','pm','pm','missing']});
  assert.deepEqual(draft.meds.find(m => activeOn(m, date)).slotIds, ['am','pm']);
  assert.throws(() => saveMedicine(draft,'m1',date,{...med,slotIds:[]}), /시간/);
});
test('removal and same-day edits do not leave duplicate active versions', () => {
  let versions = replaceVersion([med], 'm1', date, {...med, name:'수정'});
  versions = replaceVersion(versions, 'm1', date, null);
  assert.equal(versions.filter(m => activeOn(m,date)).length,0);
  assert.equal(versions.filter(m => activeOn(m,'2026-11-15')).length,1);
  assert.deepEqual(replaceVersion([{...med,from:date}], 'm1', date, null), []);
});
test('editing before a future version fills only the gap', () => {
  const result = replaceVersion([{...med,from:'2026-12-01'}], 'm1', date, med);
  assert.equal(result.filter(m => activeOn(m,'2026-12-01')).length,1);
  assert.equal(result.find(m => m.from === date).until,'2026-12-01');
});
test('slot rename/removal and medication remapping preserve historical schedule', () => {
  const draft = fresh();
  saveSlots(draft,date,[{id:'pm',name:'자기 전',time:'22:30'}],{m1:['pm']});
  assert.equal(draft.slots.find(s => activeOn(s,'2026-11-15')).id,'am');
  assert.equal(draft.slots.find(s => activeOn(s,date)).id,'pm');
  assert.deepEqual(draft.meds.find(m => activeOn(m,'2026-11-15')).slotIds,['am']);
  assert.deepEqual(draft.meds.find(m => activeOn(m,date)).slotIds,['pm']);
  saveSlots(draft,date,[{id:'pm',name:'취침 전',time:'23:00'}],{m1:['pm']});
  assert.equal(draft.slots.filter(s => activeOn(s,date)).length,1);
  assert.deepEqual(draft.checks,{'old-check':true});
});
test('saving unchanged slots leaves version history intact', () => {
  const draft = fresh();
  saveSlots(draft,date,[slot],{m1:['am']});
  assert.equal(draft.slots.length,1);
  assert.equal(draft.meds.length,1);
});

test('broad offline snapshot covers domestic brands and generic searches without network', () => {
  const terms = ['펜타사', '아사콜', '살로팔크', '엔토코트', '이뮤란', '레미케이드', '램시마', '휴미라', '스텔라라', '킨텔레스', '스카이리치', '린버크', '메살라진', '아자티오프린', '부데소니드', '인플릭시맵', '아달리무맙', '우스테키누맙', '베돌리주맙', '리산키주맙', '유파다시티닙', '설파살라진', '프레드니솔론', '메토트렉세이트', '타이레놀', '가스모틴', '아모잘탄'];
  for (const term of terms) assert.ok(searchDrugs(term).length, `offline lookup: ${term}`);
  assert.ok(searchDrugs('azathioprine').length);
  assert.ok(searchDrugs(' 아자프린 25 mg ').some(drug => drug.name.includes('25밀리그램')));
  assert.ok(searchDrugs('펜타사서방정 500mg').some(drug => drug.name.includes('펜타사')));
  const first = searchDrugs('펜타사')[0];
  assert.ok(searchDrugs(first.itemSeq).some(drug => drug.itemSeq === first.itemSeq));
  assert.equal(searchDrugs('아', 5).length, 5);
  assert.deepEqual(searchDrugs('펜타사', 0), []);
  assert.deepEqual(searchDrugs('펜타사', -1), []);
});
test('generated snapshot is sorted, unique, slim and source-attributed', () => {
  const rows = JSON.parse(readFileSync(new URL('../src/data/korean-drugs.json', import.meta.url)));
  const keys = new Set();
  for (let i = 0; i < rows.length; i++) {
    const [id, name, ingredient] = rows[i];
    assert.equal(rows[i].length, 3);
    assert.match(id, /^\d{9}$/);
    assert.ok(name.trim());
    assert.equal(typeof ingredient, 'string');
    const key = `${id}|${name}`;
    assert.ok(!keys.has(key)); keys.add(key);
    if (i) assert.ok(rows[i-1][1] <= name);
  }
  for (const source of Object.values(provenance.sources)) {
    assert.equal(new URL(source.page).hostname, 'www.data.go.kr');
    assert.equal(new URL(source.download).hostname, 'www.data.go.kr');
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.bytes > 1000000);
  }
  assert.equal(provenance.productRows, 309889);
  assert.match(provenance.license, /출처표시/);
});
test('catalog builder handles quoted CSV and rejects unexpected input before writing', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util
spec = importlib.util.spec_from_file_location('catalog', 'scripts/build-drug-catalog.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
rows = m.parse_csv('일반명코드,일반명\\r\\n123,"a,b"\\r\\n'.encode('cp949'), ['일반명코드','일반명'])
assert rows[0]['일반명'] == 'a,b'
try:
 m.parse_csv(b'<html>not csv</html>', ['한글상품명'])
except ValueError:
 pass
else:
 raise AssertionError('must reject changed source schema')
`], {cwd: new URL('..', import.meta.url), encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function searchHarness(options = {}) {
  const updates = [], workers = [];
  const client = createDrugSearchClient(state => updates.push(state), {
    debounceMs: 5, timeoutMs: 1000,
    createWorker: () => {
      const worker = {messages:[], terminated:false, postMessage(value) {this.messages.push(value);}, terminate() {this.terminated = true;}};
      workers.push(worker); return worker;
    }, ...options,
  });
  return {client, updates, workers};
}
test('worker is lazy, debounce collapses typing and only latest responses reach the UI', async () => {
  const {client, updates, workers} = searchHarness();
  assert.equal(workers.length, 0);
  client.search(''); await pause(10); assert.equal(workers.length, 0);
  client.search('펜'); client.search('펜타'); client.search('펜타사');
  assert.equal(workers.length, 0);
  await pause(15);
  assert.equal(workers.length, 1);
  const worker = workers[0];
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0].query, '펜타사');
  assert.deepEqual(Object.keys(worker.messages[0]).sort(), ['query','requestId']);
  const oldId = worker.messages[0].requestId;
  client.search('아사콜');
  worker.onmessage({data:{requestId:oldId, results:[{name:'stale'}]}});
  assert.deepEqual(updates.at(-1).results, []);
  assert.equal(updates.at(-1).query, '아사콜');
  await pause(15);
  const latest = worker.messages.at(-1);
  worker.onmessage({data:{requestId:latest.requestId, results:[{name:'아사콜'}]}});
  assert.equal(updates.at(-1).results[0].name, '아사콜');
  assert.equal(updates.at(-1).busy, false);
  client.search('');
  worker.onmessage({data:{requestId:latest.requestId, results:[{name:'old'}]}});
  assert.deepEqual(updates.at(-1).results, []);
  const before = updates.length;
  client.dispose();
  assert.equal(worker.terminated, true);
  worker.onmessage({data:{requestId:latest.requestId, results:[]}});
  assert.equal(updates.length, before);
});
test('worker errors and timeouts keep manual entry available and allow a fresh retry', async () => {
  const {client, updates, workers} = searchHarness({timeoutMs:20});
  client.search('펜타사'); await pause(10);
  workers[0].onerror();
  assert.equal(updates.at(-1).busy, false);
  assert.match(updates.at(-1).error, /직접 입력/);
  assert.equal(workers[0].terminated, true);
  client.search('아사콜'); await pause(10);
  assert.equal(workers.length, 2);
  await pause(30);
  assert.equal(workers[1].terminated, true);
  assert.match(updates.at(-1).error, /직접 입력/);
  client.dispose();
});
test('disposing while debounce is pending never starts a worker', async () => {
  const {client, workers} = searchHarness();
  client.search('펜타사'); client.dispose(); await pause(15);
  assert.equal(workers.length, 0);
});
test('UI-safe helpers never import bulky search data', () => {
  const source = readFileSync(new URL('../src/data/drugs.js', import.meta.url), 'utf8');
  assert.ok(!source.includes("from './korean-drugs.json'"));
  assert.ok(!source.includes("from './drugSearch.js'"));
  const ui = readFileSync(new URL('../src/features/Medicines.jsx', import.meta.url), 'utf8');
  assert.ok(!ui.includes('searchDrugs('));
});

test('real worker searches the offline catalog and returns only current request data', {timeout:10000}, async () => {
  const {Worker} = await import('node:worker_threads');
  const url = new URL('../src/data/drugSearchWorker.js', import.meta.url).href;
  const worker = new Worker(`
    const {parentPort, workerData} = require('node:worker_threads');
    globalThis.fetch = () => {throw Error('Offline worker must not fetch');};
    globalThis.self = {postMessage: value => parentPort.postMessage(value)};
    const ready = import(workerData);
    parentPort.on('message', async data => {await ready; self.onmessage({data});});
  `, {eval:true, workerData:url});
  try {
    const result = new Promise((resolve, reject) => {worker.once('message', resolve); worker.once('error', reject);});
    worker.postMessage({requestId:7, query:'펜타사'});
    const message = await result;
    assert.equal(message.requestId, 7);
    assert.ok(message.results.some(drug => drug.name.includes('펜타사')));
    assert.ok(message.results.length <= 30);
    assert.deepEqual(Object.keys(message).sort(), ['requestId','results']);
  } finally {await worker.terminate();}
});

test('약 수정 화면에서 16→15일 정정, 이후 변경, 오류 피드백을 처리한다', async () => {
  const {build} = await import('esbuild');
  const original = Object.getOwnPropertyDescriptor(globalThis, '__medicineUITest');
  const messages = [];
  const app = {data:fresh(), date, close() {}, notify: message => messages.push(message), update(fn) {fn(app.data); return true;}};
  const future = {...med, from:'2026-11-20', dose:'예약'};
  app.data.meds = [{...med, from:date, until:future.from}, future];
  const states = [];
  let cursor = 0;
  const runtime = {app, useEffect() {}, useRef: value => ({current:value}),
    useState(initial) {
      const i = cursor++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], value => {states[i] = typeof value === 'function' ? value(states[i]) : value;}];
    },
    createElement(type, props, ...children) {return {type, props:props || {}, children:children.flat(Infinity)};},
  };
  try {
    Object.defineProperty(globalThis, '__medicineUITest', {configurable:true, value:runtime});
    const built = await build({entryPoints:[new URL('../src/features/Medicines.jsx', import.meta.url).pathname], bundle:true,
      write:false, format:'esm', platform:'node', loader:{'.css':'empty'}, logLevel:'silent', plugins:[{name:'medicine-ui', setup(plugin) {
        plugin.onResolve({filter:/^(react|lucide-react)$|core\.jsx$|ui\.jsx$/}, args => ({path:args.path, namespace:'mock'}));
        plugin.onLoad({filter:/.*/, namespace:'mock'}, args => ({contents:args.path === 'react'
          ? 'export const {useEffect,useRef,useState}=globalThis.__medicineUITest; export default globalThis.__medicineUITest;'
          : args.path === 'lucide-react' ? 'export const Clock3=()=>null,Pill=Clock3,Plus=Clock3,Pencil=Clock3,Search=Clock3,Trash2=Clock3,ExternalLink=Clock3,ArrowRight=Clock3;'
            : args.path.endsWith('core.jsx') ? 'export const useApp=()=>globalThis.__medicineUITest.app;'
              : 'export const PageHead=()=>null,Empty=PageHead,Modal=PageHead;', loader:'js'}));
      }}]});
    const {MedicineDialog} = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
    const form = MedicineDialog({name:'med', payload:{id:'m1'}});
    const render = () => {cursor = 0; return form.type({payload:{id:'m1'}});};
    const nodes = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];
    const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? node.children.map(text).join('') : '';
    let tree = render();
    const changeDate = value => {
      nodes(tree).find(n => n.type.name === 'EffectiveDate').props.onChange(value);
      tree = render();
    };
    const submit = () => {nodes(tree).find(n => n.type === 'form').props.onSubmit({preventDefault() {}}); tree = render();};
    changeDate('2026-11-15');
    assert.equal(nodes(tree).find(n => n.type === 'select').props.value, 'start');
    assert.match(text(tree), /최초 시작일을 정정하고/);
    submit();
    assert.equal(app.data.meds.length, 2);
    assert.equal(app.data.meds[0].from, '2026-11-15', text(tree));
    assert.deepEqual(app.data.meds[1], future);
    assert.match(messages.at(-1), /최초 시작일을 정정/);
    nodes(tree).find(n => n.type === 'select').props.onChange({target:{value:'change'}});
    tree = render();
    changeDate('2026-11-17');
    submit();
    assert.equal(app.data.meds.length, 3);
    assert.equal(app.data.meds.filter(m => activeOn(m, '2026-11-17')).length, 1);
    changeDate(''); submit();
    assert.match(text(tree), /올바른 날짜/);
    const before = structuredClone(app.data);
    changeDate('2025-01-01'); submit();
    assert.match(text(tree), /복약 시간을 하나 이상/);
    assert.deepEqual(app.data, before);
    changeDate('2026-11-17');
    const recurrence = nodes(tree).find(n => n.type === 'select' && n.props.value === 'daily');
    recurrence.props.onChange({target:{value:'weekdays'}}); tree = render();
    assert.match(text(tree), /복용 요일/);
    submit();
    assert.deepEqual(app.data.meds.find(m => m.from === '2026-11-17').schedule,{type:'weekdays',days:[1]});
    nodes(tree).find(n => n.type === 'select' && n.props.value === 'weekdays').props.onChange({target:{value:'interval'}}); tree=render();
    assert.match(text(tree), /격일 기준일/);
    submit();
    assert.deepEqual(app.data.meds.find(m => m.from === '2026-11-17').schedule,{type:'interval',every:2,anchor:'2026-11-17'});
    nodes(tree).find(n => n.type === 'select' && n.props.value === 'interval').props.onChange({target:{value:'prn'}}); tree=render();
    assert.match(text(tree), /정기 알람과 예정 횟수에서 제외/);
    submit();
    assert.equal(app.data.meds.find(m => m.from === '2026-11-17').schedule.type,'prn');
  } finally {
    if (original) Object.defineProperty(globalThis, '__medicineUITest', original);
    else delete globalThis.__medicineUITest;
  }
});
