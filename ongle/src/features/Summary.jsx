import React, {useEffect, useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import {Printer} from 'lucide-react';
import {Modal} from '../ui.jsx';
import {useApp} from '../core.jsx';
import {activeVersions, actualDosesOn, addDays, dayStats, slotsOn, todayKey, scheduleLabel} from '../model.js';
import {entryAnswers, formatDiaryAnswer} from '../data/diaryFields.js';
import {rangeText} from '../data/labRefs.js';
import {lastVisitDate, summaryDates} from '../data/summaryRange.js';
import './backup.css';
import './summary-range.css';

const shown = value => value === null || value === undefined || value === '' ? '미기록' : value;
function diarySummaryMetrics(entry) {
  return [...(entry.condition == null ? [] : ['컨디션 · '+entry.condition+'/5']),
    ...entryAnswers(entry).map(formatDiaryAnswer)];
}
export function SummarySheet({data, end, start = addDays(end, -29), dates = summaryDates(start, end, end), demo, includeDoses = false}) {
  const within = item => item.date >= start && item.date <= end;
  const entries = dates.filter(date => data.entries[date]);
  const labs = data.labs.filter(within).sort((a, b) => a.date.localeCompare(b.date));
  const visits = data.visits.filter(within).sort((a, b) => a.date.localeCompare(b.date));
  const currentMeds = activeVersions(data.meds, end);
  const slots = new Map(slotsOn(data, end).map(slot => [slot.id, slot]));
  const checksByDay = new Map();
  for (const [key, value] of Object.entries(data.checks)) {
    const day = key.slice(0,10);
    if (day < start || day > end) continue;
    if (!checksByDay.has(day)) checksByDay.set(day, {});
    checksByDay.get(day)[key] = value;
  }
  const daily = dates.map(date => {
    const journal = {...data, checks:checksByDay.get(date) || {}};
    return {date, ...dayStats(journal, date), doses:actualDosesOn(journal, date)};
  });
  const scheduled = daily.reduce((sum, day) => sum + day.total, 0);
  const checked = daily.reduce((sum, day) => sum + day.done, 0);
  const outside = daily.reduce((sum, day) => sum + day.actualCount - day.done, 0);
  return <article className="summary-sheet">
    <header><h2>진료 준비 · {dates.length}일 요약{demo ? ' (체험 기록)' : ''}</h2><p>{start} ~ {end} · 작성일 {todayKey()}</p><p>사용자가 직접 남긴 기록이에요. 미기록은 증상이 없거나 복약하지 않았다는 뜻이 아니에요.</p></header>
    <section><h3>복약 기록</h3><p>예정 {scheduled}회 중 복용 체크 {checked}회 · 체크하지 않은 기록 {scheduled - checked}회</p>{outside > 0 && <p>필요시 복용 또는 변경 전 일정에서 남긴 복용 기록 {outside}회</p>}<h4>{end} 기준 복용 일정</h4>{!currentMeds.length ? <p>등록된 복용 일정이 없어요.</p> : <ul>{currentMeds.map(med => <li key={med.id}><strong>{med.name}</strong> {med.dose} · {scheduleLabel(med.schedule)}{med.slotIds.map(id=>slots.get(id)).filter(Boolean).map(slot=>' · '+slot.name+' '+slot.time).join('')}{med.note && <p className="summary-note">{med.note}</p>}</li>)}</ul>}
      {(scheduled > 0 || outside > 0) && <details className="summary-daily"><summary>일별 복용 체크</summary><ul>{daily.filter(day => day.total > 0 || day.actualCount > 0).map(day => <li key={day.date}>{day.date} · 예정 중 {day.done} / {day.total}회{day.actualCount > day.done && ` · 별도 복용 ${day.actualCount - day.done}회`}</li>)}</ul></details>}
      {includeDoses && checked + outside > 0 && <div><h4>복용 당시 약과 용량</h4><ul>{daily.flatMap(day => day.doses.map(dose => <li key={dose.key}>{day.date} · {dose.slotName} {dose.time} · {dose.name} {dose.dose}</li>))}</ul></div>}
    </section>
    <section><h3>몸 상태 · {entries.length}일 기록</h3>{!entries.length ? <p>이 기간에 남긴 하루 기록이 없어요.</p> : <div className="summary-table-wrap"><table className="summary-journal"><caption>선택 기간의 몸 상태와 메모</caption><thead><tr><th scope="col">날짜</th><th scope="col">기록한 항목</th><th scope="col">메모</th></tr></thead><tbody>{entries.map(date => { const entry = data.entries[date], metrics=diarySummaryMetrics(entry); return <tr key={date}><th scope="row">{date}</th><td>{metrics.length?metrics.map((metric,i)=><div key={i}>{metric}</div>):'미기록'}</td><td className="summary-note">{shown(entry.note)}</td></tr>; })}</tbody></table></div>}</section>
    <section><h3>검사 결과 · {labs.length}건</h3>{!labs.length ? <p>이 기간에 남긴 검사 결과가 없어요.</p> : <ul>{labs.map(lab => <li key={lab.id}><strong>{lab.date} · {lab.name}</strong> {lab.value} {lab.unit}<p>참고범위: {rangeText(lab)} {lab.unit}</p>{lab.source && <p className="summary-note">출처: {lab.source}</p>}{lab.note && <p className="summary-note">{lab.note}</p>}</li>)}</ul>}</section>
    <section><h3>진료·검사 일정 · {visits.length}건</h3>{!visits.length ? <p>이 기간에 등록한 일정이 없어요.</p> : <ul>{visits.map(visit => <li key={visit.id}><strong>{visit.date} {visit.time} · {visit.title}</strong>{visit.place && <p>{visit.place}</p>}{visit.note && <p className="summary-note">{visit.note}</p>}</li>)}</ul>}</section>
    <footer>온결 · 이 요약은 진단이나 처방을 대신하지 않아요. 기록은 서버로 전송되지 않아요.</footer>
  </article>;
}

export function SummaryDialog({ name = 'summary' } = {}) {
  return name === 'summary' ? <SummaryContent /> : null;
}

function SummaryContent() {
  const { data, close, demo } = useApp();
  const [today] = useState(todayKey);
  const lastVisit = lastVisitDate(data.visits, today);
  const [mode, setMode] = useState('30');
  const [includeDoses, setIncludeDoses] = useState(false);
  const [custom, setCustom] = useState({start:addDays(today,-29), end:today});
  const start = mode === 'custom' ? custom.start : mode === 'visit' ? lastVisit : addDays(today, -Number(mode) + 1);
  const end = mode === 'custom' ? custom.end : today;
  const range = useMemo(() => {
    try { return {dates:summaryDates(start, end, today)}; }
    catch (error) { return {error:error.message}; }
  }, [start, end, today]);
  const sheet = useMemo(() => range.dates && <SummarySheet data={data} start={start} end={end} dates={range.dates} demo={demo} includeDoses={includeDoses}/>, [data, start, end, range, demo, includeDoses]);
  useEffect(() => {
    document.body.classList.add('ongle-summary-open');
    return () => document.body.classList.remove('ongle-summary-open');
  }, []);
  return <>
    <Modal title="진료 준비 요약" subtitle="진료에 가져갈 기간을 선택하세요." onClose={close}>
      <div className="summary-controls">
        <label className="field">요약 기간<select value={mode} onChange={e => setMode(e.target.value)}>
          <option value="30">최근 30일</option><option value="90">최근 90일</option>
          <option value="visit" disabled={!lastVisit}>지난 진료일부터{!lastVisit ? ' (완료한 진료 없음)' : ''}</option>
          <option value="custom">직접 선택</option>
        </select></label>
        {mode === 'custom' && <div className="summary-range-dates">
          <label className="field">시작일<input type="date" value={custom.start} max={today} onChange={e=>setCustom({...custom,start:e.target.value})}/></label>
          <label className="field">종료일<input type="date" value={custom.end} min={custom.start} max={today} onChange={e=>setCustom({...custom,end:e.target.value})}/></label>
        </div>}
        <label className="summary-option"><input type="checkbox" checked={includeDoses} onChange={e=>setIncludeDoses(e.target.checked)}/>복용 당시 약과 용량 포함</label>
        {range.error && <p role="alert" className="backup-error">{range.error}</p>}
      </div>
      <div className="summary-actions"><p className="muted">인쇄 창에서 종이 또는 PDF 저장을 선택하세요. 요약에는 개인 건강 기록이 포함돼요.</p>
        <button type="button" className="btn primary" disabled={!sheet} onClick={() => window.print()}><Printer size={18} aria-hidden="true"/>요약 인쇄 / PDF 저장</button></div>
      {sheet}
    </Modal>
    {sheet && createPortal(<div className="ongle-print-sheet" aria-hidden="true">{sheet}</div>, document.body)}
  </>;
}
