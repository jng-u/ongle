// Persist hashes, never a second plaintext copy of the health journal.
export const BACKUP_MARKER_KEY = 'ongyeol.backup-review.v1';
const groups = ['slots', 'meds', 'checks', 'entries', 'visits', 'labs'];
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
export async function backupSnapshot(data) {
  const records = {};
  async function add(key, value) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(stable(value))));
    records[key] = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  for (const group of groups) {
    const occurrences = new Map();
    for (const [index, value] of Object.entries(data[group])) {
      const identity = Array.isArray(data[group]) ? `${value.id}|${value.from || ''}` : index;
      const n = occurrences.get(identity) || 0;
      occurrences.set(identity, n + 1);
      await add(`${group}:${identity}:${n}`, value);
    }
  }
  const settings = Object.fromEntries(Object.entries(data).filter(([key]) => !groups.includes(key) && !['version', 'reminders'].includes(key)));
  await add('settings', settings);
  return records;
}
export function backupDifference(current, previous) {
  let added = 0, changed = 0, removed = 0;
  for (const [key, hash] of Object.entries(current)) {
    if (!Object.hasOwn(previous, key)) added++;
    else if (hash !== previous[key]) changed++;
  }
  for (const key of Object.keys(previous)) if (!Object.hasOwn(current, key)) removed++;
  return { added, changed, removed, total: added + changed + removed };
}
export function readBackupMarker(storage) {
  try {
    const marker = JSON.parse(storage?.getItem(BACKUP_MARKER_KEY) || 'null');
    if (!marker || !['saved', 'requested'].includes(marker.status) || typeof marker.at !== 'string' || !Number.isFinite(Date.parse(marker.at)) ||
      !marker.records || typeof marker.records !== 'object' || Array.isArray(marker.records) ||
      !Object.values(marker.records).every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) return null;
    return marker;
  } catch { return null; }
}
