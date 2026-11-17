import {normalizeSchedule} from '../model.js';
/** Portable file format. All cryptography stays on the device. */
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
const MAX_DATA_BYTES = 5 * 1024 * 1024;
const ITERATIONS = 310000;
const FORMAT = 'ongle-encrypted-backup';
const encoder = new TextEncoder();
const invalid = () => new Error('백업 형식이나 기록이 올바르지 않아요. 온결 백업 파일을 확인해 주세요.');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const text = (value, max = MAX_DATA_BYTES) => typeof value === 'string' && value.length <= max;
const id = value => text(value, 200) && value.length > 0 && !/[|\u0000-\u001f]/.test(value);
const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
}
function assert(ok) { if (!ok) throw invalid(); }

// Reject dangerous keys at every depth, including otherwise unknown extension fields.
// Bound traversal before serialization to reject cyclic, exotic or enormous objects.
function inspect(value, depth = 0, budget = { nodes: 0 }) {
  assert(depth <= 32 && ++budget.nodes <= 150000);
  if (value === null || typeof value === 'boolean' || finite(value)) return;
  if (typeof value === 'string') { assert(value.length <= MAX_DATA_BYTES); return; }
  assert(Array.isArray(value) || object(value));
  for (const key of Object.keys(value)) {
    assert(!['__proto__', 'prototype', 'constructor'].includes(key));
    inspect(value[key], depth + 1, budget);
  }
}

/** Validate first, return an independent copy. Safe extension fields survive. */
export function validateBackupData(value, { importing = false } = {}) {
  inspect(value);
  assert(object(value) && value.version === 1 && typeof value.reminders === 'boolean');
  assert(value.restoreGeneration === undefined || id(value.restoreGeneration));
  for (const name of ['slots', 'meds', 'visits', 'labs']) assert(Array.isArray(value[name]) && value[name].length <= 20000);
  assert(object(value.checks) && object(value.entries));
  const effective = item => object(item) && id(item.id) && date(item.from)
    && (item.until === undefined || (date(item.until) && item.until >= item.from));
  // Effective intervals are half-open: adjacent versions of one identity are valid.
  for (const name of ['slots', 'meds']) {
    const groups = new Map();
    for (const item of value[name]) {
      assert(effective(item));
      const versions = groups.get(item.id) || [];
      versions.push(item); groups.set(item.id, versions);
    }
    for (const versions of groups.values()) {
      versions.sort((a,b) => a.from.localeCompare(b.from));
      for (let i=1; i<versions.length; i++) assert(versions[i-1].from !== versions[i].from
        && versions[i-1].until !== undefined && versions[i-1].until <= versions[i].from);
    }
  }
  for (const name of ['visits', 'labs']) assert(new Set(value[name].map(item => item?.id)).size === value[name].length);
  value.slots.forEach(item => assert(effective(item) && text(item.name, 500) && time(item.time)));
  value.meds.forEach(item => assert(effective(item) && text(item.name, 500) && text(item.dose, 2000)
    && text(item.note) && Array.isArray(item.slotIds) && item.slotIds.length <= 200 && item.slotIds.every(id) && new Set(item.slotIds).size === item.slotIds.length));
  for (const med of value.meds) {
    try { normalizeSchedule(med.schedule); } catch { throw invalid(); }
  }
  for (const [key, checked] of Object.entries(value.checks)) {
    const parts = key.split('|');
    assert(parts.length === 3 && date(parts[0]) && id(parts[1]) && id(parts[2]));
    assert(checked === true || (object(checked) && ['name','dose','note','slotName'].every(key => text(checked[key]))
      && (checked.time === '' || time(checked.time)) && text(checked.takenAt,100)
      && (checked.takenAt === '' || (Number.isFinite(Date.parse(checked.takenAt)) && /T/.test(checked.takenAt)))));
  }
  const fieldInfo = item => object(item) && id(item.id) && !['__proto__','constructor','prototype','pain','stools','blood'].includes(item.id)
    && text(item.label, 500) && item.label.trim().length > 0 && ['scale','number','boolean'].includes(item.type);
  const fields = (items, check) => Array.isArray(items) && items.length <= 1000 && items.every(check)
    && new Set(items.map(item => item.id)).size === items.length;
  if(value.diaryFields !== undefined) assert(fields(value.diaryFields, item => fieldInfo(item) && typeof item.enabled === 'boolean'));
  if(value.diaryBuiltins !== undefined) assert(object(value.diaryBuiltins) && Object.entries(value.diaryBuiltins)
    .every(([key,on])=>['pain','stools','blood'].includes(key) && typeof on === 'boolean'));
  const builtinNames = (names, allowDeleted = false) => object(names) && Object.entries(names).every(
    ([key, name]) => ['pain','stools','blood'].includes(key) && ((allowDeleted && name === null) || (text(name, 500) && name.trim().length > 0)));
  if (value.diaryBuiltinNames !== undefined) assert(builtinNames(value.diaryBuiltinNames, true));
  for (const [key, entry] of Object.entries(value.entries)) {
    assert(date(key) && object(entry) && (entry.condition == null || (Number.isInteger(entry.condition) && entry.condition >= 1 && entry.condition <= 5))
      && (entry.pain == null || (finite(entry.pain) && entry.pain >= 0 && entry.pain <= 10))
      && (entry.stools == null || (Number.isInteger(entry.stools) && entry.stools >= 0 && entry.stools <= 1000))
      && (entry.blood == null || typeof entry.blood === 'boolean') && (entry.note === undefined || text(entry.note)));
    if (entry.builtinNames !== undefined) assert(builtinNames(entry.builtinNames));
    if(entry.custom !== undefined) assert(fields(entry.custom, item => fieldInfo(item) && (item.value === null ||
      (item.type === 'boolean' ? typeof item.value === 'boolean' : item.type === 'number' ? finite(item.value) :
      Number.isInteger(item.value) && item.value >= 0 && item.value <= 10))));
  }
  value.visits.forEach(item => assert(object(item) && (item.completed === undefined || typeof item.completed === 'boolean') && id(item.id) && date(item.date)
    && (item.time === '' || time(item.time)) && ['visit', 'exam'].includes(item.type)
    && ['title', 'place', 'note'].every(key => text(item[key]))));
  value.labs.forEach(item => assert(object(item) && id(item.id) && date(item.date) && text(item.name, 500)
    && finite(item.value) && text(item.unit, 500) && (item.low === null || finite(item.low))
    && (item.high === null || finite(item.high)) && (item.source === undefined || text(item.source))
    && (item.note === undefined || text(item.note))));
  // Known feature metadata must remain safe for the existing lab renderer.
  for (const item of value.labs) {
    assert(item.low === null || item.high === null || item.low < item.high ||
      (item.low === item.high && item.lowInclusive !== false && item.highInclusive !== false));
    for (const key of ['lowInclusive', 'highInclusive']) assert(item[key] === undefined || typeof item[key] === 'boolean');
    if (item.reference != null) {
      assert(object(item.reference));
      for (const key of ['id', 'name', 'unit', 'publisher', 'url', 'population', 'caveat', 'bands', 'syncedAt']) {
        assert(item.reference[key] === undefined || text(item.reference[key]));
      }
      if (item.reference.url) {
        let url;
        try { url = new URL(item.reference.url); } catch { throw invalid(); }
        assert(['http:', 'https:'].includes(url.protocol));
      }
    }
  }
  const serialized = JSON.stringify(value);
  assert(encoder.encode(serialized).length <= MAX_DATA_BYTES);
  const copy = JSON.parse(serialized);
  if (importing) copy.reminders = false;
  return copy;
}
function cryptoApi() {
  if (!globalThis.crypto?.subtle) throw new Error('암호화 기능을 사용할 수 없어요. 보안 연결(HTTPS)에서 다시 열어 주세요.');
  return globalThis.crypto;
}
function passwordCheck(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 1024) {
    throw new Error('비밀번호는 8자 이상, 1,024자 이하로 입력해 주세요.');
  }
}
async function derive(password, salt, usage) {
  const crypto = cryptoApi();
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    material, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
function base64(bytes) {
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
function unbase64(value, max) {
  assert(typeof value === 'string' && value.length <= max && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value));
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  assert(base64(bytes) === value);
  return bytes;
}
export async function encryptBackup(data, password) {
  passwordCheck(password);
  const clean = validateBackupData(data);
  const crypto = cryptoApi();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt, 'encrypt');
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(clean)));
  return JSON.stringify({ format: FORMAT, version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS,
    cipher: 'AES-256-GCM', salt: base64(salt), iv: base64(iv), ciphertext: base64(new Uint8Array(encrypted)) });
}
export async function decryptBackup(fileText, password) {
  passwordCheck(password);
  assert(typeof fileText === 'string' && fileText.length <= MAX_BACKUP_BYTES && encoder.encode(fileText).length <= MAX_BACKUP_BYTES);
  let envelope;
  try { envelope = JSON.parse(fileText); } catch { throw invalid(); }
  assert(object(envelope));
  const keys = ['format', 'version', 'kdf', 'iterations', 'cipher', 'salt', 'iv', 'ciphertext'];
  assert(Object.keys(envelope).length === keys.length && keys.every(key => Object.hasOwn(envelope, key)));
  assert(envelope.format === FORMAT && envelope.version === 1 && envelope.kdf === 'PBKDF2-SHA256'
    && envelope.iterations === ITERATIONS && envelope.cipher === 'AES-256-GCM');
  const salt = unbase64(envelope.salt, 24);
  const iv = unbase64(envelope.iv, 16);
  const ciphertext = unbase64(envelope.ciphertext, Math.ceil((MAX_DATA_BYTES + 16) / 3) * 4);
  assert(salt.length === 16 && iv.length === 12 && ciphertext.length >= 16);
  const key = await derive(password, salt, 'decrypt');
  let plaintext;
  try { plaintext = await cryptoApi().subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext); }
  catch { throw new Error('비밀번호가 다르거나 파일이 손상됐어요. 기존 기록은 바뀌지 않았어요.'); }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    return validateBackupData(JSON.parse(decoded), { importing: true });
  } catch { throw invalid(); }
}
export function backupCounts(data) {
  return { meds: data.meds.length, entries: Object.keys(data.entries).length, visits: data.visits.length, labs: data.labs.length };
}
