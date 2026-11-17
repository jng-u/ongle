import {blankJournal, uid} from '../model.js';
import {validateBackupData} from './backup.js';

export const JOURNAL_KEY = 'ongyeol.journal.v1';
export const RECOVERY_KEY = `${JOURNAL_KEY}.recovery`;
const sources = new WeakMap();
const restoreBases = new WeakMap();
export class JournalReadError extends Error {
  constructor() { super('기기에 저장된 기록을 읽지 못했어요. 기존 원본은 변경하지 않았어요.'); }
}
export class JournalWriteError extends Error {
  constructor() { super('기기에 기록을 쓰지 못했어요. 남은 저장 공간과 브라우저 설정을 확인해 주세요.'); }
}
export class JournalConflict extends Error {
  constructor() { super('다른 창에서 같은 기록을 변경했어요. 입력 내용을 따로 보관한 뒤 창을 닫고 최신 기록을 확인해 주세요.'); }
}
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (item, versioned) => plain(item) && typeof item.id === 'string'
  ? JSON.stringify(versioned ? [item.id,item.from] : item.id) : null;

/** Merge only locally changed fields; changed/deleted remote fields must agree. */
export function mergeJournal(base, edited, current, path = []) {
  if (same(base,edited)) return structuredClone(current);
  if (same(base,current) || same(edited,current)) return structuredClone(edited);
  if ([base,edited,current].every(plain)) {
    const result = {};
    for (const key of new Set([...Object.keys(base),...Object.keys(edited),...Object.keys(current)])) {
      const value = mergeJournal(base[key],edited[key],current[key],[...path,key]);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  // Records and answer arrays merge by identity, never by their shifting index.
  if ([base,edited,current].every(Array.isArray)) {
    const versioned = path.length === 1 && ['slots','meds'].includes(path[0]);
    const maps = [base,edited,current].map(items => new Map(items.map(item => [identity(item,versioned),item])));
    if (maps.every((map,i) => !map.has(null) && map.size === [base,edited,current][i].length)) {
      const result = [];
      for (const key of new Set([...maps[2].keys(),...maps[1].keys(),...maps[0].keys()])) {
        const value = mergeJournal(maps[0].get(key),maps[1].get(key),maps[2].get(key),[...path,key]);
        if (value !== undefined) result.push(value);
      }
      return result;
    }
  }
  throw new JournalConflict();
}

/** Storage and backup share exactly one validation boundary, including extensions. */
export function createJournalStore(storage) {
  const getSource = () => {
    try { return storage.getItem(JOURNAL_KEY); } catch { throw new JournalReadError(); }
  };
  const read = () => {
    try {
      const raw = getSource();
      const data = raw === null ? blankJournal() : validateBackupData(JSON.parse(raw));
      sources.set(data,raw !== null);
      return data;
    } catch { throw new JournalReadError(); }
  };
  const write = data => {
    const clean = validateBackupData(data);
    try { storage.setItem(JOURNAL_KEY,JSON.stringify(clean)); } catch { throw new JournalWriteError(); }
    sources.set(clean,true);
    return clean;
  };
  return {
    read,
    captureRestoreBase() {
      try {
        const token = Object.freeze({});
        restoreBases.set(token,{storage,raw:getSource()});
        return token;
      } catch { throw new JournalReadError(); }
    },
    readRecoveryCopy: () => storage.getItem(RECOVERY_KEY),
    deleteRecoveryCopy(expectedRaw) {
      if (typeof expectedRaw !== 'string' || storage.getItem(RECOVERY_KEY) !== expectedRaw) throw new JournalConflict();
      storage.removeItem(RECOVERY_KEY);
    },
    recoveryInfo() {
      const raw = storage.getItem(RECOVERY_KEY);
      return raw === null ? null : {key:RECOVERY_KEY,bytes:new TextEncoder().encode(raw).length};
    },
    update(fn, base, check) {
      const raw = getSource();
      const current = read(); // Corrupt originals are never editable through normal update.
      if (base && (base.restoreGeneration !== current.restoreGeneration ||
        (sources.get(base) === true && raw === null))) throw new JournalConflict();
      const draft = structuredClone(base ?? current);
      if (fn(draft) === false) throw new JournalConflict();
      const merged = base ? mergeJournal(base,draft,current) : draft;
      if (check && check(merged) === false) throw new JournalConflict();
      if (getSource() !== raw) throw new JournalConflict();
      return write(merged);
    },
    replace(candidate, base) {
      const clean = validateBackupData(candidate,{importing:true});
      const raw = getSource();
      if (base !== undefined) {
        const captured = restoreBases.get(base);
        if (!captured || captured.storage !== storage || captured.raw !== raw) throw new JournalConflict();
      }
      if (raw !== null) {
        let damaged = false;
        try { validateBackupData(JSON.parse(raw)); } catch { damaged = true; }
        if (damaged) {
          const previous = storage.getItem(RECOVERY_KEY);
          if (previous !== null && previous !== raw) throw new Error('이전에 보관한 손상 원본을 보호하기 위해 복원을 중단했어요. 복구 사본을 먼저 파일로 저장해 주세요.');
          if (previous === null) {
            try { storage.setItem(RECOVERY_KEY,raw); } catch { throw new JournalWriteError(); }
          }
          if (storage.getItem(RECOVERY_KEY) !== raw) throw new Error('기존 기록 원본을 보관하지 못해 복원을 중단했어요.');
        }
      }
      // Invalidate every form opened before replacement, even if restored values match.
      clean.restoreGeneration = uid();
      if (getSource() !== raw) throw new JournalConflict();
      return write(clean);
    },
  };
}
