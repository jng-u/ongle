import React, { useEffect, useState } from 'react';
import { BookHeart, CalendarDays, ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Stethoscope, FlaskConical, Pill, ArrowRight, Check } from 'lucide-react';
import { useApp } from '../core.jsx';
import { uid, todayKey, addDays, formatDate, dayStats } from '../model.js';
import { PageHead, Empty, Modal, MoodFace, conditionNames } from '../ui.jsx';
import './records.css';
import { DiaryFieldManager, CustomDiaryInputs } from './CustomDiary.jsx';
import { entryExists, entryAnswers, formatDiaryAnswer, getDiaryFields, writeBuiltinAnswers, buildCustomAnswers } from '../data/diaryFields.js';
import { followupDate, followupDraft, duplicatePlannedVisit, recentHospitals, storeVisit } from '../data/followup.js';
import { isDateKey } from '../model.js';
import './followup.css';

const conditions = conditionNames;
const dateLabel = value => formatDate(value, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
const localKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const visitOrder = (a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`);
const isPastVisit = visit => {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return visit.date < todayKey(now) || (visit.date === todayKey(now) && !!visit.time && visit.time < time);
};
const isFutureVisit = visit => {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return visit.date > todayKey(now) || (visit.date === todayKey(now) && !!visit.time && visit.time > time);
};
const isCompletedVisit = visit => visit.completed === true && !isFutureVisit(visit);
function EntryDetails({ entry }) {
  if (!entry) return null;
  return <><div className="records-tags">
    {entry.condition != null && <span className="tag">컨디션 · {conditions[entry.condition - 1]}</span>}
    {entryAnswers(entry).map(answer => <span className="tag" key={answer.id}>{formatDiaryAnswer(answer)}</span>)}
  </div>{entry.note && <p className="records-note">{entry.note}</p>}</>;
}
function DateBrowse({ date, setDate }) {
  return <div className="records-date-nav"><button className="icon-btn" aria-label="이전 날짜" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={18}/></button><label className="records-date-label"><span className="sr-only">기록 날짜</span><input aria-label="기록 날짜" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)}/></label><button className="icon-btn" aria-label="다음 날짜" onClick={() => setDate(addDays(date, 1))}><ChevronRight size={18}/></button><button className="btn subtle small" onClick={() => setDate(todayKey())}>오늘</button></div>;
}
export function Diary() {
  const { data, date, setDate, open } = useApp();
  const entry = data.entries?.[date];
  const future = date > todayKey();
  const dates = Object.keys(data.entries || {}).filter(key => entryExists(data.entries[key]) && key !== date).sort().reverse();
  return <div className="records-page"><PageHead title="하루 기록" description="작은 변화도, 오늘의 마음도 남겨보세요." action={<button className="btn primary" disabled={future && !entryExists(entry)} onClick={() => open('entry', { date })}><Pencil size={17}/>{entryExists(entry) ? (future ? '기록 확인' : '기록 수정') : '기록 남기기'}</button>}/>
    <section className="panel"><div className="panel-head"><h2>{dateLabel(date)}</h2><DateBrowse date={date} setDate={setDate}/></div>
      {entryExists(entry) ? <div className="records-entry"><EntryDetails entry={entry}/><button className="btn subtle small" onClick={() => open('entry', { date })}>{future ? '기록 확인' : '기록 수정'} <ArrowRight size={15}/></button></div> : <Empty icon={BookHeart} title={future ? '미래 날짜예요' : '아직 남긴 기록이 없어요'} text={future ? '몸 상태는 해당 날짜부터 기록할 수 있어요.' : '컨디션이나 증상, 기억하고 싶은 일을 편하게 적어보세요.'} action={!future && <button className="btn primary" onClick={() => open('entry', { date })}>기록 남기기</button>}/>}
    </section>
    <section className="panel"><div className="panel-head"><h2>내 기록 항목</h2></div><div className="records-padding"><DiaryFieldManager/></div></section>
    <section className="panel"><div className="panel-head"><h2>날짜별 기록</h2><span className="muted">{dates.length}일</span></div>{dates.length ? <div className="record-list">{dates.map(key => <button key={key} className="record-row records-history" onClick={() => setDate(key)}><div><strong>{formatDate(key, { year: 'numeric', month: 'long', day: 'numeric' })}</strong><span>{data.entries[key].condition != null ? conditions[data.entries[key].condition - 1] : entryAnswers(data.entries[key]).map(formatDiaryAnswer).join(' · ') || '하루 메모'}{data.entries[key].note ? ` · ${data.entries[key].note}` : ''}</span></div><ChevronRight size={18}/></button>)}</div> : <p className="records-padding muted">기록이 쌓이면 여기에서 다시 볼 수 있어요.</p>}</section>
  </div>;
}
function VisitRow({ visit, open }) {
  const completed = isCompletedVisit(visit);
  const status = completed ? (visit.type === 'exam' ? '검사 실시 확인' : '진료 완료') : isPastVisit(visit) ? '예정일 지남 · 완료 미확인' : '예정';
  return <div className="record-row records-visit"><div className={`records-event-icon ${visit.type === 'exam' ? 'exam' : ''}`}>{visit.type === 'exam' ? <FlaskConical size={20}/> : <Stethoscope size={20}/>}</div><div className="records-row-main"><div className="records-row-title"><strong>{visit.title}</strong><span className="tag">{visit.type === 'exam' ? '검사' : '진료'}</span><span className={`records-visit-status ${completed ? 'completed' : ''}`}>{status}</span></div><p className="muted">{dateLabel(visit.date)}{visit.time && ` · ${visit.time}`}{visit.place && ` · ${visit.place}`}</p>{visit.note && <p className="records-note">{visit.note}</p>}</div><div className="followup-row-actions"><button className="icon-btn" aria-label={`${visit.title} 수정`} onClick={() => open('visit', { id: visit.id })}><Pencil size={17}/></button><button className="btn subtle small" aria-label={`${visit.title} 다음 일정 추가`} onClick={() => open('visit', { followupId: visit.id })}>다음 일정 <Plus size={14}/></button></div></div>;
}
export function Visits() {
  const { data, open } = useApp();
  const upcoming = (data.visits || []).filter(v => !isCompletedVisit(v) && !isPastVisit(v)).sort(visitOrder);
  const past = (data.visits || []).filter(v => isCompletedVisit(v) || isPastVisit(v)).sort((a, b) => visitOrder(b, a));
  const lastExams = new Map();
  past.filter(v => v.type === 'exam' && isCompletedVisit(v)).forEach(v => { const name = v.title.trim().replace(/\s+/g, ' '); if (!lastExams.has(name)) lastExams.set(name, v); });
  return <div className="records-page"><PageHead title="진료와 검사" description="다가오는 일정부터 지난 진료 내용까지 한곳에." action={<button className="btn primary" onClick={() => open('visit')}><Plus size={18}/>일정 추가</button>}/>
    {(data.visits || []).some(v => v.type === 'exam') && <section className="panel"><div className="panel-head"><h2>마지막 검사일</h2><span className="muted">직접 실시를 확인한 검사만 표시해요</span></div>{!lastExams.size && <p className="records-padding muted">실시를 확인한 검사 기록이 없어요. 지난 예약은 검사일로 집계하지 않아요.</p>}<div className="records-exam-dates">{[...lastExams].map(([name, v]) => <button className="records-last-exam" key={name} onClick={() => open('visit', { id: v.id })}><FlaskConical size={18}/><strong>{name}</strong><span>{formatDate(v.date, { year: 'numeric', month: 'short', day: 'numeric' })}</span><ChevronRight size={16}/></button>)}</div></section>}
    <section className="panel"><div className="panel-head"><h2>다가오는 일정</h2><span className="tag">{upcoming.length}개</span></div>{upcoming.length ? <div className="record-list">{upcoming.map(v => <VisitRow key={v.id} visit={v} open={open}/>)}</div> : <Empty icon={CalendarDays} title="예정된 일정이 없어요" text="다음 진료나 검사 일정을 미리 남겨두세요." action={<button className="btn subtle" onClick={() => open('visit')}>일정 추가</button>}/>}</section>
    <section className="panel"><div className="panel-head"><h2>지난 일정·완료 기록</h2><span className="muted">{past.length}개</span></div>{past.length ? <div className="record-list">{past.map(v => <VisitRow key={v.id} visit={v} open={open}/>)}</div> : <p className="records-padding muted">예정일이 지난 일정과 완료 기록을 모아드려요.</p>}</section>
  </div>;
}
export function Calendar() {
  const { data, date, setDate, go, open } = useApp();
  const [month, setMonth] = useState(date.slice(0, 7));
  useEffect(() => setMonth(date.slice(0, 7)), [date]);
  const first = new Date(`${month}-01T12:00:00`);
  const start = addDays(`${month}-01`, -first.getDay());
  const count = Math.ceil((first.getDay() + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7) * 7;
  const visits = (data.visits || []).filter(v => v.date === date).sort(visitOrder);
  const labs = (data.labs || []).filter(v => v.date === date);
  const entry = data.entries?.[date];
  const future = date > todayKey();
  const dose = dayStats(data, date);
  const moveMonth = delta => { const next = new Date(first.getFullYear(), first.getMonth() + delta, 1, 12); setMonth(localKey(next).slice(0, 7)); };
  const selectDay = day => { setDate(day); setMonth(day.slice(0, 7)); };
  const keyboardDay = (e, day) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (delta != null) { e.preventDefault(); const next = addDays(day, delta); selectDay(next); requestAnimationFrame(() => document.getElementById(`records-day-${next}`)?.focus()); }
  };
  return <div className="records-page"><PageHead title="건강 달력" description="복약, 기록, 병원 일정을 날짜별로 살펴보세요." action={<button className="btn primary" onClick={() => open('visit', { date })}><Plus size={18}/>일정 추가</button>}/>
    <section className="panel records-calendar"><div className="panel-head"><h2 aria-live="polite">{first.getFullYear()}년 {first.getMonth() + 1}월</h2><div className="records-date-nav"><button className="icon-btn" aria-label="이전 달" onClick={() => moveMonth(-1)}><ChevronLeft size={19}/></button><button className="btn subtle small" onClick={() => selectDay(todayKey())}>오늘</button><button className="icon-btn" aria-label="다음 달" onClick={() => moveMonth(1)}><ChevronRight size={19}/></button></div></div>
      <div className="records-calendar-legend"><span><i className="dose"/>복약 체크</span><span><i className="event"/>진료·검사</span><span><i className="entry"/>하루 기록</span><span><i className="lab"/>검사 수치</span></div>
      <div className="records-month-grid"><div className="records-weekdays">{['일', '월', '화', '수', '목', '금', '토'].map(d => <span key={d}>{d}</span>)}</div><div className="records-days">{Array.from({ length: count }, (_, i) => {
        const day = addDays(start, i), dose = dayStats(data, day);
        const events = (data.visits || []).filter(v => v.date === day);
        const hasEntry = entryExists(data.entries?.[day]);
        const labCount = (data.labs || []).filter(v => v.date === day).length;
        const summary = [dose.done ? `복약 ${dose.done}/${dose.total}` : dose.actualCount ? `실제 복약 ${dose.actualCount}회` : '', events.length ? `일정 ${events.length}개` : '', hasEntry ? '하루 기록' : '', labCount ? `검사 수치 ${labCount}개` : ''].filter(Boolean).join(', ');
        return <button id={`records-day-${day}`} key={day} className={`records-day ${day.slice(0, 7) !== month ? 'outside' : ''} ${day === date ? 'selected' : ''} ${day === todayKey() ? 'today' : ''}`} aria-label={`${day}${summary ? `, ${summary}` : ', 기록 없음'}`} aria-pressed={day === date} onClick={() => selectDay(day)} onKeyDown={e => keyboardDay(e, day)}><span className="records-day-number">{Number(day.slice(-2))}</span><span className="records-day-content">{(dose.done > 0 || dose.actualCount > 0) && <span className="records-day-dose"><Pill size={12}/>{dose.total ? `${dose.done}/${dose.total}` : `${dose.actualCount}회`}</span>}{events.slice(0, 2).map(v => <span className="records-day-event" key={v.id}>{v.title}</span>)}{events.length > 2 && <span className="records-day-extra">+{events.length - 2}</span>}<span className="records-day-dots">{hasEntry && <i className="entry"/>}{labCount > 0 && <i className="lab"/>}{events.length > 0 && <i className="event"/>}{(dose.done > 0 || dose.actualCount > 0) && <i className="dose"/>}</span></span></button>;
      })}</div></div>
    </section>
    <section className="panel"><div className="panel-head"><h2>{dateLabel(date)}</h2><button className="btn subtle small" onClick={() => go('today')}>이날 복약 보기 <ArrowRight size={15}/></button></div><div className="records-day-summary"><p className="records-dose-summary"><Pill size={18}/>{dose.total ? `복약 체크 ${dose.done} / ${dose.total}` : dose.actualCount ? `실제 복약 기록 ${dose.actualCount}회` : '이날 예정된 복약이 없어요'}</p>{visits.map(v => <VisitRow key={v.id} visit={v} open={open}/>)}<div className="records-summary-entry"><div className="records-row-title"><BookHeart size={18}/><strong>하루 기록</strong><button className="btn subtle small" disabled={future && !entryExists(entry)} onClick={() => open('entry', { date })}>{entryExists(entry) ? (future ? '기록 확인' : '수정') : '기록하기'}</button></div>{entryExists(entry) ? <EntryDetails entry={entry}/> : <p className="muted">{future ? '몸 상태는 해당 날짜부터 기록할 수 있어요.' : '아직 남긴 기록이 없어요.'}</p>}</div>{labs.length > 0 && <div className="records-summary-labs"><div className="records-row-title"><FlaskConical size={18}/><strong>검사 수치</strong><button className="btn subtle small" onClick={() => go('labs')}>검사 기록 보기 <ArrowRight size={14}/></button></div>{labs.map(lab => <p key={lab.id}><span>{lab.name}</span><strong>{lab.value} <small>{lab.unit}</small></strong></p>)}</div>}<button className="btn subtle" onClick={() => open('visit', { date })}><Plus size={16}/>이날 일정 추가</button></div></section>
  </div>;
}
function DeleteAction({ onDelete, label }) {
  const [confirm, setConfirm] = useState(false);
  return confirm ? <div className="records-delete-confirm"><span>{label} 삭제할까요?</span><button type="button" className="btn small records-danger" onClick={onDelete}>삭제</button><button type="button" className="btn subtle small" onClick={() => setConfirm(false)}>취소</button></div> : <button type="button" className="btn subtle records-danger" onClick={() => setConfirm(true)}><Trash2 size={16}/>삭제</button>;
}
function EntryForm({ payload }) {
  const { data, date, update, close, notify } = useApp();
  const day = payload.date || date || todayKey();
  const [base] = useState(() => data);
  const prior = base.entries?.[day];
  const future = day > todayKey();
  const [condition, setCondition] = useState(payload.condition ?? prior?.condition ?? null);
  const fields = getDiaryFields(data);
  const [values, setValues] = useState(() => Object.fromEntries(entryAnswers(prior).map(answer => [answer.id, answer.value])));
  const [note, setNote] = useState(prior?.note || '');
  const [error, setError] = useState('');
  const save = e => {
    e.preventDefault();
    if (day > todayKey()) { setError('미래의 몸 상태는 해당 날짜부터 기록할 수 있어요.'); return; }
    let entry;
    try {
      entry = { pain: null, stools: null, blood: null, ...prior, condition, note: note.trim(), custom: buildCustomAnswers(fields, values, prior?.custom) };
      writeBuiltinAnswers(entry, fields, values);
    } catch (error) { setError(error.message); return; }
    if (!entryExists(entry)) { setError('컨디션이나 메모 등 한 가지 이상 남겨주세요.'); return; }
    const saved = update(draft => { draft.entries ||= {}; draft.entries[day] = entry; }, {base});
    if (saved === false) { setError('저장하지 못했어요. 다른 창에서 같은 항목을 바꿨거나 기록·저장 공간에 문제가 있어요. 입력 내용을 보관한 뒤 최신 기록을 확인해 주세요.'); return; }
    close(); notify('하루 기록을 저장했어요.');
  };
  return <Modal title="하루 기록" subtitle={dateLabel(day)} onClose={close}><form className="form-stack records-form" onSubmit={save}>
    {future && <p className="records-future-note" role="status">미래의 몸 상태는 해당 날짜부터 기록할 수 있어요. 기존 기록은 삭제할 수 있어요.</p>}
    <fieldset disabled={future} className="records-entry-fields" aria-label="하루 기록 입력">
    <fieldset className="records-fieldset"><legend>이날 컨디션은 어땠나요? <span className="muted">선택</span></legend><div className="records-moods">{conditions.map((label, i) => <button type="button" key={label} aria-pressed={condition === i + 1} className={condition === i + 1 ? 'active' : ''} onClick={() => setCondition(condition === i + 1 ? null : i + 1)}><MoodFace value={i + 1} size={32}/>{label}</button>)}</div></fieldset>
    <CustomDiaryInputs fields={fields} values={values} setValues={setValues} prior={entryAnswers(prior)}/>
    {prior && entryAnswers(prior).some(answer => !fields.some(field => field.id === answer.id && field.enabled)) && <div className="custom-diary-history"><strong>숨긴 항목의 이전 답변</strong><p className="muted">{entryAnswers(prior).filter(answer => !fields.some(field => field.id === answer.id && field.enabled)).map(formatDiaryAnswer).join(' · ')}<br/>이 답변은 저장 후에도 보존돼요.</p></div>}
    <DiaryFieldManager/>
    <label className="field">증상과 하루 메모 <span className="muted">선택</span><textarea rows="4" value={note} onChange={e => setNote(e.target.value)} placeholder="불편했던 증상이나 기억하고 싶은 일을 적어주세요."/></label></fieldset>{error && <p className="records-error" role="alert">{error}</p>}
    <div className="form-actions records-form-actions">{prior && <DeleteAction label="이날 기록을" onDelete={() => { const saved = update(draft => { delete draft.entries[day]; }, {base}); if (saved === false) { setError('삭제하지 못했어요. 다시 시도해주세요.'); return; } close(); notify('하루 기록을 삭제했어요.'); }}/>}<button type="button" className="btn subtle" onClick={close}>취소</button><button className="btn primary" type="submit" disabled={future}><Check size={17}/>저장</button></div>
  </form></Modal>;
}
function VisitForm({ payload }) {
  const { data, date, update, close, notify } = useApp();
  const [base] = useState(() => data);
  const prior = (base.visits || []).find(v => v.id === payload.id);
  const source = (data.visits || []).find(v => v.id === payload.followupId);
  const following = !!payload.followupId && !payload.id;
  const [form, setForm] = useState(() => following ? followupDraft(source || {}) : { type: prior?.type || payload.type || 'visit', date: prior?.date || payload.date || date || todayKey(), time: prior?.time || '', title: prior?.title || '', place: prior?.place || '', note: prior?.note || '', completed: prior?.completed === true });
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('months');
  const [error, setError] = useState('');
  const hospitals = recentHospitals(data.visits || []);
  const applyInterval = () => {
    const next = followupDate(source?.date, Number(amount), unit);
    if (!next) { setError('간격을 1~1200 사이의 정수로 입력해주세요.'); return; }
    setForm(current => ({ ...current, date: next, completed: false }));
    setError('');
  };
  const field = key => ({ value: form[key], onChange: e => {
    if (key === 'date') setAmount('');
    const value = e.target.value;
    setForm(current => {
      const next = { ...current, [key]: value };
      return isFutureVisit(next) ? { ...next, completed: false } : next;
    });
  } });
  const save = e => {
    e.preventDefault();
    if (!form.title.trim() || !isDateKey(form.date)) { setError('일정 이름과 올바른 날짜를 입력해주세요.'); return; }
    if (payload.id && !prior) { setError('이미 삭제된 일정이에요. 창을 닫고 다시 확인해주세요.'); return; }
    if (following && !source) { setError('원래 일정이 삭제되었어요. 창을 닫고 새 일정을 추가해주세요.'); return; }
    if (following && (form.date <= source.date || form.date < todayKey() || isPastVisit(form))) { setError('원래 일정 이후의 다가오는 날짜와 시간을 선택해주세요.'); return; }
    const record = { ...prior, ...form, completed: form.completed && !isFutureVisit(form), title: form.title.trim(), place: form.place.trim(), note: form.note.trim(), id: prior?.id || uid() };
    if (duplicatePlannedVisit(data.visits || [], record)) { setError('같은 이름·병원·종류·날짜·시간의 예정 일정이 이미 있어요. 기존 일정을 확인하거나 입력 내용을 변경해주세요.'); return; }
    let inserted = true;
    const saved = update(draft => { draft.visits ||= []; inserted = storeVisit(draft.visits, record); }, {base, check: merged => {
      const latest = merged.visits.find(v => v.id === record.id);
      return !!latest && !duplicatePlannedVisit(merged.visits, latest) && (!following || merged.visits.some(v => v.id === payload.followupId));
    }});
    if (saved === false) { setError('저장하지 못했어요. 다른 창에서 같은 항목을 바꿨거나 기록·저장 공간에 문제가 있어요. 입력 내용을 보관한 뒤 최신 기록을 확인해 주세요.'); return; }
    if (!inserted) { setError('같은 예정 일정이 이미 저장되어 있어요. 기존 일정을 확인해주세요.'); return; }
    close(); notify('일정을 저장했어요.');
  };
  return <Modal title={prior ? '일정 수정' : following ? '다음 진료·검사 일정' : '진료·검사 일정 추가'} subtitle={following ? '기존 기록을 유지하고 새 일정을 추가해요. 결과 메모와 완료 표시는 가져오지 않아요.' : '일정과 진료 내용을 함께 남겨보세요.'} onClose={close}><form className="form-stack records-form" onSubmit={save}>
    {following && <fieldset className="followup-schedule"><legend>다음 날짜 정하기</legend><p className="followup-source">기준: {source ? `${dateLabel(source.date)} · ${source.title}` : '원래 일정을 찾을 수 없어요.'}<br/>안내받은 간격을 입력하거나 아래 날짜를 직접 선택해주세요. 월말은 해당 월의 마지막 날로 맞춰요.</p><div className="followup-controls"><label className="field">간격<input type="number" min="1" max="1200" step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="예: 3"/></label><label className="field">단위<select value={unit} onChange={e => setUnit(e.target.value)}><option value="weeks">주 후</option><option value="months">개월 후</option></select></label><button type="button" className="btn subtle" disabled={!source || !amount} onClick={applyInterval}>날짜 적용</button></div></fieldset>}
    <fieldset className="records-fieldset"><legend>일정 종류</legend><div className="records-type-picker">{[['visit', '진료', Stethoscope], ['exam', '검사', FlaskConical]].map(([value, label, Icon]) => <button key={value} className={form.type === value ? 'active' : ''} type="button" aria-pressed={form.type === value} onClick={() => setForm(current => ({ ...current, type: value }))}><Icon size={18}/>{label}</button>)}</div></fieldset>
    <label className="field">{form.type === 'exam' ? '검사명' : '진료 이름'}<input required maxLength={120} {...field('title')} placeholder={form.type === 'exam' ? '예: 대장내시경' : '예: 소화기내과 정기 진료'}/></label>
    <div className="records-form-pair"><label className="field">날짜<input type="date" required min={following ? (source?.date >= todayKey() ? addDays(source.date, 1) : todayKey()) : undefined} {...field('date')}/></label><label className="field">시간 <span className="muted">선택</span><input type="time" {...field('time')}/></label></div>
    <label className="field">병원·장소 <span className="muted">선택</span><input list="followup-hospital-names" {...field('place')} placeholder="병원명, 진료실 등을 적어주세요."/><datalist id="followup-hospital-names">{hospitals.map(place => <option key={place} value={place}/>)}</datalist></label>
    {hospitals.length > 0 && <div className="followup-hospitals" role="group" aria-label="최근 일정의 병원·장소">{hospitals.map(place => <button key={place} type="button" className="btn subtle small" aria-pressed={form.place === place} onClick={() => setForm(current => ({ ...current, place }))}>{place}</button>)}</div>}
    <div className="records-completion"><label><input type="checkbox" checked={form.completed && !isFutureVisit(form)} disabled={isFutureVisit(form)} onChange={e => setForm(current => ({ ...current, completed: e.target.checked }))}/>{form.type === 'exam' ? '검사를 받았어요' : '진료를 받았어요'}</label><p className="muted">{isFutureVisit(form) ? '미래 일정은 완료로 표시할 수 없어요.' : '예약일이 지났어도 직접 확인하기 전에는 완료로 표시하지 않아요.'}</p></div>
    <label className="field">진행 상황·결과 메모 <span className="muted">선택</span><textarea rows="4" {...field('note')} placeholder="준비할 일, 상담 내용, 검사 결과 등을 남겨주세요."/></label>{error && <p className="records-error" role="alert">{error}</p>}
    <div className="form-actions records-form-actions">{prior && <DeleteAction label="이 일정을" onDelete={() => { const saved = update(draft => { draft.visits = draft.visits.filter(v => v.id !== prior.id); }, {base}); if (saved === false) { setError('삭제하지 못했어요. 다시 시도해주세요.'); return; } close(); notify('일정을 삭제했어요.'); }}/>}<button type="button" className="btn subtle" onClick={close}>취소</button><button type="submit" className="btn primary"><Check size={17}/>저장</button></div>
  </form></Modal>;
}
export function RecordDialog({ name, payload = {} }) {
  if (name === 'entry') return <EntryForm key={`entry-${payload.date || ''}-${payload.condition ?? ''}`} payload={payload}/>;
  if (name === 'visit') return <VisitForm key={`visit-${payload.id || ''}-${payload.date || ''}-${payload.type || ''}`} payload={payload}/>;
  return null;
}
