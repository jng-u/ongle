const pad = n => String(n).padStart(2, '0');
export function todayKey(at = new Date()) {
  return [at.getFullYear(), pad(at.getMonth() + 1), pad(at.getDate())].join('-');
}
export const parseDate = key => new Date(key + 'T12:00:00');
export function isDateKey(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && todayKey(parseDate(key)) === key;
}
export function addDays(key, offset) {
  const d = parseDate(key);
  d.setDate(d.getDate() + offset);
  return todayKey(d);
}
export function formatDate(key, options = { month: 'long', day: 'numeric', weekday: 'long' }) {
  return parseDate(key).toLocaleDateString('ko-KR', options);
}
export function uid() {
  return globalThis.crypto?.randomUUID?.() || ('r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
}
export const applies = (item, date) => item.from <= date && (!item.until || item.until > date);
// Latest logical version wins, including a stopped version.
export function activeVersions(versions = [], date) {
  const latest = new Map();
  for (const item of versions) {
    if (!isDateKey(item.from) || item.from > date) continue;
    if (!latest.has(item.id) || latest.get(item.id).from <= item.from) latest.set(item.id, item);
  }
  return [...latest.values()].filter(item => applies(item, date));
}
export const slotsOn = (data, date) => activeVersions(data.slots, date).sort((a,b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name, 'ko'));
export function normalizeSchedule(schedule) {
  if (schedule === undefined) return {type:'daily'};
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) throw Error('복약 주기를 확인해 주세요.');
  switch (schedule.type) {
    case 'daily': case 'prn': return {type:schedule.type};
    case 'weekdays':
      if (!Array.isArray(schedule.days) || !schedule.days.length || !schedule.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6)) break;
      return {type:'weekdays', days:[...new Set(schedule.days)].sort()};
    case 'interval':
      if (schedule.every !== 2 || !isDateKey(schedule.anchor)) break;
      return {type:'interval', every:2, anchor:schedule.anchor};
  }
  throw Error('복약 요일 또는 격일 기준일을 확인해 주세요.');
}
export function medicineScheduledOn(med, date) {
  const schedule = med.schedule;
  if (!schedule || schedule.type === 'daily') return true;
  if (schedule.type === 'prn') return false;
  if (schedule.type === 'weekdays') return schedule.days.includes(parseDate(date).getDay());
  if (schedule.type === 'interval') return (Date.parse(date) - Date.parse(schedule.anchor)) / 86400000 % schedule.every === 0;
  return false;
}
export const medsOn = (data, date, slotId) => activeVersions(data.meds, date).filter(m => medicineScheduledOn(m, date) && (slotId === undefined || m.slotIds.includes(slotId)));
export const checkKey = (date, slotId, medId) => [date, slotId, medId].join('|');

function doseSnapshot(med, slot, takenAt = '') {
  return {name:med?.name || '삭제된 약', dose:med?.dose || '', note:med?.note || '', slotName:slot?.name || '필요시', time:slot?.time || '', takenAt};
}
// Build version maps only for legacy checks, once per date in each operation.
function legacyDoseLookup(data) {
  const dates = new Map();
  function versions(records, date) {
    const byId = new Map();
    for (const item of records || []) if (!byId.has(item.id)) byId.set(item.id,item);
    for (const item of activeVersions(records,date)) byId.set(item.id,item);
    return byId;
  }
  return (date,slotId,medId) => {
    if (!dates.has(date)) dates.set(date,{meds:versions(data.meds,date),slots:versions(data.slots,date)});
    const {meds,slots} = dates.get(date);
    return {med:meds.get(medId),slot:slots.get(slotId)};
  };
}
function doseKeyParts(key) {
  const [date,slotId,medId,extra] = key.split('|');
  return isDateKey(date) && slotId && medId && extra === undefined ? {date,slotId,medId} : null;
}
/** Actual records remain visible even when the corrected plan has no matching dose.
 * Callers may pass a date-partitioned checks object for long-range summaries.
 * Snapshot values never access meds/slots; boolean values resolve legacy details.
 */
export function actualDosesOn(data, date) {
  const lookup = legacyDoseLookup(data);
  const result = [];
  for (const [key,value] of Object.entries(data.checks || {})) {
    if (!value || !key.startsWith(date + '|')) continue;
    const parts = doseKeyParts(key);
    if (!parts) continue;
    const legacy = value === true;
    let snapshot = value;
    if (legacy) {
      const {med,slot} = lookup(date,parts.slotId,parts.medId);
      snapshot = doseSnapshot(med,slot);
    }
    result.push({key,...parts,...snapshot,legacy});
  }
  return result.sort((a,b) => a.time.localeCompare(b.time) || a.key.localeCompare(b.key));
}
/** One check traversal; existing snapshots and orphan booleans stay untouched. */
export function preserveDoseSnapshots(data) {
  const lookup = legacyDoseLookup(data);
  for (const [key,value] of Object.entries(data.checks || {})) {
    if (value !== true) continue;
    const parts = doseKeyParts(key);
    if (!parts) continue;
    const {med,slot} = lookup(parts.date,parts.slotId,parts.medId);
    if (med) data.checks[key] = doseSnapshot(med,slot);
  }
}
export function scheduleLabel(schedule) {
  if (schedule?.type === 'prn') return '필요시';
  if (schedule?.type === 'weekdays') return schedule.days.map(d => ['일','월','화','수','목','금','토'][d]).join('·') + '요일';
  if (schedule?.type === 'interval') return '격일 · ' + schedule.anchor + ' 기준';
  return '매일';
}
export function recordDose(data, date, slotId, medId, at = new Date()) {
  if (!isDateKey(date) || date > todayKey(at)) throw Error('실제 복용은 오늘까지 기록할 수 있어요.');
  const med = activeVersions(data.meds, date).find(m => m.id === medId);
  const slot = slotsOn(data, date).find(s => s.id === slotId);
  if (!med || (med.schedule?.type !== 'prn' && (!slot || !med.slotIds.includes(slotId) || !medicineScheduledOn(med,date)))) throw Error('예정된 복약을 확인해 주세요.');
  const key = checkKey(date, med.schedule?.type === 'prn' ? 'prn-' + uid() : slotId, medId);
  data.checks[key] = doseSnapshot(med, med.schedule?.type === 'prn' ? null : slot, at.toISOString());
  return key;
}
export function dayStats(data, date) {
  let total = 0, done = 0;
  for (const s of slotsOn(data, date)) for (const m of medsOn(data, date, s.id)) {
    ++total;
    if (data.checks[checkKey(date, s.id, m.id)]) ++done;
  }
  return { total, done, actualCount: actualDosesOn(data,date).length };
}
export function blankJournal() {
  return { version: 1, slots: [['morning', '아침', '08:00'], ['noon', '점심', '12:30'], ['evening', '저녁', '19:00']].map(([id,name,time]) => ({id,name,time,from:'1900-01-01'})), meds: [], checks: {}, entries: {}, visits: [], labs: [], reminders: false };
}
export function demoJournal(date = todayKey()) {
  const data = blankJournal(), start = addDays(date, -40);
  data.meds = [
    { id:'sample-a',name:'예시 약 A',dose:'1정',note:'처방전에 적힌 메모 예시',slotIds:['morning','evening'],from:start },
    { id:'sample-b',name:'예시 약 B',dose:'1캡슐',note:'',slotIds:['noon'],from:start }
  ];
  for (let i = 0; i < 12; i++) {
    const day = addDays(date, -i);
    for (const s of data.slots) {
      if ((!i && s.id !== 'morning') || (i === 6 && s.id === 'noon')) continue;
      for (const m of medsOn(data, day, s.id)) data.checks[checkKey(day, s.id, m.id)] = true;
    }
  }
  const notes = ['산책 후 오후에는 편안하게 쉬었다.', '점심 뒤에 배가 조금 불편했다. 다음 진료 때 이야기할 내용에 적어 두었다.', '어제보다 피곤함이 덜했다.'];
  [1,3,5].forEach((n,i)=>{data.entries[addDays(date,-n)]={condition:[4,3,4][i],pain:[1,3,1][i],stools:[2,3,2][i],blood:null,note:notes[i]};});
  data.diaryBuiltins={pain:true,stools:true,blood:false};
  data.diaryFields=[{id:'sample-fatigue', label:'피로감', type:'scale', enabled:true}];
  [1,3,5].forEach((n,i)=>{data.entries[addDays(date,-n)].custom=[{id:'sample-fatigue',label:'피로감',type:'scale',value:[2,5,3][i]}];});
  data.visits = [
    {id:'sample-visit',date:addDays(date,5),time:'10:00',title:'소화기내과 외래',place:'예시 병원',type:'visit',note:'최근 증상 일기와 검사 결과를 같이 보기.'},
    {id:'sample-exam',date:addDays(date,-24),time:'09:00',title:'대장내시경',place:'예시 검진센터',type:'exam',completed:true,note:'검사 결과지를 받아 보관했다.'}
  ];
  data.labs = [8.2,5.6,3.1].map((value,i)=>({id:'sample-lab-'+i,date:addDays(date,-33+i*12),name:'CRP',value,unit:'mg/L',low:null,high:null,source:''}));
  return data;
}
export function isJournal(value) {
  return value && value.version === 1 && ['slots','meds','labs','visits'].every(k=>Array.isArray(value[k])) &&
    ['checks','entries'].every(k=>value[k] && typeof value[k]==='object' && !Array.isArray(value[k])) && typeof value.reminders === 'boolean';
}
