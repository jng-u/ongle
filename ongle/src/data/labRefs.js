// Explicit source sync: official Mayo Clinic Laboratories catalog, reviewed 2026-11-16.
// This is a verified offline snapshot, not a live search service. Reverify linked
// Reference Values sections before changing boundaries; never infer from snippets.
export const REFERENCE_SYNC_DATE = '2026-11-16';
const publisher = 'Mayo Clinic Laboratories';
export const labReferences = [
  {
    id: 'mayo-crp', name: 'CRP', aliases: ['CRP', 'C-reactive protein', 'C-reactive protein (CRP)', 'C반응성단백', 'C-반응성 단백', '일반 CRP'],
    unit: 'mg/L', low: null, high: 5, highInclusive: false,
    publisher, url: 'https://www.mayocliniclabs.com/test-catalog/Overview/9731',
    population: '전 연령 · 혈청 · 일반 CRP (고감도 hs-CRP 제외)',
    caveat: '심혈관 위험 평가용 hs-CRP와 구분해 주세요. 염증의 원인을 이 수치만으로 판단할 수 없어요.',
    syncedAt: REFERENCE_SYNC_DATE,
  },
  {
    id: 'mayo-calprotectin', name: '대변 칼프로텍틴', aliases: ['대변 칼프로텍틴', '칼프로텍틴', '분변 칼프로텍틴', 'fecal calprotectin', 'calprotectin', 'calprotectin feces', 'FCP'],
    unit: 'mcg/g', low: null, high: 50, highInclusive: false,
    publisher, url: 'https://www.mayocliniclabs.com/test-catalog/Overview/63016',
    population: '전 연령 · 대변 · ELISA 검사법',
    bands: '출처 구분: < 50 mcg/g 일반 범위 · 50 ≤ 값 ≤ 120 경계 · > 120 상승',
    caveat: '약물(NSAIDs·아스피린·PPI), 감염 등도 결과에 영향을 줄 수 있어요. 낮은 수치만으로 IBD를 배제하거나 높은 수치만으로 진단할 수 없어요.',
    syncedAt: REFERENCE_SYNC_DATE,
  },
  {
    id: 'mayo-albumin', name: '알부민', aliases: ['알부민', 'albumin', 'ALB', '혈청 알부민'],
    unit: 'g/dL', low: 3.5, high: 5, lowInclusive: true, highInclusive: true,
    publisher, url: 'https://www.mayocliniclabs.com/test-catalog/Overview/8436',
    population: '생후 12개월 이상 · 혈청',
    caveat: '생후 12개월 미만에는 이 범위를 적용하지 않아요. 검사법과 검사기관에 따라 범위가 달라요.',
    syncedAt: REFERENCE_SYNC_DATE,
  },
  {
    id: 'mayo-b12', name: '비타민 B12', aliases: ['비타민 B12', '비타민B12', 'vitamin B12', 'B12'],
    unit: 'ng/L', low: 180, high: 914, lowInclusive: true, highInclusive: true,
    publisher, url: 'https://www.mayocliniclabs.com/test-catalog/Overview/9154',
    population: '혈청 · 원문에 연령·성별별 참고구간 구분 없음',
    caveat: '검사법·최근 B12 투여 등 임상 맥락을 함께 확인해 주세요. 검사기관의 결과지 범위를 우선해요.',
    syncedAt: REFERENCE_SYNC_DATE,
  },
];

const normalize = value => String(value || '').trim().toLowerCase().replace(/[\s_()-]/g, '');
// Only synonymous spellings; no magnitude conversions or case-folding of units.
export const normalizeUnit = value => String(value || '').trim().replace(/[μµ]g\/g/g, 'mcg/g');
export function metricKey(record) {
  const known = labReferences.find(ref => ref.aliases.some(alias => normalize(alias) === normalize(record.name)));
  return JSON.stringify([known?.id || normalize(record.name), normalizeUnit(record.unit)]);
}
export function referenceCandidates(name, unit) {
  return labReferences.filter(ref => ref.aliases.some(alias => normalize(alias) === normalize(name)) && normalizeUnit(ref.unit) === normalizeUnit(unit));
}
export function searchReferences(query) {
  const term = normalize(query);
  return labReferences.filter(ref => !term || [ref.name, ...ref.aliases].some(alias => normalize(alias).includes(term)));
}
export function rangeText(record) {
  const { low, high } = record;
  if (low == null && high == null) return '참고범위 미입력';
  if (low != null && high != null) return `${low} ${record.lowInclusive === false ? '<' : '≤'} 값 ${record.highInclusive === false ? '<' : '≤'} ${high}`;
  return low != null ? `${record.lowInclusive === false ? '>' : '≥'} ${low}` : `${record.highInclusive === false ? '<' : '≤'} ${high}`;
}
export function rangeStatus(record) {
  if (!Number.isFinite(record.value)) return '수치 확인 필요';
  if (record.low != null && (record.value < record.low || (record.value === record.low && record.lowInclusive === false))) return '참고범위보다 낮음';
  if (record.high != null && (record.value > record.high || (record.value === record.high && record.highInclusive === false))) return '참고범위보다 높음';
  return record.low == null && record.high == null ? '참고범위 없음' : '참고범위 안';
}
export function groupLabs(records) {
  const groups = new Map();
  for (const record of records) {
    const key = metricKey(record);
    if (!groups.has(key)) groups.set(key, { key, name: record.name, unit: record.unit, records: [] });
    groups.get(key).records.push(record);
  }
  return [...groups.values()].map(group => ({ ...group, records: group.records.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) }));
}
export function validateLab(record) {
  if (!record.name.trim()) return '검사 이름을 입력해 주세요.';
  if (!record.unit.trim()) return '결과지에 적힌 단위를 입력해 주세요.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !Number.isFinite(Date.parse(record.date)) || new Date(`${record.date}T12:00:00Z`).toISOString().slice(0, 10) !== record.date) return '검사 날짜를 확인해 주세요.';
  if (record.value == null || String(record.value).trim() === '' || !Number.isFinite(Number(record.value))) return '검사 수치를 숫자로 입력해 주세요.';
  for (const field of ['low', 'high']) {
    if (record[field] !== '' && record[field] != null && !Number.isFinite(Number(record[field]))) return '참고범위를 숫자로 입력해 주세요.';
  }
  if (record.low !== '' && record.low != null && record.high !== '' && record.high != null) {
    if (Number(record.low) > Number(record.high) || (Number(record.low) === Number(record.high) && (record.lowInclusive === false || record.highInclusive === false))) return '하한과 상한의 순서·포함 조건을 확인해 주세요.';
  }
  return '';
}
export function labFromForm(form, id) {
  const error = validateLab(form);
  if (error) throw new Error(error);
  return { ...form, id, name: form.name.trim(), unit: form.unit.trim(), value: Number(form.value), low: form.low === '' || form.low == null ? null : Number(form.low), high: form.high === '' || form.high == null ? null : Number(form.high) };
}
export function putLab(draft, record) {
  const index = draft.labs.findIndex(item => item.id === record.id);
  if (index < 0) draft.labs.push(record);
  else draft.labs[index] = { ...draft.labs[index], ...record };
}
export function removeLab(draft, id) { draft.labs = draft.labs.filter(record => record.id !== id); }
