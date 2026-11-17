import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { encryptBackup, decryptBackup, validateBackupData, backupCounts, MAX_BACKUP_BYTES } from '../src/data/backup.js';
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const password = '나만 아는 백업 비밀번호';
const fixture = () => ({ version: 1, reminders: true,
  slots: [{ id: 'morning', name: '아침', time: '08:00', from: '2026-10-01' }],
  meds: [{ id: 'med1', name: '기록한 약', dose: '1정', note: '식후', slotIds: ['morning'], from: '2026-10-01', until: '2026-12-01', reference: { url: 'https://example.com', label: '출처' } }],
  checks: { '2026-11-15|morning|med1': true },
  entries: { '2026-11-15': { condition: 4, pain: 0, stools: 2, blood: false, note: '괜찮은 하루' } },
  visits: [{ id: 'v1', date: '2026-11-20', time: '', title: '진료', place: '병원', note: '', type: 'visit' }],
  labs: [{ id: 'l1', date: '2026-11-14', name: 'CRP', value: 0.4, unit: 'mg/dL', low: null, high: 0.5, source: '검사지', reference: { publisher: '검사 기관' } }],
  preferences: { compact: true },
});

test('encrypted round trip preserves records and safe extensions, disables reminders, and never mutates input', async () => {
  const data = fixture();
  data.diaryBuiltins = {pain:true,stools:false,blood:false};
  data.diaryFields = [{id:'fatigue',label:'피로감',type:'scale',enabled:false}];
  data.entries['2026-11-15'].custom = [{id:'fatigue',label:'피로감',type:'scale',value:0},{id:'old',label:'두통',type:'boolean',value:false}];
  const original = structuredClone(data);
  const encrypted = await encryptBackup(data, password);
  assert.ok(!encrypted.includes('기록한 약'));
  assert.ok(!encrypted.includes('괜찮은 하루'));
  const restored = await decryptBackup(encrypted, password);
  assert.deepEqual(restored, { ...original, reminders: false });
  assert.deepEqual(data, original);
  restored.preferences.compact = false;
  assert.equal(data.preferences.compact, true);
  assert.deepEqual(backupCounts(data), { meds: 1, entries: 1, visits: 1, labs: 1 });
});

test('each export uses independent random salt, IV, and ciphertext', async () => {
  const a = JSON.parse(await encryptBackup(fixture(), password));
  const b = JSON.parse(await encryptBackup(fixture(), password));
  for (const field of ['salt', 'iv', 'ciphertext']) assert.notEqual(a[field], b[field]);
});

test('wrong password and authenticated ciphertext tampering fail without changing existing data', async () => {
  const data = fixture();
  const before = structuredClone(data);
  const encrypted = await encryptBackup(data, password);
  await assert.rejects(decryptBackup(encrypted, '다른 비밀번호입니다'), /비밀번호/);
  const envelope = JSON.parse(encrypted);
  const bytes = Buffer.from(envelope.ciphertext, 'base64');
  bytes[0] ^= 1;
  envelope.ciphertext = bytes.toString('base64');
  await assert.rejects(decryptBackup(JSON.stringify(envelope), password), /손상/);
  assert.deepEqual(data, before);
});

test('malformed, plaintext, oversized and unsupported envelopes are rejected', async () => {
  const valid = JSON.parse(await encryptBackup(fixture(), password));
  const candidates = ['', '{', 'null', '[]', JSON.stringify(fixture()), ' '.repeat(MAX_BACKUP_BYTES + 1)];
  for (const patch of [
    { version: 2 }, { iterations: 1 }, { iterations: 9999999999 }, { cipher: 'AES-CBC' },
    { salt: 'AAAA' }, { iv: 'x'.repeat(16) }, { ciphertext: '!!!=' },
    { kdf: 'unknown' }, { extra: true }, { format: 'other' },
  ]) candidates.push(JSON.stringify({ ...valid, ...patch }));
  candidates.push(JSON.stringify(valid).replace('"format":', '"__proto__":{},"format":'));
  for (const candidate of candidates) await assert.rejects(decryptBackup(candidate, password));
});

test('schema rejects invalid dates, invalid types, versions, check keys and nested poisoned fields', () => {
  const mutations = [
    d => { d.version = 2; }, d => { d.reminders = 'yes'; }, d => { delete d.entries; },
    d => { d.slots[0].time = '25:00'; }, d => { d.slots[0].from = '2026-02-30'; },
    d => { d.slots[0].until = '2026-09-01'; }, d => { d.meds[0].slotIds = ['bad|id']; },
    d => { d.checks = { '2026-11-15|morning|med1': false }; },
    d => { d.checks = { '2026-02-30|morning|med1': true }; },
    d => { d.checks = { '2026-11-15|morning|med1|extra': true }; },
    d => { d.entries['2026-11-15'].condition = 6; }, d => { d.entries['2026-11-15'].pain = -1; },
    d => { d.entries['2026-11-15'].stools = 1.5; }, d => { d.entries['2026-11-15'].blood = 1; },
    d => { d.diaryFields = [{id:'s',label:'척도',type:'scale',enabled:'yes'}]; },
    d => { d.entries['2026-11-15'].custom = [{id:'s',label:'척도',type:'scale',value:11}]; },
    d => { d.entries['2026-11-15'].custom = [{id:'old',label:{},type:'boolean',value:false}]; },
    d => { d.visits[0].type = 'other'; }, d => { d.labs[0].value = Infinity; },
    d => { d.labs[0].high = 'high'; }, d => { d.labs[0].note = {}; },
    d => { d.labs[0].reference = { url: 'javascript:alert(1)' }; },
    d => { d.labs[0].reference = { publisher: {} }; },
    d => { d.labs[0].lowInclusive = 'true'; }, d => { d.labs[0].source = {}; },
    d => { d.preferences = JSON.parse('{"__proto__":{"polluted":true}}'); },
    d => { d.preferences = { safe: [{ constructor: { prototype: { polluted: true } } }] }; },
    d => { d.preferences = Object.create({ inherited: true }); },
    d => { d.preferences = { unsupported: undefined }; },
    d => { d.preferences = { huge: 'a'.repeat(5 * 1024 * 1024) }; },
    d => { d.preferences = d; },
  ];
  for (const mutate of mutations) {
    const data = fixture(); mutate(data);
    assert.throws(() => validateBackupData(data));
  }
  assert.equal({}.polluted, undefined);
});

// Produce authenticated invalid payloads to exercise validation after decryption,
// independently of the exporter (which correctly refuses invalid input).
async function sealRaw(raw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 310000, salt }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(raw));
  return JSON.stringify({ format: 'ongle-encrypted-backup', version: 1, kdf: 'PBKDF2-SHA256', iterations: 310000,
    cipher: 'AES-256-GCM', salt: Buffer.from(salt).toString('base64'), iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(ciphertext).toString('base64') });
}

test('authenticated but malformed, mismatched-version, and prototype-poisoned plaintext cannot restore', async () => {
  for (const raw of ['{', JSON.stringify({ ...fixture(), version: 2 }),
    JSON.stringify(fixture()).replace('"preferences":', '"__proto__":{"polluted":true},"preferences":'),
    JSON.stringify({ ...fixture(), labs: [{ ...fixture().labs[0], value: 'bad' }] })]) {
    await assert.rejects(decryptBackup(await sealRaw(raw), password));
  }
  assert.equal({}.polluted, undefined);
});

test('password bounds and nullable health fields are handled explicitly', async () => {
  await assert.rejects(encryptBackup(fixture(), 'short'), /8자/);
  await assert.rejects(decryptBackup('{}', 'x'.repeat(1025)), /1,024/);
  const data = fixture();
  data.entries['2026-11-15'] = { condition: null, pain: null, stools: null, blood: null, note: '' };
  assert.deepEqual(validateBackupData(data), data);
});

test('summary renders exact 30-day boundaries, scheduled history, empty states, and escaped notes', async () => {
  const { build } = await import('esbuild');
  const { runInNewContext } = await import('node:vm');
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const result = await build({
    stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx', contents: `
      import React from 'react';
      import {renderToStaticMarkup} from 'react-dom/server';
      import {AppProvider} from './src/core.jsx';
      import {BackupSettings} from './src/features/Backup.jsx';
      import {SummaryDialog, SummarySheet as TestSummarySheet} from './src/features/Summary.jsx';
      import {blankJournal} from './src/model.js';
      import assert from 'node:assert/strict';
      globalThis.location = {hash:'#settings'};
      const data = blankJournal();
      globalThis.localStorage = {getItem:()=>JSON.stringify(data)};
      let html = renderToStaticMarkup(<TestSummarySheet data={data} end="2026-11-16"/>);
      assert.ok(html.includes('2026-10-18 ~ 2026-11-16'));
      assert.ok(html.includes('이 기간에 남긴 하루 기록이 없어요'));
      const entry = {custom:[{id:'energy',label:'활력',type:'scale',value:0},{id:'dizzy',label:'어지러움',type:'boolean',value:false}],condition:3,pain:0,stools:0,blood:false,note:'<img src=x onerror=alert(1)>'};
      data.entries = {'2026-10-17':{...entry,note:'EXCLUDED_OLD'},'2026-10-18':entry,'2026-11-16':entry,'2026-11-17':{...entry,note:'EXCLUDED_FUTURE'}};
      data.meds = [{id:'m',name:'현재 약',dose:'1정',note:'',slotIds:['morning'],from:'2026-10-18'}];
      data.checks = {'2026-10-18|morning|m':true};
      data.labs = [{id:'old',date:'2026-10-17',name:'EXCLUDED_LAB',value:1,unit:'mg/L',low:null,high:null},
        {id:'lab',date:'2026-11-16',name:'CRP',value:0,unit:'mg/L',low:null,high:5,highInclusive:false,source:'javascript:unsafe'}];
      data.visits = [{id:'v',date:'2026-11-16',time:'',title:'외래 일정',place:'',note:'진료 메모',type:'visit'}];
      html = renderToStaticMarkup(<TestSummarySheet data={data} end="2026-11-16" demo/>);
      assert.ok(html.includes('체험 기록'));
      assert.ok(html.includes('몸 상태 · 2일 기록'));
      assert.ok(html.includes('활력 · 0/10') && html.includes('어지러움 · X'));
      assert.ok(html.includes('예정 30회 중 복용 체크 1회'));
      assert.ok(html.includes('외래 일정') && html.includes('진료 메모'));
      assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
      assert.ok(html.includes('&lt; 5'));
      assert.ok(!html.includes('EXCLUDED_'));
      assert.ok(!html.includes('<img') && !html.includes('href='));
      html = renderToStaticMarkup(<TestSummarySheet data={data} start="2026-11-16" end="2026-11-16"/>);
      assert.ok(html.includes('몸 상태 · 1일 기록') && html.includes('예정 1회 중 복용 체크 0회'));
      assert.ok(html.includes('2026-11-16 ~ 2026-11-16'));
      assert.equal(renderToStaticMarkup(<SummaryDialog name="med"/>), '');
      const settings = renderToStaticMarkup(<AppProvider><BackupSettings/></AppProvider>);
      assert.ok(settings.includes('비밀번호 확인') && settings.includes('복원 미리보기'));
      assert.ok(!settings.includes('현재 기록 교체하기'));
      console.log('summary rendering passed');
    ` }, bundle: true, platform: 'node', format: 'cjs', write: false,
    loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  let rendered = false;
  runInNewContext(result.outputFiles[0].text, {
    require: createRequire(import.meta.url), process, TextEncoder, TextDecoder, Buffer, URL,
    setTimeout, clearTimeout, setImmediate, clearImmediate,
    console: { ...console, log: message => { rendered = message === 'summary rendering passed'; } },
  });
  assert.equal(rendered, true);
});
