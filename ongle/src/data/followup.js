import { addDays, isDateKey } from '../model.js';

/** Add to the original date, clamping to the target month's final day. */
export function followupDate(date, amount, unit) {
  if (!isDateKey(date) || !Number.isSafeInteger(amount) || amount < 1 || amount > 1200) return '';
  if (unit === 'weeks') {
    const result = addDays(date, amount * 7);
    return isDateKey(result) ? result : '';
  }
  if (unit !== 'months') return '';
  const target = new Date(`${date}T12:00:00`);
  const day = target.getDate();
  target.setDate(1);
  target.setMonth(target.getMonth() + amount);
  const monthEnd = new Date(target);
  monthEnd.setMonth(monthEnd.getMonth() + 1, 0);
  const lastDay = monthEnd.getDate();
  target.setDate(Math.min(day, lastDay));
  const result = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
  return isDateKey(result) ? result : '';
}

// Deliberately allowlist scheduling fields: never copy IDs, results or completion.
export function followupDraft(visit) {
  return { type: visit.type === 'exam' ? 'exam' : 'visit', title: visit.title || '',
    place: visit.place || '', time: visit.time || '', date: '', note: '', completed: false };
}

const normalized = value => (value || '').trim().replace(/\s+/g, ' ');

export function duplicatePlannedVisit(visits, record) {
  if (record.completed === true) return undefined;
  return visits.find(visit => visit.id !== record.id && visit.completed !== true &&
    ['type', 'title', 'place', 'date', 'time'].every(key => normalized(visit[key]) === normalized(record[key])));
}

export function recentHospitals(visits, limit = 6) {
  const seen = new Set();
  return [...visits].sort((a, b) => `${b.date} ${b.time || ''}`.localeCompare(`${a.date} ${a.time || ''}`))
    .flatMap(visit => {
      const place = normalized(visit.place);
      if (!place || seen.has(place)) return [];
      seen.add(place);
      return [place];
    }).slice(0, limit);
}

/** Recheck at the storage boundary, including updates arriving after form open. */
export function storeVisit(visits, record) {
  if (duplicatePlannedVisit(visits, record)) return false;
  const index = visits.findIndex(visit => visit.id === record.id);
  if (index >= 0) visits[index] = record;
  else visits.push(record);
  return true;
}
