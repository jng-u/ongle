import test from 'node:test';
import assert from 'node:assert/strict';
import { checkKey } from '../src/model.js';
import {
  activeVersions, buildReminderCalendar, createReminderDelivery, dueReminders,
  escapeICalText, foldICalLine, isDateKey, reminderFingerprint, scheduledReminders,
} from '../src/data/alarms.js';

const NOW = new Date('2026-11-16T03:00:00Z');
function fixture() {
  return {
    slots: [{ id: 'morning', name: '아침', time: '08:00', from: '2026-11-01' }],
    meds: [{ id: 'pill', name: '비공개 약', dose: '1정', slotIds: ['morning'], from: '2026-11-01' }],
    checks: {}, visits: [],
  };
}
function calendar(data, options = {}) {
  return buildReminderCalendar(data, { startDate: '2026-11-16', endDate: '2026-11-20', now: NOW, ...options });
}
const unfold = text => text.replace(/\r\n[ \t]/g, '');
function events(text) {
  return unfold(text).split('BEGIN:VEVENT\r\n').slice(1).map(event => event.split('END:VEVENT')[0]);
}
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('date validation rejects rollover dates and malformed values', () => {
  assert.equal(isDateKey('2028-02-29'), true);
  for (const value of ['2026-02-29', '2026-11-31', '2026-1-01', '', undefined]) assert.equal(isDateKey(value), false);
});

test('version start inclusive, end exclusive, no mutation or overlapping duplicates', () => {
  const versions = [
    { id: 'a', from: '2026-11-01', time: '08:00' },
    { id: 'a', from: '2026-11-16', until: '2026-11-20', time: '09:00' },
  ];
  assert.equal(activeVersions(versions, '2026-11-15')[0].time, '08:00');
  assert.equal(activeVersions(versions, '2026-11-16')[0].time, '09:00');
  assert.equal(activeVersions(versions, '2026-11-20').length, 0);
  assert.equal(versions[0].until, undefined);
});

test('only registered medications at active slots are eligible', () => {
  const data = fixture();
  data.slots.push({ id: 'empty', time: '10:00', from: '2026-11-01' });
  data.meds[0].until = '2026-11-17';
  assert.equal(scheduledReminders(data, '2026-11-16').length, 1);
  assert.equal(scheduledReminders(data, '2026-11-17').length, 0);
  data.meds[0].from = '2026-11-18';
  assert.equal(scheduledReminders(data, '2026-11-16').length, 0);
});

test('completed medications are excluded, partial checks keep a single pending reminder', () => {
  const data = fixture();
  data.meds.push({ ...data.meds[0], id: 'pill2' });
  data.checks[checkKey('2026-11-16', 'morning', 'pill')] = true;
  assert.deepEqual(scheduledReminders(data, '2026-11-16')[0].pending.map(med => med.id), ['pill2']);
  data.checks[checkKey('2026-11-16', 'morning', 'pill2')] = true;
  assert.equal(dueReminders(data, new Date(2026, 10, 16, 8, 0)).length, 0);
});

test('foreground due window uses actual local date, not selected date or yesterday', () => {
  const data = fixture();
  assert.equal(dueReminders(data, new Date(2026, 10, 16, 7, 59, 59)).length, 0);
  assert.equal(dueReminders(data, new Date(2026, 10, 16, 8, 0)).length, 1);
  assert.equal(dueReminders(data, new Date(2026, 10, 16, 8, 1, 59)).length, 1);
  assert.equal(dueReminders(data, new Date(2026, 10, 16, 8, 2)).length, 0);
  data.slots[0].time = '23:59';
  assert.equal(dueReminders(data, new Date(2026, 10, 17, 0, 0)).length, 0);
  data.slots[0].time = '00:00';
  assert.equal(dueReminders(data, new Date(2026, 10, 17, 0, 0))[0].date, '2026-11-17');
});

test('dedup persists across delivery instances, rolls over daily, and retries failed sends', async () => {
  const storage = memoryStorage();
  const reminders = dueReminders(fixture(), new Date(2026, 10, 16, 8, 0));
  const deliver = createReminderDelivery(storage);
  let count = 0;
  const show = async () => { count += 1; };
  assert.equal(await deliver(reminders, async () => { throw new Error('OS failure'); }), 0);
  assert.equal(await deliver(reminders, show), 1);
  assert.equal(await createReminderDelivery(storage)(reminders, show), 0);
  assert.equal(await deliver(dueReminders(fixture(), new Date(2026, 10, 17, 8, 0)), show), 1);
  assert.equal(count, 2);
});

test('dedup tolerates denied/corrupt local storage and prevents concurrent dispatch', async () => {
  const storage = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } };
  const deliver = createReminderDelivery(storage);
  const reminders = dueReminders(fixture(), new Date(2026, 10, 16, 8, 0));
  let resolve;
  const pending = deliver(reminders, () => new Promise(done => { resolve = done; }));
  assert.equal(await deliver(reminders, async () => {}), 0);
  resolve();
  assert.equal(await pending, 1);
  assert.equal(await deliver(reminders, async () => {}), 0);
  assert.equal(await createReminderDelivery({ getItem: () => '{', setItem() {} })(reminders, async () => {}), 1);
});

test('delivery rechecks opt-in and skips checked/disabled reminders', async () => {
  const deliver = createReminderDelivery(memoryStorage());
  const reminders = dueReminders(fixture(), new Date(2026, 10, 16, 8, 0));
  assert.equal(await deliver(reminders, async () => assert.fail('disabled'), () => false), 0);
  assert.equal(await deliver(reminders.map(reminder => ({ ...reminder, pending: [] })), async () => assert.fail('checked')), 0);
  assert.equal(await deliver(reminders, async () => {}), 1);
});

test('calendar is private by default, recurring, floating, and bounded inclusively', () => {
  const result = calendar(fixture());
  const text = unfold(result.text);
  assert.equal(result.eventCount, 1);
  assert.match(text, /DTSTART:20261116T080000\r\n/);
  assert.match(text, /RRULE:FREQ=DAILY;UNTIL=20261120T080000\r\n/);
  assert.match(text, /DTSTAMP:20261116T030000Z/);
  assert.match(text, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:PT0S\r\nDESCRIPTION:/);
  assert.match(text, /SUMMARY:나를 돌볼 시간/);
  assert.doesNotMatch(text, /비공개 약|아침|TZID|ATTENDEE|ORGANIZER/);
  assert.equal(result.text.replaceAll('\r\n', '').includes('\n'), false);
  assert.ok(result.text.endsWith('END:VCALENDAR\r\n'));
});

test('calendar preserves slot history and exclusive medication cutoffs without empty slots', () => {
  const data = fixture();
  data.slots[0].until = '2026-11-18';
  data.slots.push({ ...data.slots[0], from: '2026-11-18', until: undefined, time: '09:30' });
  data.meds[0].until = '2026-11-20';
  const list = events(calendar(data).text);
  assert.equal(list.length, 2);
  assert.match(list[0], /DTSTART:20261116T080000/);
  assert.match(list[0], /UNTIL=20261117T080000/);
  assert.match(list[1], /DTSTART:20261118T093000/);
  assert.match(list[1], /UNTIL=20261119T093000/);
  assert.equal(calendar(data, { startDate: '2026-11-20' }).eventCount, 0);
});

test('medication versions change slot membership without changing historical events', () => {
  const data = fixture();
  data.slots.push({ id: 'evening', time: '20:00', from: '2026-11-01' });
  data.meds[0].until = '2026-11-18';
  data.meds.push({ ...data.meds[0], from: '2026-11-18', until: undefined, slotIds: ['evening'] });
  const before = JSON.stringify(data);
  const list = events(calendar(data).text);
  assert.equal(list.length, 2);
  assert.match(list[0], /UNTIL=20261117T080000/);
  assert.match(list[1], /DTSTART:20261118T200000/);
  assert.equal(JSON.stringify(data), before);
});

test('calendar excludes checked dates and omits fully checked series', () => {
  const data = fixture();
  data.checks[checkKey('2026-11-17', 'morning', 'pill')] = true;
  assert.match(calendar(data).text, /EXDATE:20261117T080000/);
  assert.equal(calendar(data, { startDate: '2026-11-17', endDate: '2026-11-17' }).eventCount, 0);
});

test('RFC text escaping prevents content-line injection and preserves special characters', () => {
  assert.equal(escapeICalText('약\\이름; 아침, 저녁\r\nEND:VEVENT\r다음\n줄'), '약\\\\이름\\; 아침\\, 저녁\\nEND:VEVENT\\n다음\\n줄');
  const data = fixture();
  data.meds[0].name = '약;하나,둘\\셋\nBEGIN:VEVENT';
  const text = unfold(calendar(data, { includeDetails: true }).text);
  assert.equal(events(text).length, 1);
  assert.match(text, /약\\;하나\\,둘\\\\셋\\nBEGIN:VEVENT/);
});

test('UTF-8 folding stays within 75 octets and roundtrips Korean and emoji', () => {
  const line = `SUMMARY:${'한글💚,;'.repeat(50)}`;
  const folded = foldICalLine(line);
  assert.equal(unfold(folded), line);
  for (const part of folded.split('\r\n')) assert.ok(new TextEncoder().encode(part).length <= 75);
  const data = fixture();
  data.meds[0].name = '복약💚'.repeat(80);
  for (const part of calendar(data, { includeDetails: true }).text.split('\r\n')) {
    assert.ok(new TextEncoder().encode(part).length <= 75);
  }
});

test('optional visits/exams are bounded, deduplicated, timed and private', () => {
  const data = fixture();
  data.visits = [
    { id: 'v', date: '2026-11-20', time: '09:00', title: '비공개 진료', place: '병원', type: 'visit' },
    { id: 'v', date: '2026-11-20', time: '09:00', title: '비공개 진료', type: 'visit' },
    { id: 'exam', date: '2026-11-18', time: '14:30', title: '비공개 검사', type: 'exam' },
    { id: 'old', date: '2026-11-15', time: '09:00' },
    { id: 'no-time', date: '2026-11-17', time: '' },
    { id: 'later', date: '2026-11-21', time: '09:00' },
  ];
  assert.equal(calendar(data).eventCount, 1);
  const result = calendar(data, { includeVisits: true });
  assert.equal(result.eventCount, 3);
  assert.doesNotMatch(result.text, /비공개|병원/);
  assert.equal(events(result.text).filter(event => event.includes('TRIGGER:-PT30M')).length, 2);
  assert.match(unfold(calendar(data, { includeVisits: true, includeDetails: true, visitMinutes: 15 }).text), /SUMMARY:비공개 검사/);
});

test('invalid export bounds fail explicitly and fingerprint tracks schedule changes only', () => {
  for (const options of [{ endDate: '2026-11-15' }, { startDate: 'garbage' }, { endDate: '2100-01-01' }]) {
    assert.throws(() => calendar(fixture(), options), /날짜/);
  }
  const data = fixture();
  const fingerprint = reminderFingerprint(data);
  data.checks.foo = true;
  data.entries = { '2026-11-16': { note: '민감한 기록' } };
  assert.equal(reminderFingerprint(data), fingerprint);
  data.slots[0].time = '09:00';
  assert.notEqual(reminderFingerprint(data), fingerprint);
});

test('engine never prompts, ignores demo/hidden/disabled state, dedups and stops on unmount', async () => {
  // Use Vite's existing compiler, without adding a DOM or test dependency.
  const { build } = await import('esbuild');
  const original = new Map(['window', 'document', 'navigator', 'Notification', '__reminderTest']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const data = fixture();
  data.reminders = true;
  data.slots[0].from = data.meds[0].from = '1900-01-01';
  data.slots[0].time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const effects = [];
  const intervals = new Map();
  let prompted = 0;
  const shown = [];
  const app = { data, demo: true, notify() {} };
  const win = new EventTarget();
  Object.assign(win, { isSecureContext: true, localStorage: memoryStorage(),
    setInterval(callback) { intervals.set(1, callback); return 1; }, clearInterval(id) { intervals.delete(id); } });
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const notification = { permission: 'granted', requestPermission() { prompted += 1; return Promise.resolve('granted'); } };
  win.Notification = notification;
  const nav = { serviceWorker: { async getRegistration() {
    return { scope: 'https://example.test/', active: { scriptURL: 'https://example.test/sw.js' },
      async showNotification(title, options) { shown.push({ title, options }); } };
  } }, locks: { async request(_name, _options, callback) { return callback({}); } } };
  const runtime = { app, useEffect: effect => effects.push(effect), useRef: value => ({ current: value }), useState() {} };
  const setGlobal = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
  try {
    setGlobal('window', win); setGlobal('document', doc); setGlobal('navigator', nav);
    setGlobal('Notification', notification); setGlobal('__reminderTest', runtime);
    const bundled = await build({ entryPoints: [new URL('../src/features/Reminders.jsx', import.meta.url).pathname],
      bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', plugins: [{
        name: 'reminder-engine-test', setup(plugin) {
          plugin.onResolve({ filter: /^(react|lucide-react)$|core\.jsx$/ }, args => ({ path: args.path, namespace: 'test-mocks' }));
          plugin.onLoad({ filter: /.*/, namespace: 'test-mocks' }, args => ({ contents:
            args.path === 'react' ? 'export const {useRef,useEffect,useState}=globalThis.__reminderTest; export default {};' :
              args.path === 'lucide-react' ? 'export const Bell=()=>null,BellOff=Bell,CalendarDays=Bell,Download=Bell,ShieldCheck=Bell;' :
                'export const useApp=()=>globalThis.__reminderTest.app;', loader: 'js' }));
        },
      }] });
    const { ReminderEngine } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
    assert.equal(ReminderEngine(), null);
    const cleanup = effects[0]();
    await flush();
    assert.equal(shown.length, 0, 'demo must never notify');
    app.demo = false;
    doc.visibilityState = 'hidden';
    await intervals.get(1)();
    assert.equal(shown.length, 0, 'hidden app must not claim background reliability');
    doc.visibilityState = 'visible';
    data.reminders = false;
    await intervals.get(1)();
    assert.equal(shown.length, 0, 'explicit opt-in required');
    data.reminders = true;
    notification.permission = 'denied';
    await intervals.get(1)();
    assert.equal(shown.length, 0, 'denial is respected');
    notification.permission = 'granted';
    data.checks[checkKey(date, 'morning', 'pill')] = true;
    await intervals.get(1)();
    assert.equal(shown.length, 0, 'completed medications must not notify');
    data.checks = {};
    await intervals.get(1)();
    assert.equal(shown.length, 1);
    assert.equal(shown[0].options.data.url, '/#today');
    assert.doesNotMatch(JSON.stringify(shown), /비공개 약|1정/);
    await intervals.get(1)();
    assert.equal(shown.length, 1, 'one notification per date/slot/time');
    assert.equal(prompted, 0, 'mount and timer never request permission');
    cleanup();
    assert.equal(intervals.size, 0);
    win.dispatchEvent(new Event('focus'));
    await flush();
    assert.equal(shown.length, 1);
  } finally {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
