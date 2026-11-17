// Stable built-in IDs stay separate from user-created IDs and legacy entry keys.
export const diaryTypes = ['scale', 'number', 'boolean'];
export const builtinDiaryFields = [
  { id: 'pain', label: '통증', type: 'scale' },
  { id: 'stools', label: '배변 횟수', type: 'number' },
  { id: 'blood', label: '혈변', type: 'boolean' },
];
export function getDiaryFields(data) {
  return [
    ...builtinDiaryFields.filter(field => data.diaryBuiltinNames?.[field.id] !== null).map(field => ({
      ...field, builtin: true, label: data.diaryBuiltinNames?.[field.id] ?? field.label,
      enabled: typeof data.diaryBuiltins?.[field.id] === 'boolean'
        ? data.diaryBuiltins[field.id]
        : Object.values(data.entries || {}).some(entry => hasDiaryValue(entry?.[field.id])),
    })),
    ...(data.diaryFields || []).map(field => ({ ...field, builtin: false })),
  ];
}
export function hasDiaryValue(value) {
  return typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}
export function getCustomAnswers(entry) {
  return (entry?.custom || []).filter(answer => hasDiaryValue(answer.value));
}
export function entryAnswers(entry) {
  if (!entry) return [];
  return [
    ...builtinDiaryFields.filter(field => hasDiaryValue(entry[field.id])).map(field => ({ ...field, label: entry.builtinNames?.[field.id] ?? field.label, value: entry[field.id] })),
    ...getCustomAnswers(entry),
  ];
}
export function entryExists(entry) {
  return !!entry && (entry.condition != null || !!entry.note?.trim() || entryAnswers(entry).length > 0);
}
export function formatDiaryAnswer(answer) {
  const value = answer.type === 'boolean' ? (answer.value ? 'O' : 'X') : `${answer.value}${answer.type === 'scale' ? '/10' : ''}`;
  return `${answer.label} · ${value}`;
}
export function parseDiaryValue(type, raw) {
  if (raw === '' || raw == null) return null;
  if (type === 'boolean') {
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    throw Error('O 또는 X를 선택해주세요.');
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || (type === 'scale' && (value < 0 || value > 10 || !Number.isInteger(value)))) throw Error('척도는 0~10 사이의 정수, 숫자 항목은 유효한 수를 입력해주세요.');
  return value;
}
// Disabled/missing templates retain their original labelled answers during edits.
export function buildCustomAnswers(fields, values, prior = []) {
  const answers = new Map(prior.map(answer => [answer.id, { ...answer }]));
  fields.filter(field => !field.builtin && field.enabled).forEach(field => {
    const priorAnswer = answers.get(field.id);
    const old = hasDiaryValue(priorAnswer?.value) ? priorAnswer : null;
    answers.set(field.id, { id: field.id, label: old?.label ?? field.label, type: old?.type ?? field.type, value: parseDiaryValue(old?.type ?? field.type, values[field.id]) });
  });
  return [...answers.values()];
}

// Old entries lack labels for built-ins; their original Korean labels remain the fallback.
export function writeBuiltinAnswers(entry, fields, values) {
  const saved = new Map(entryAnswers(entry).map(answer => [answer.id, answer.label]));
  const names = { ...entry.builtinNames };
  for (const field of fields.filter(field => field.builtin && field.enabled)) {
    const value = parseDiaryValue(field.type, values[field.id]);
    const label = saved.get(field.id) ?? field.label;
    if (field.id === 'stools' && value !== null && (!Number.isInteger(value) || value < 0 || value > 1000)) {
      throw Error(label + ': 0~1,000 사이의 정수를 입력해주세요.');
    }
    entry[field.id] = value;
    if (value !== null) names[field.id] = label;
    else delete names[field.id];
  }
  if (Object.keys(names).length) entry.builtinNames = names;
  else delete entry.builtinNames;
}
