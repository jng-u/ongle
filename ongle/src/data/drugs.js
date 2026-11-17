// Small UI-safe metadata, live API adapter and schedule helpers. No bulk catalog import.
import {isDateKey, activeVersions, normalizeSchedule, preserveDoseSnapshots} from '../model.js';
import provenance from './korean-drugs-source.json' with {type: 'json'};

export const MFDS_SOURCE = 'https://www.data.go.kr/data/15095677/openapi.do';
export const HIRA_SOURCE = provenance.sources.products.page;
export const RXNORM_SOURCE = 'https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getDrugs.html';
export const CATALOG_VERIFIED = provenance.retrieved;
export const CATALOG_DATE = provenance.sources.products.dataDate;
export const CATALOG_COUNT = provenance.catalogRows;

export async function searchRxNorm(query, {signal, fetcher = globalThis.fetch} = {}) {
  const name = query.trim();
  if (!name || !/^[a-z0-9\s.,()[\]/+%-]+$/i.test(name)) return [];
  const response = await fetcher(`https://rxnav.nlm.nih.gov/REST/drugs.json?${new URLSearchParams({name})}`, {signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
  if (!response.ok) throw new Error('RxNorm 검색에 연결하지 못했어요.');
  const result = await response.json();
  const seen = new Set();
  return (result.drugGroup?.conceptGroup ?? []).flatMap(group => group.conceptProperties ?? [])
    .filter(drug => drug.rxcui && drug.name && !seen.has(drug.rxcui) && seen.add(drug.rxcui))
    .slice(0, 30).map(drug => ({id: `rx-${drug.rxcui}`, name: drug.name, ingredient: '미국 의약품 명칭 · 국내 허가 정보 아님', sourceUrl: `https://rxnav.nlm.nih.gov/REST/rxcui/${encodeURIComponent(drug.rxcui)}/properties.json`}));
}

export const activeOn = (record, date) => record.from <= date && (!record.until || date < record.until);
// Change only the interval containing date; preserve history and later planned versions.
export function replaceVersion(records, id, date, value) {
  const current = activeVersions(records, date).find(record => record.id === id);
  const next = records.filter(record => record.id === id && record.from > date).sort((a,b) => a.from.localeCompare(b.from))[0];
  const until = current?.until || next?.from;
  const kept = records.flatMap(record => {
    if (record.id !== id || !activeOn(record, date)) return [record];
    return record.from < date ? [{...record, until: date}] : [];
  });
  if (value) kept.push({...value, id, from: date, ...(until ? {until} : {})});
  return kept;
}
// A date before the first registration corrects its start, rather than adding a gap version.
function applyMedicine(draft, id, date, medicine, {correctStart = false, until: correctedUntil} = {}) {
  if (!isDateKey(date)) throw new Error('올바른 날짜를 선택해 주세요.');
  const versions = draft.meds.filter(med => med.id === id).sort((a,b) => a.from.localeCompare(b.from));
  const first = versions[0];
  const correcting = correctStart || (first && date < first.from);
  const until = [first?.until, versions[1]?.from].filter(Boolean).sort()[0];
  if (correcting && (!first || (until && date >= until))) {
    throw new Error('최초 시작일은 첫 복용 기간 안이나 그 이전 날짜로 정정해 주세요. 이후 변경일과 중단일은 유지해요.');
  }
  const schedule = normalizeSchedule(medicine.schedule);
  const available = new Set(activeVersions(draft.slots, date).map(slot => slot.id));
  const slotIds = [...new Set(Array.isArray(medicine.slotIds) ? medicine.slotIds : [])].filter(slotId => available.has(slotId));
  if (schedule.type !== 'prn' && !slotIds.length) throw new Error('선택한 날짜에 사용할 복약 시간을 하나 이상 선택해 주세요.');
  const start = date;
  const later = versions.find(item => (!correcting || item !== first) && item.from > start);
  if (correctedUntil !== undefined && correctedUntil !== '' && (!isDateKey(correctedUntil) || correctedUntil <= start || (later && correctedUntil > later.from))) throw Error('종료일은 시작일 이후, 다음 변경일 이내로 선택해 주세요.');
  if (correctedUntil === '' && later) throw Error('이후 예약된 변경이 있어 종료일을 없앨 수 없어요.');
  // Schedule boundaries belong to the timeline, not to the copied form value.
  const {from: _from, until: _until, ...value} = medicine;
  if (correcting) {
    const corrected = {...first, ...value, id, from: date, slotIds, schedule};
    if (until) corrected.until = until;
    draft.meds = draft.meds.map(med => med === first ? corrected : med);
  } else {
    draft.meds = replaceVersion(draft.meds, id, date, {...value, slotIds, schedule});
  }
  if (correctedUntil !== undefined) {
    const saved = draft.meds.find(item => item.id === id && item.from === date);
    if (correctedUntil) saved.until = correctedUntil;
    else delete saved.until;
  }
}
function applySlots(draft, date, slots, mapping) {
  const old = activeVersions(draft.slots, date);
  const ids = new Set(slots.map(slot => slot.id));
  for (const slot of old) if (!ids.has(slot.id)) draft.slots = replaceVersion(draft.slots, slot.id, date, null);
  for (const slot of slots) {
    const previous = old.find(item => item.id === slot.id);
    if (!previous || previous.name !== slot.name || previous.time !== slot.time) {
      draft.slots = replaceVersion(draft.slots, slot.id, date, {name: slot.name, time: slot.time});
    }
  }
  for (const med of activeVersions(draft.meds, date)) {
    const slotIds = [...new Set(mapping[med.id] ?? med.slotIds)].filter(id => ids.has(id));
    if (JSON.stringify([...med.slotIds].sort()) !== JSON.stringify([...slotIds].sort())) {
      draft.meds = replaceVersion(draft.meds, med.id, date, {...med, slotIds});
    }
  }
}

// Validate the full resulting timeline before committing any mutation.
export function saveSlots(draft, date, slots, mapping = {}) {
  if (!isDateKey(date)) throw Error('올바른 날짜를 선택해 주세요.');
  if (new Set(slots.map(s => s.id)).size !== slots.length || slots.some(s => !s.name?.trim() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time))) throw Error('시간 이름과 시각을 확인해 주세요.');
  const next = structuredClone(draft);
  applySlots(next, date, slots, mapping);
  validateMedicationSlots(next, {from:date});
  preserveDoseSnapshots(draft);
  draft.slots = next.slots;
  draft.meds = next.meds;
}

/** Check only the selected prescriptions and their referenced slot boundaries. */
export function validateMedicationSlots(data, {from, medIds} = {}) {
  const selected = medIds && new Set(medIds);
  const meds = data.meds.filter(med => (!selected || selected.has(med.id)) && (!med.until || med.until > from));
  const slots = new Set(meds.flatMap(med => med.slotIds));
  const slotVersions = data.slots.filter(slot => slots.has(slot.id));
  const boundaries = new Set([from, ...[...meds,...slotVersions]
    .flatMap(item => [item.from,item.until]).filter(day => day && day >= from)]);
  for (const day of [...boundaries].sort()) {
    const available = new Map(activeVersions(slotVersions,day).map(slot => [slot.id,slot]));
    for (const med of activeVersions(meds,day)) {
      if (med.schedule?.type === 'prn') continue;
      const missing = med.slotIds.find(id => !available.has(id));
      if (!med.slotIds.length || missing) {
        const slotName = data.slots.find(slot => slot.id === missing)?.name;
        throw Error(`‘${med.name}’의 ${day} 예약 복약 시간${slotName ? ` ‘${slotName}’` : ''}이 없어요. 종료일이나 복약 시간을 먼저 정정해 주세요.`);
      }
    }
  }
  return true;
}
export function saveMedicine(draft, id, date, medicine, options) {
  const next = {...draft, meds:[...draft.meds]};
  applyMedicine(next,id,date,medicine,options);
  validateMedicationSlots(next,{from:date,medIds:[id]});
  preserveDoseSnapshots(draft);
  draft.meds = next.meds;
}
