import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeAlarmPayload, createNativeAlarmSync } from '../src/data/nativeAlarms.js';

import { scheduledReminders } from '../src/data/alarms.js';

const today = '2026-11-16';
const fixture = () => ({ reminders: true,
  slots: [{ id: 's', from: '1900-01-01', time: '08:00', name: '아침' },
    { id: 's', from: '2026-12-01', time: '09:00' }],
  meds: [{ id: 'm', from: '1900-01-01', until: '2026-12-01', slotIds: ['s'], name: '비공개 약' },
    { id: 'm', from: '2026-12-01', until: '2027-01-01', slotIds: [] }],
  checks: { '2026-11-15|s|m': true, '2026-11-16|s|m': true, '2026-12-01|s|m': true,
    '2026-11-16|s|other': true, '2026-11-17|s|m': false, 'bad|s|m': true },
  entries: { private: '비공개 기록' },
});
const status = { notifications: true, exact: false, enabled: true };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('payload retains future versions and exclusive cutoffs, removes private data and irrelevant checks', () => {
  const data = fixture();
  const before = JSON.stringify(data);
  const payload = buildNativeAlarmPayload(data, today);
  assert.deepEqual(payload.checks, ['2026-11-16|s|m']);
  assert.equal(payload.slots[1].time, '09:00');
  assert.equal(payload.meds[0].until, '2026-12-01');
  assert.deepEqual(payload.meds[1].slotIds, []);
  assert.doesNotMatch(JSON.stringify(payload), /비공개|아침|entries|name/);
  assert.equal(JSON.stringify(data), before);
  payload.meds[0].slotIds.push('other');
  assert.deepEqual(data.meds[0].slotIds, ['s']);
  assert.equal(buildNativeAlarmPayload({ ...data, reminders: false }, today).enabled, false);
});

test('disabled payload contains only cancellation state, even for unusable historical data', () => {
  assert.deepEqual(buildNativeAlarmPayload({ reminders: false, meds: [null] }, today),
    { enabled: false, slots: [], meds: [], checks: [] });
});

test('payload drops expired and superseded history without reviving stopped IDs', () => {
  const data = fixture();
  data.slots.push({ id: 'old', from: '2020-01-01', until: today, time: '06:00' });
  data.meds.push({ id: 'stopped', from: '2020-01-01', slotIds: ['s'] },
    { id: 'stopped', from: '2026-11-01', until: today, slotIds: ['s'] });
  const payload = buildNativeAlarmPayload(data, today);
  assert.equal(payload.slots.some(item => item.id === 'old'), false);
  assert.equal(payload.meds.some(item => item.id === 'stopped'), false);
  assert.equal(buildNativeAlarmPayload(data, '2026-12-01').slots.length, 1);
  assert.equal(buildNativeAlarmPayload(data, '2026-12-01').meds.length, 1);
});

test('payload carries canonical recurrence only, retains PRN cutoffs and filters off-day checks', () => {
  const data = fixture();
  data.meds[0].schedule = { type: 'weekdays', days: [3, 1, 1], private: '비공개' };
  data.meds[1].schedule = { type: 'prn' };
  data.meds.push({ id: 'alternate', from: '2026-11-17', slotIds: ['s'],
    schedule: { type: 'interval', every: 2, anchor: '2026-11-16' } });
  data.checks['2026-11-17|s|m'] = { name: '비공개' };
  data.checks['2026-11-18|s|alternate'] = { name: '비공개' };
  const payload = buildNativeAlarmPayload(data, today);
  assert.deepEqual(payload.meds.map(item => item.schedule), [
    { type: 'weekdays', days: [1, 3] }, { type: 'prn' },
    { type: 'interval', every: 2, anchor: '2026-11-16' },
  ]);
  assert.deepEqual(payload.checks, ['2026-11-16|s|m', '2026-11-18|s|alternate']);
  assert.doesNotMatch(JSON.stringify(payload), /비공개|private/);
  payload.meds[0].schedule.days.push(6);
  assert.deepEqual(data.meds[0].schedule.days, [3, 1, 1]);
});

test('pruned payload preserves future stop and restart behavior and exclusive slot cutoffs', () => {
  const data = fixture();
  data.meds = [
    { id: 'm', from: '2020-01-01', slotIds: ['s'] },
    { id: 'm', from: '2026-11-01', until: today, slotIds: ['s'] },
    { id: 'm', from: '2026-11-18', slotIds: ['s'], schedule: { type: 'interval', every: 2, anchor: today } },
    { id: 'm', from: '2026-11-22', until: '2026-11-22', slotIds: ['s'] },
    { id: 'm', from: '2026-11-26', slotIds: ['s'], schedule: { type: 'weekdays', days: [0, 4] } },
  ];
  data.slots.push({ id: 's', from: '2026-11-28', until: '2026-11-28', time: '08:00' });
  const payload = buildNativeAlarmPayload(data, today);
  assert.equal(payload.meds.length, 3);
  // A future zero-length version is a stop boundary, not removable history.
  assert.equal(payload.meds[1].until, '2026-11-22');
  const restored = { ...payload, checks: Object.fromEntries(payload.checks.map(key => [key, true])) };
  for (let day = 16; day <= 30; day++) {
    const date = `2026-11-${day}`;
    const summary = value => scheduledReminders(value, date).map(({ slot, pending }) => [slot.id, slot.time, pending.map(m => m.id)]);
    assert.deepEqual(summary(restored), summary(data), date);
  }
});

test('bridge lookup failure and reinjection invalidate prior deduplication', async () => {
  let missing = false, throwing = false;
  const sent = [], errors = [];
  const native = { status: async () => status, sync: async p => sent.push(p) };
  const sync = createNativeAlarmSync({ bridge: () => {
    if (throwing) throw Error('lookup failed');
    return missing ? null : native;
  }, onError: error => errors.push(error) });
  await sync.update({ data: fixture() });
  throwing = true;
  await sync.refresh();
  assert.equal(errors.length, 1);
  throwing = false;
  await sync.refresh();
  assert.equal(sent.length, 2);
  missing = true;
  await sync.refresh();
  missing = false;
  await sync.refresh();
  assert.equal(sent.length, 3);
});

test('post-sync status failure retries latest opt-out and queued state survives a failed sync', async () => {
  let reads = 0;
  const sent = [], errors = [];
  const gate = deferred();
  const native = { status: async () => { if (++reads === 2) throw Error('status failed'); return status; },
    sync: async p => { sent.push(p); if (sent.length === 3) { await gate.promise; throw Error('sync failed'); } } };
  const sync = createNativeAlarmSync({ bridge: () => native, onError: e => errors.push(e) });
  await sync.update({ data: fixture() });
  await sync.refresh();
  assert.equal(sent.length, 2);
  assert.equal(errors.length, 1);
  const first = sync.update({ data: { ...fixture(), slots: [] } });
  await new Promise(resolve => setImmediate(resolve));
  sync.update({ data: { reminders: false } });
  gate.resolve();
  await first;
  assert.deepEqual(sent.at(-1), { enabled: false, slots: [], meds: [], checks: [] });
  assert.equal(sent.length, 4);
});

test('rehydration, edits, checks, restore and permission changes sync; unchanged payload deduplicates', async () => {
  const sent = [];
  let permission = { ...status };
  const sync = createNativeAlarmSync({ bridge: () => ({ status: async () => permission,
    sync: async payload => { sent.push(payload); } }) });
  const data = fixture();
  await sync.update({ data });
  assert.equal(sent.length, 1);
  await sync.update({ data: { ...data, entries: {} } });
  assert.equal(sent.length, 1);
  data.slots[0].time = '10:00';
  await sync.update({ data });
  assert.equal(sent.at(-1).slots[0].time, '10:00');
  // Use an actual future check so the test is independent of the machine date.
  data.checks['2099-01-01|s|m'] = true;
  data.meds[1].slotIds = ['s'];
  delete data.meds[1].until;
  await sync.update({ data });
  assert.ok(sent.at(-1).checks.includes('2099-01-01|s|m'));
  await sync.update({ data: { ...data, reminders: false, checks: {} } });
  assert.equal(sent.at(-1).enabled, false);
  permission = { notifications: false, exact: true, enabled: false };
  await sync.refresh();
  assert.equal(sent.length, 5);
  sync.stop();
  await sync.refresh();
  assert.equal(sent.length, 5);
});

test('demo and failed rehydration never cancel real alarms, including during status lookup', async () => {
  const gate = deferred();
  const sent = [];
  const sync = createNativeAlarmSync({ bridge: () => ({ status: () => gate.promise, sync: async p => sent.push(p) }) });
  const first = sync.update({ data: fixture() });
  sync.update({ demo: true, data: { reminders: false } });
  gate.resolve(status);
  await first;
  assert.deepEqual(sent, []);
  await sync.update({ storageError: 'corrupt journal', data: { reminders: false } });
  assert.deepEqual(sent, []);
  await sync.update({ data: fixture() });
  assert.equal(sent.length, 1);
  await sync.update({ demo: true, data: { reminders: false } });
  assert.equal(sent.length, 1);
});

test('in-flight calls serialize, coalesce edits and apply opt-out last', async () => {
  const gate = deferred();
  const sent = [];
  const sync = createNativeAlarmSync({ bridge: () => ({ status: async () => status,
    sync: async p => { sent.push(p); if (sent.length === 1) await gate.promise; } }) });
  const first = sync.update({ data: fixture() });
  await new Promise(resolve => setImmediate(resolve));
  sync.update({ data: { ...fixture(), slots: [] } });
  sync.update({ data: { ...fixture(), reminders: false } });
  assert.equal(sent.length, 1);
  gate.resolve();
  await first;
  assert.equal(sent.length, 2);
  assert.equal(sent[1].enabled, false);
});

test('late injection and bridge failures retry without prompting or claiming success', async () => {
  let native = null;
  let fail = true;
  const errors = [];
  const sent = [];
  const sync = createNativeAlarmSync({ bridge: () => native, onError: e => errors.push(e) });
  await sync.update({ data: fixture() });
  native = { status: async () => status, sync: async p => { if (fail) throw Error('offline'); sent.push(p); } };
  await sync.refresh();
  assert.equal(errors.length, 1);
  fail = false;
  await sync.refresh();
  assert.equal(sent.length, 1);
  native.status = async () => { throw Error('unavailable'); };
  await sync.refresh();
  assert.equal(errors.length, 2);
  sync.stop();
});

test('Android settings render background/permission guidance and gesture APIs without requiring calendar import', async () => {
  const { build } = await import('esbuild');
  const originals = new Map(['window', 'document', 'location', '__nativeUITest'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const messages = [];
  const calls = [];
  const app = { data: fixture(), demo: false, notify: m => messages.push(m), update(fn) { fn(this.data); return true; } };
  const win = new EventTarget();
  win.ongyeolAlarms = { status: async () => status, requestPermission: async () => calls.push('permission'), requestExact: async () => calls.push('exact') };
  const states = [];
  const effects = [];
  let cursor = 0;
  const runtime = { app, useEffect(effect) { effects.push(effect); }, useRef: value => ({ current: value }),
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], value => { states[i] = value; }]; },
    createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity) }; } };
  function set(key, value) { Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
  try {
    set('window', win); set('location', { origin: 'https://appassets.androidplatform.net' }); set('__nativeUITest', runtime);
    const built = await build({ entryPoints: [new URL('../src/features/Reminders.jsx', import.meta.url).pathname], bundle: true,
      write: false, format: 'esm', platform: 'node', logLevel: 'silent', plugins: [{ name: 'native-ui', setup(plugin) {
        plugin.onResolve({ filter: /^(react|lucide-react)$|core\.jsx$/ }, args => ({ path: args.path, namespace: 'mock' }));
        plugin.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'react'
          ? 'export const {useEffect,useRef,useState}=globalThis.__nativeUITest; export default globalThis.__nativeUITest;'
          : args.path === 'lucide-react' ? 'export const Bell=()=>null,BellOff=Bell,CalendarDays=Bell,Download=Bell,ShieldCheck=Bell;'
            : 'export const useApp=()=>globalThis.__nativeUITest.app;', loader: 'js' }));
      } }] });
    const { ReminderSettings, ReminderEngine } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
    const render = () => { cursor = 0; return ReminderSettings(); };
    const nodes = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];
    const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? node.children.map(text).join('') : '';
    let tree = render();
    assert.match(text(tree), /앱을 닫거나 화면을 잠가도/);
    assert.match(text(tree), /강제 종료/);
    assert.match(text(tree), /캘린더 파일을 가져올 필요는 없어요/);
    assert.equal(calls.length, 0, 'render never prompts');
    const permissionButton = nodes(tree).find(n => n.type === 'button' && text(n) === '알림 권한 허용하기');
    await permissionButton.props.onClick();
    assert.deepEqual(calls, ['permission']);
    tree = render();
    assert.match(text(tree), /대략적인 시간/);
    await nodes(tree).find(n => n.type === 'button' && text(n) === '정확한 시각 알림 허용하기').props.onClick();
    assert.deepEqual(calls, ['permission', 'exact']);
    app.demo = true;
    tree = render();
    assert.ok(nodes(tree).filter(n => n.type === 'button').every(n => n.props.disabled));
    assert.ok(messages.length >= 2);

    // Mount the actual engine to verify late injection, lifecycle listeners,
    // update effects and demo isolation, in addition to controller unit tests.
    const doc = new EventTarget();
    doc.visibilityState = 'visible';
    set('document', doc);
    const intervals = new Map();
    let timer = 0;
    win.setInterval = callback => { intervals.set(++timer, callback); return timer; };
    win.clearInterval = id => intervals.delete(id);
    const sent = [];
    delete win.ongyeolAlarms;
    app.demo = false;
    effects.length = 0;
    assert.equal(ReminderEngine(), null);
    const cleanups = effects.map(effect => effect());
    const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
    await flush();
    assert.deepEqual(sent, []);
    win.ongyeolAlarms = { status: async () => status, sync: async payload => sent.push(payload) };
    win.dispatchEvent(new Event('ongyeol-alarms-ready'));
    await flush();
    assert.equal(sent.length, 1);
    app.data = { ...app.data, reminders: false };
    effects[2]();
    await flush();
    assert.equal(sent.at(-1).enabled, false);
    app.demo = true;
    app.data = { ...app.data, reminders: true };
    effects[2]();
    win.dispatchEvent(new Event('focus'));
    await flush();
    assert.equal(sent.length, 2, 'demo cannot replace real alarms');
    app.demo = false;
    effects[2]();
    await flush();
    assert.equal(sent.at(-1).enabled, true);
    for (const cleanup of cleanups) cleanup?.();
    assert.equal(intervals.size, 0);
    win.dispatchEvent(new Event('ongyeol-alarms-ready'));
    await flush();
    assert.equal(sent.length, 3);
  } finally {
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
