import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { useApp } from '../core.jsx';
import { uid } from '../model.js';
import { getDiaryFields } from '../data/diaryFields.js';
import './custom-diary.css';

const typeNames = { scale: '0~10 척도', number: '숫자', boolean: 'O/X' };
export function DiaryFieldManager() {
  const { data, update, notify } = useApp();
  const [label, setLabel] = useState('');
  const [type, setType] = useState('scale');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const fields = getDiaryFields(data);
  const rename = field => {
    const next = name.trim();
    if (!next) { setError('항목 이름을 입력해주세요.'); return; }
    const saved = update(draft => {
      if (field.builtin) { draft.diaryBuiltinNames ||= {}; draft.diaryBuiltinNames[field.id] = next; }
      else { const item = draft.diaryFields?.find(item => item.id === field.id); if (item) item.label = next; }
    });
    if (saved === false) { setError('이름을 저장하지 못했어요. 다시 시도해주세요.'); return; }
    setEditing(null); setError(''); notify('항목 이름을 변경했어요.');
  };
  const remove = field => {
    const saved = update(draft => {
      if (field.builtin) { draft.diaryBuiltinNames ||= {}; draft.diaryBuiltinNames[field.id] = null; }
      else draft.diaryFields = (draft.diaryFields || []).filter(item => item.id !== field.id);
    });
    if (saved === false) { setError('항목을 삭제하지 못했어요. 다시 시도해주세요.'); return; }
    setDeleting(null); setError(''); notify('기록 항목을 삭제했어요.');
  };
  const toggle = field => {
    const saved = update(draft => {
      if (field.builtin) { draft.diaryBuiltins ||= {}; draft.diaryBuiltins[field.id] = !field.enabled; }
      else { const target = draft.diaryFields?.find(item => item.id === field.id); if (target) target.enabled = !field.enabled; }
    });
    setError(saved === false ? '항목 설정을 저장하지 못했어요. 다시 시도해주세요.' : '');
  };
  const add = () => {
    if (!label.trim()) { setError('항목 이름을 입력해주세요.'); return; }
    if (label.trim().length > 500) { setError('항목 이름은 500자 이내로 입력해주세요.'); return; }
    if ((data.diaryFields || []).length >= 1000) { setError('사용자 정의 항목은 최대 1,000개까지 저장할 수 있어요. 기존 항목을 다시 켜서 사용해주세요.'); return; }
    const field = { id: uid(), label: label.trim(), type, enabled: true };
    const saved = update(draft => { draft.diaryFields ||= []; if (draft.diaryFields.length < 1000) draft.diaryFields.push(field); });
    if (saved === false) { setError('항목을 저장하지 못했어요. 다시 시도해주세요.'); return; }
    setLabel(''); setError(''); notify('기록 항목을 추가했어요.');
  };
  return <details className="custom-diary-manager"><summary>기록 항목 관리</summary><div className="custom-diary-settings"><p className="muted">체크를 해제하면 항목을 잠시 숨길 수 있어요. 이름을 바꾸거나 삭제해도 이미 기록한 이름과 답변은 그대로 남아요.</p>
    <div className="custom-diary-templates">{fields.map(field => <div className="custom-diary-row" key={field.id}>
      <label><input type="checkbox" checked={field.enabled === true} onChange={() => toggle(field)}/><span>{field.label} <small className="muted">{typeNames[field.type]}</small></span></label>
      {editing !== field.id && deleting !== field.id && <div className="diary-field-actions">
        <button type="button" className="btn subtle small" aria-label={field.label + ' 이름 수정'} onClick={() => { setDeleting(null); setEditing(field.id); setName(field.label); setError(''); }}>이름 수정</button>
        <button type="button" className="btn subtle small records-danger" aria-label={field.label + ' 항목 삭제'} onClick={() => { setEditing(null); setDeleting(field.id); setError(''); }}>삭제</button>
      </div>}
      {editing === field.id && <div className="diary-field-edit"><label className="field">변경할 이름<input autoFocus maxLength={500} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); if (!e.nativeEvent.isComposing) rename(field); }
      }}/></label>
        <button type="button" className="btn small" disabled={!name.trim()} onClick={() => rename(field)}>이름 저장</button>
        <button type="button" className="btn subtle small" onClick={() => { setEditing(null); setError(''); }}>취소</button>
      </div>}
      {deleting === field.id && <div className="records-delete-confirm">
        <span>‘{field.label}’ 항목을 삭제할까요? 지난 답변은 남아요.</span>
        <button type="button" className="btn small records-danger" onClick={() => remove(field)}>삭제하기</button>
        <button type="button" className="btn subtle small" onClick={() => setDeleting(null)}>취소</button>
      </div>}
    </div>)}</div>
    <div className="custom-diary-add"><label className="field">새 항목 이름<input maxLength={80} value={label} onChange={e => setLabel(e.target.value)} placeholder="예: 피로, 수면 시간, 산책 여부" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}/></label><label className="field">응답 방식<select value={type} onChange={e => setType(e.target.value)}>{Object.entries(typeNames).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label><button type="button" className="btn subtle" onClick={add}><Plus size={16}/>항목 추가</button></div>{error && <p role="alert" className="records-error">{error}</p>}</div></details>;
}
export function CustomDiaryInputs({ fields, values, setValues, prior = [] }) {
  return <div className="custom-diary-inputs">{fields.filter(field => field.enabled).map(field => {
    const snapshot = prior.find(answer => answer.id === field.id);
    const label = snapshot?.label ?? field.label;
    const type = snapshot?.type ?? field.type;
    const stools = field.builtin && field.id === 'stools';
    const value = values[field.id] ?? '';
    const change = e => setValues(current => ({ ...current, [field.id]: e.target.value }));
    return <label className="field" key={field.id}>{label}<span className="muted">{typeNames[type]} · 선택</span>{type === 'boolean' ? <select value={String(value)} onChange={change}><option value="">기록하지 않음</option><option value="true">O · 있음 / 예</option><option value="false">X · 없음 / 아니요</option></select> : <input type="number" min={type === 'scale' || stools ? 0 : undefined} max={type === 'scale' ? 10 : stools ? 1000 : undefined} step={type === 'scale' || stools ? 1 : 'any'} value={value} onChange={change} placeholder="기록하지 않음"/>}</label>;
  })}</div>;
}
