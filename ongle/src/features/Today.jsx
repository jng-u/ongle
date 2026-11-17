import {isAndroidPackage} from '../data/androidReference.js';
import React, {useEffect, useState} from 'react';
import {AlarmClock, ArrowRight, ArrowUpRight, BookOpen, CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, ClipboardList, Clock3, FlaskConical, Moon, NotebookPen, LockKeyhole, Pill, Plus, SlidersHorizontal, SquarePen, Stethoscope, Sun, Sunrise, Sunset} from 'lucide-react';
import {useApp} from '../core.jsx';
import {addDays, activeVersions, actualDosesOn, recordDose, checkKey, dayStats, formatDate, medsOn, parseDate, slotsOn, todayKey} from '../model.js';
import {conditionNames, MoodFace} from '../ui.jsx';
const shortDate = (date)=>formatDate(date,{month:'long',day:'numeric'});
const offsetMonths=(month,n)=>{const d=parseDate(month+'-01');d.setMonth(d.getMonth()+n);return todayKey(d).slice(0,7);};
function slotIcon(slot) {
  const hr=Number(slot.time.slice(0,2));
  if(hr<6 || hr>=21)return [Moon,'night'];
  if(hr<11)return [Sunrise,'morning'];
  if(hr<16)return [Sun,'noon'];
  return [Sunset,'evening'];
}
function DosePanel() {
  const {data,date,update,open,notify,go} = useApp(), slots=slotsOn(data,date), {done,total}=dayStats(data,date);
  const actual = actualDosesOn(data,date), prn = activeVersions(data.meds,date).filter(m => m.schedule?.type === 'prn');
  const future = date>todayKey(), firstBook = data.meds.length===0;
  function toggle(slotId,id) {
    if(future) return;
    const key=checkKey(date,slotId,id), checked=!!data.checks[key];
    const ok=update(d=>{if(checked) delete d.checks[key]; else recordDose(d,date,slotId,id);});
    if(ok) notify(checked?'복용 체크를 취소했어요.':'복용을 기록했어요.');
  }
  return <section className="panel doses">
    <div className="dash-panel-head"><div className="head-with-icon"><span className="head-icon"><Pill size={20}/></span><h2>복약 체크</h2></div><button className="text-action" onClick={()=>open('slots')}><SlidersHorizontal size={15}/>시간대 관리</button></div>
    {firstBook ? <div className="first-dose"><div><strong>아직 등록한 약이 없어요</strong><p>약과 먹는 시간을 연결해 주세요.</p></div><button className="btn primary" onClick={()=>open('med')}><Plus size={15}/>첫 약 등록하기</button></div> : total ? <div className="progress-block"><div><span>예정 중 복용</span><b>{done}<small> / {total}회</small></b></div><progress max={Math.max(total,1)} value={done} aria-label="복약 완료 횟수"/></div> : <p className="future-note">이날 예정된 복약이 없어요.</p>}
    {future&&<p className="future-note">예정된 복약이에요. 해당 날짜부터 체크할 수 있어요.</p>}
    <div className={'dose-list '+(firstBook?'first-list':'')}>{slots.map(s=>{
      const [Icon,color]=slotIcon(s), meds=medsOn(data,date,s.id);
      return <div className="dose-slot" key={s.id}>
        <span className={'slot-icon '+color}><Icon size={21} strokeWidth={1.65}/></span>
        <div className="slot-body"><div className="slot-line"><h3>{s.name}</h3><span className="time-label"><Clock3 size={12}/>{s.time}</span></div>
        {meds.length ? <div className="dose-items">{meds.map(m=>{
          const checked=!!data.checks[checkKey(date,s.id,m.id)];
          return <button key={m.id} className={'dose-item '+(checked?'is-done':'')} disabled={future} aria-pressed={checked} aria-label={s.name+' '+m.name+' 복용 '+(checked?'취소':'체크')} onClick={()=>toggle(s.id,m.id)}><span className="dose-check">{checked&&<Check size={13} strokeWidth={3}/>}</span><span>{m.name}{m.dose&&<small> · {m.dose}</small>}</span></button>
        })}</div>:!firstBook&&<p>등록된 약이 없어요</p>}</div>
        {!firstBook&&meds.length===0&&<button className="slot-add" aria-label={s.name+' 약 등록'} onClick={()=>open('med',{slotId:s.id})}><Plus size={17}/></button>}
      </div>
    })}</div>
    {!!prn.length && <div className="prn-doses"><h3>필요시 복약</h3><p className="muted">실제로 복용할 때마다 기록해요. 예정 횟수에는 포함하지 않아요.</p>{prn.map(m => <button key={m.id} disabled={future} className="btn subtle" onClick={() => {if(update(d => recordDose(d,date,'prn',m.id))) notify('필요시 복용을 기록했어요.');}}>{m.name} · {m.dose} <Plus size={14}/></button>)}</div>}
    {!!actual.length && <details className="actual-doses"><summary>실제 복용 기록 {actual.length}회</summary>{actual.map(dose => <div className="record-row" key={dose.key}><span>{dose.slotName} {dose.time} · {dose.name} {dose.dose}</span><button className="btn subtle small" disabled={future} onClick={() => {if(update(d => {delete d.checks[dose.key];})) notify('복용 기록을 취소했어요.');}}>기록 취소</button></div>)}</details>}
    {!slots.length&&<div className="no-slots">이 날짜에는 복약 시간대가 없어요. <button className="inline-link" onClick={()=>open('slots')}>시간대 추가</button></div>}
    {!firstBook&&<div className="dose-footer"><button className="btn primary" onClick={()=>open('med')}><Plus size={16}/>약 등록하기</button><button className="text-action" onClick={()=>go('meds')}>내 약 보기 <ArrowRight size={14}/></button></div>}
  </section>;
}
function MonthPanel() {
  const {data,date,setDate,go}=useApp(), today=todayKey();
  const [month,setMonth]=useState(date.slice(0,7));
  useEffect(()=>setMonth(date.slice(0,7)),[date]);
  const first=month+'-01', start=addDays(first,-parseDate(first).getDay()), next=offsetMonths(month,1)+'-01';
  const length=Math.ceil((parseDate(first).getDay()+Number(addDays(next,-1).slice(-2)))/7)*7;
  const marks = new Set([...Object.keys(data.entries),...data.visits.map(v=>v.date),...data.labs.map(l=>l.date),...Object.keys(data.checks).filter(k=>data.checks[k]).map(k=>k.slice(0,10))]);
  return <section className="panel month-panel"><div className="dash-panel-head"><div className="head-with-icon"><span className="head-icon"><CalendarDays size={19}/></span><h2>기록 캘린더</h2></div><button className="icon-btn direction-link" aria-label="전체 캘린더 열기" onClick={()=>go('calendar')}><ArrowUpRight size={17}/></button></div>
    <div className="month-title"><span>{formatDate(first,{year:'numeric',month:'long'})}</span><span className="month-steer"><button className="icon-btn" aria-label="지난달" onClick={()=>setMonth(m=>offsetMonths(m,-1))}><ChevronLeft size={16}/></button><button className="icon-btn" aria-label="다음달" onClick={()=>setMonth(m=>offsetMonths(m,1))}><ChevronRight size={16}/></button></span></div>
    <div className="mini-grid">{['일','월','화','수','목','금','토'].map((d,i)=><span className={'week-name '+(!i?'sunday':'')} key={d}>{d}</span>)}
    {Array.from({length},(_,i)=>{
      const key=addDays(start,i),outside=!key.startsWith(month),selected=key===date;
      return <button key={key} className={['mini-day',outside?'outside':'',i%7===0?'sunday':'',key===today?'current':'',selected?'selected':''].join(' ')} onClick={()=>setDate(key)} aria-label={formatDate(key,{year:'numeric',month:'long',day:'numeric'})+(marks.has(key)?' · 기록 있음':'')} aria-pressed={selected} aria-current={key===today?'date':undefined}><span>{Number(key.slice(-2))}{marks.has(key)&&<i/>}</span></button>;
    })}</div><div className="calendar-foot"><span><i className="legend-dot"/>기록이 있는 날</span><button disabled={date===today&&month===today.slice(0,7)} className="text-action" onClick={()=>{setDate(today);setMonth(today.slice(0,7));}}>오늘로</button></div>
  </section>;
}
function MoodPanel() {
  const {data,date,open,go}=useApp(), entry=data.entries[date], future=date>todayKey();
  return <section className="panel mood-panel"><div className="dash-panel-head"><div className="head-with-icon"><span className="head-icon warm"><BookOpen size={19}/></span><h2>증상 일기</h2></div><button className="icon-btn direction-link" aria-label="증상 일기 목록" onClick={()=>go('diary')}><ArrowUpRight size={17}/></button></div>
    <p className="mood-question">{future?'이날의 몸 상태를 기록할 공간이에요.':entry?'이날 기록한 몸 상태예요.':'몸 상태가 어땠나요?'}</p>
    <div className="mood-buttons">{conditionNames.map((label,i)=><button key={label} className={entry?.condition===i+1?'active':''} aria-pressed={entry?.condition===i+1} disabled={future} onClick={()=>open('entry',{date,condition:i+1})}><MoodFace value={i+1} size={34}/><span>{label}</span></button>)}</div>
    <button disabled={future} className="mood-write" onClick={()=>open('entry',{date})}><SquarePen size={15}/>{entry?'일기 열기':'일기 쓰기'}<ArrowRight size={14}/></button>
  </section>;
}
function VisitsPanel() {
  const {data,go,open}=useApp(), clock=new Date(), now=todayKey(clock), localTime=String(clock.getHours()).padStart(2,'0')+':'+String(clock.getMinutes()).padStart(2,'0'), upcoming=data.visits.filter(v=>v.completed!==true && (v.date>now || (v.date===now && (!v.time || v.time>=localTime)))).sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||''))).slice(0,3);
  return <section className="panel upcoming-panel"><div className="dash-panel-head"><div className="head-with-icon"><span className="head-icon lilac"><Stethoscope size={19}/></span><h2>다가오는 진료·검사</h2></div><button className="icon-btn direction-link" aria-label="진료·검사 이력 보기" onClick={()=>go('visits')}><ArrowUpRight size={17}/></button></div>
    {upcoming.length ? <div className="upcoming-list">{upcoming.map(v=><button key={v.id} onClick={()=>open('visit',{id:v.id})}><span className="date-tile"><small>{Number(v.date.slice(5,7))}월</small><b>{Number(v.date.slice(-2))}</b></span><span><strong>{v.title}</strong><small>{[v.place,v.time].filter(Boolean).join(' · ')||'시간 미정'}</small></span><ChevronRight size={15}/></button>)}</div>:<p className="upcoming-empty">예정된 진료나 검사가 없어요.</p>}
    <button className="text-action new-visit" onClick={()=>open('visit',{type:'visit',date:now})}><CalendarPlus size={15}/>일정 추가</button>
  </section>;
}
export function Today() {
  const {data,date,open,go,demo}=useApp(),today=todayKey();
  const newBook=!demo && !data.meds.length && !data.labs.length && !data.visits.length && !Object.keys(data.entries).length;
  return <><header className="welcome">
    <img className="welcome-art" src={`${import.meta.env.BASE_URL}garden.svg`} alt="" aria-hidden="true"/>
    <div className="welcome-copy"><span className="date-stamp"><CalendarDays size={14}/>{formatDate(date,{year:'numeric',month:'long',day:'numeric',weekday:'long'})}</span>
      <h1>{date===today?'오늘의 건강 수첩':shortDate(date)+'의 건강 수첩'}</h1><p>복약부터 몸 상태까지, 하루의 기록을 남겨요.</p></div>
  </header>{newBook&&<button className="storage-hint" onClick={()=>go('settings')}><LockKeyhole size={14}/><span>내 기록은 <b>{isAndroidPackage()?'이 앱에만':'이 브라우저에만'}</b> 저장돼요.</span><span className="hint-link">백업 설정 <ChevronRight size={13}/></span></button>}<div className="overview-layout"><div className="overview-left"><DosePanel/><MoodPanel/></div><div className="overview-right"><MonthPanel/><VisitsPanel/></div></div>
    <button className="summary-banner" onClick={()=>open('summary')}><span><ClipboardList size={20}/><span><strong>진료 전 기록 모아보기</strong><small>원하는 기간의 복약과 증상, 검사 결과를 한 장에</small></span></span><ArrowRight size={17}/></button></>;
}
