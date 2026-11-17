import { todayKey, activeVersions, normalizeSchedule } from '../model.js';
import { isDateKey, scheduledReminders } from './alarms.js';

export function nativeAlarmBridge() {
  return globalThis.window?.ongyeolAlarms ?? null;
}

/** Keep current and future effective versions, including exclusive cutoffs.
 * Only scheduling IDs/times leave the journal; no names or clinical records.
 */
export function buildNativeAlarmPayload(data, today = todayKey()) {
  if (data.reminders !== true) return { enabled: false, slots: [], meds: [], checks: [] };
  const relevant = entries => {
    const current = new Set(activeVersions(entries, today));
    return (entries || []).filter(item => item.from > today || current.has(item));
  };
  const version = item => ({ id: item.id, from: item.from, ...(item.until ? { until: item.until } : {}) });
  const slots = relevant(data.slots).map(item => ({ ...version(item), time: item.time }));
  const meds = relevant(data.meds).map(item => ({ ...version(item), slotIds: [...item.slotIds], schedule: normalizeSchedule(item.schedule) }));
  const byDate = new Map();
  const checks = Object.keys(data.checks || {}).filter(key => {
    if (!data.checks[key]) return false;
    const [date, slot, med, extra] = key.split('|');
    if (extra !== undefined || !isDateKey(date) || date < today) return false;
    if (!byDate.has(date)) byDate.set(date, scheduledReminders(data, date));
    return byDate.get(date).some(item => item.slot.id === slot && item.meds.some(item => item.id === med));
  }).sort();
  return { enabled: data.reminders === true, slots, meds, checks };
}

/** One in-flight bridge operation. New snapshots replace queued work; demo never
 * sends an empty/disabled schedule. A failed snapshot remains retryable.
 */
export function createNativeAlarmSync({ bridge = nativeAlarmBridge, onStatus = () => {}, onError = () => {} } = {}) {
  let state;
  let revision = 0;
  let dirty = false;
  let running = null;
  let stopped = false;
  let last = '';
  async function drain() {
    while (dirty && !stopped) {
      dirty = false;
      const ticket = revision;
      if (!state || state.demo || state.storageError) continue;
      try {
        const native = bridge();
        if (!native) { last = ''; continue; }
        const status = await native.status();
        if (stopped || ticket !== revision) continue;
        onStatus(status);
        const payload = buildNativeAlarmPayload(state.data);
        const signature = JSON.stringify([payload, status]);
        if (signature === last) continue;
        await native.sync(payload);
        // A different snapshot queued during sync will run after this one.
        if (!stopped && ticket === revision) {
          const applied = await native.status();
          if (stopped || ticket !== revision) continue;
          last = JSON.stringify([payload, applied]);
          onStatus(applied);
        }
      } catch (error) {
        last = '';
        if (!stopped && ticket === revision) onError(error);
      }
    }
  }
  function refresh() {
    if (stopped) return Promise.resolve();
    dirty = true;
    if (!running) running = drain().finally(() => { running = null; if (dirty && !stopped) void refresh(); });
    return running;
  }
  return {
    update(next) { state = next; revision += 1; return refresh(); },
    refresh,
    stop() { stopped = true; revision += 1; dirty = false; },
  };
}
