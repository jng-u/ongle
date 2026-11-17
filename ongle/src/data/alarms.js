import { addDays, checkKey, todayKey, activeVersions, medicineScheduledOn } from '../model.js';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const encoder = new TextEncoder();
export const SENT_KEY = 'ongle.reminders.sent.v1';
export const EXPORT_KEY = 'ongle.reminders.export.v1';

export function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export { activeVersions } from '../model.js';

export function scheduledReminders(data, date) {
  if (!isDateKey(date)) return [];
  const meds = activeVersions(data.meds, date);
  return activeVersions(data.slots, date).filter(slot => TIME.test(slot.time)).flatMap(slot => {
    const registered = meds.filter(med => medicineScheduledOn(med, date) && med.slotIds?.includes(slot.id));
    if (!registered.length) return [];
    const pending = registered.filter(med => !data.checks?.[checkKey(date, slot.id, med.id)]);
    return [{ slot, meds: registered, pending, date,
      key: JSON.stringify([date, slot.id, slot.time]) }];
  });
}

/** A short foreground grace window, never a previous-day catch-up. */
export function dueReminders(data, now = new Date(), graceMs = 120000) {
  if (!Number.isFinite(now.getTime())) return [];
  const date = localDateKey(now);
  return scheduledReminders(data, date).filter(({ slot, pending }) => {
    const at = new Date(`${date}T${slot.time}:00`);
    const elapsed = now.getTime() - at.getTime();
    return pending.length && elapsed >= 0 && elapsed < graceMs;
  });
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Called under a Web Lock by the engine. Storage contains IDs, never names. */
export function createReminderDelivery(storage) {
  let memory = { date: '', keys: [] };
  let busy = false;
  function read(date) {
    try {
      const saved = JSON.parse(storage?.getItem(SENT_KEY) || 'null');
      if (saved?.date === date && Array.isArray(saved.keys)) return saved;
    } catch { /* Private mode / corrupt storage: retain in-memory dedup. */ }
    return memory.date === date ? memory : { date, keys: [] };
  }
  function write(value) {
    memory = value;
    try { storage?.setItem(SENT_KEY, JSON.stringify(value)); } catch { /* In-memory fallback. */ }
  }
  return async function deliver(reminders, show, allowed = () => true) {
    if (busy) return 0;
    busy = true;
    let count = 0;
    try {
      for (const reminder of reminders) {
        if (!allowed() || !reminder.pending.length) continue;
        const saved = read(reminder.date);
        if (saved.keys.includes(reminder.key)) continue;
        // Reserve before awaiting notification dispatch; revert on failure.
        write({ date: reminder.date, keys: [...saved.keys, reminder.key] });
        try {
          await show(reminder);
          count += 1;
        } catch {
          const current = read(reminder.date);
          write({ ...current, keys: current.keys.filter(key => key !== reminder.key) });
        }
      }
      return count;
    } finally { busy = false; }
  };
}

export function escapeICalText(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** RFC 5545: 75 octets, including continuation whitespace, UTF-8 safe. */
export function foldICalLine(line) {
  let result = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > 75) { result += '\r\n '; size = 1; }
    result += char;
    size += bytes;
  }
  return result;
}

function hash(value) {
  let a = 2166136261;
  let b = 5381;
  for (const char of value) {
    a = Math.imul(a ^ char.codePointAt(0), 16777619);
    b = Math.imul(b, 33) ^ char.codePointAt(0);
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}

export function reminderFingerprint(data) {
  return hash(JSON.stringify([data.slots || [], data.meds || [], data.visits || []]));
}

const floating = (date, time) => `${date.replaceAll('-', '')}T${time.replace(':', '')}00`;

/** Local-only, finite snapshot. endDate is inclusive; version.until is exclusive.
 * Floating DTSTART and UNTIL retain local wall-clock times in the calendar.
 * Importers differ in VALARM support: users must verify an imported test event.
 */
export function buildReminderCalendar(data, options = {}) {
  const startDate = options.startDate ?? todayKey();
  const endDate = options.endDate ?? addDays(startDate, 90);
  if (!isDateKey(startDate) || !isDateKey(endDate) || endDate < startDate || endDate > addDays(startDate, 3660)) {
    throw new Error('내보낼 날짜를 확인해 주세요. 최대 10년까지 선택할 수 있어요.');
  }
  const stamp = (options.now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const segments = [];
  const lastBySlot = new Map();
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    for (const reminder of scheduledReminders(data, date)) {
      const { slot, meds, pending } = reminder;
      const title = options.includeDetails
        ? `${slot.name || '복약'} · ${meds.map(med => [med.name, med.dose].filter(Boolean).join(' ')).join(', ')}`
        : '나를 돌볼 시간';
      const signature = JSON.stringify([slot.id, slot.time, title]);
      let segment = lastBySlot.get(slot.id);
      if (!segment || segment.signature !== signature || addDays(segment.end, 1) !== date) {
        segment = { signature, start: date, end: date, time: slot.time, title, excluded: [] };
        segments.push(segment);
        lastBySlot.set(slot.id, segment);
      } else segment.end = date;
      if (!pending.length) segment.excluded.push(date);
    }
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ongle//Local Reminders//KO',
    'CALSCALE:GREGORIAN', 'X-WR-CALNAME:온결 알림'];
  let eventCount = 0;
  function event({ identity, start, time, title, end, excluded = [], minutes = 0 }) {
    lines.push('BEGIN:VEVENT', `UID:${hash(identity)}@ongle.local`, `DTSTAMP:${stamp}`,
      `DTSTART:${floating(start, time)}`, 'DURATION:PT1M', `SUMMARY:${escapeICalText(title)}`,
      'CLASS:PRIVATE', 'TRANSP:TRANSPARENT');
    if (end) lines.push(`RRULE:FREQ=DAILY;UNTIL=${floating(end, time)}`);
    if (excluded.length) lines.push(`EXDATE:${excluded.map(date => floating(date, time)).join(',')}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${minutes ? `-PT${minutes}M` : 'PT0S'}`,
      `DESCRIPTION:${escapeICalText(title)}`, 'END:VALARM', 'END:VEVENT');
    eventCount += 1;
  }
  for (const segment of segments) {
    // Do not export a series whose every occurrence was already checked.
    if (segment.excluded.length === Math.round((Date.parse(segment.end) - Date.parse(segment.start)) / 86400000) + 1) continue;
    event({ ...segment, identity: JSON.stringify([segment.signature, segment.start]), start: segment.start });
  }
  if (options.includeVisits) {
    const seen = new Set();
    const minutes = [0, 15, 30, 60].includes(options.visitMinutes) ? options.visitMinutes : 30;
    for (const visit of data.visits || []) {
      if (visit.completed === true) continue;
      if (!isDateKey(visit.date) || visit.date < startDate || visit.date > endDate || !TIME.test(visit.time)) continue;
      const identity = JSON.stringify(['visit', visit.id, visit.date, visit.time]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      event({ identity, start: visit.date, time: visit.time, minutes,
        title: options.includeDetails ? visit.title || '예정된 일정' : '예정된 일정' });
    }
  }
  lines.push('END:VCALENDAR');
  return { text: `${lines.map(foldICalLine).join('\r\n')}\r\n`, eventCount, startDate, endDate };
}
