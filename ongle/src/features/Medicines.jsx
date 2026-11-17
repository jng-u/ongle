import React, {useEffect, useRef, useState} from 'react';
import {Clock3, Pill, Plus, Pencil, Search, Trash2, ExternalLink, ArrowRight} from 'lucide-react';
import {useApp} from '../core.jsx';
import {uid, scheduleLabel, activeVersions, preserveDoseSnapshots, todayKey, isDateKey, slotsOn, formatDate} from '../model.js';
import {PageHead, Empty, Modal} from '../ui.jsx';
import {activeOn, validateMedicationSlots, replaceVersion, saveMedicine, saveSlots, searchRxNorm, CATALOG_VERIFIED, CATALOG_COUNT, CATALOG_DATE, HIRA_SOURCE, RXNORM_SOURCE} from '../data/drugs.js';
import {createDrugSearchClient} from '../data/drugSearchClient.js';
import './medicines.css';

export function Medicines() {
  const {data, date, open} = useApp();
  const slots = slotsOn(data, date);
  const meds = activeVersions(data.meds, date);
  const forSlot = id => meds.filter(med => med.schedule?.type !== 'prn' && med.slotIds.includes(id));
  const unassigned = meds.filter(med => med.schedule?.type !== 'prn' && !med.slotIds.some(id => slots.some(slot => slot.id === id)));
  return <div className="medicines-page">
    <PageHead eyebrow="작은 습관, 꾸준한 하루" title="나의 약" description="먹는 약과 시간을 내 생활에 맞게 정리해요." action={<button className="btn primary" onClick={() => open('med')}><Plus size={18}/> 약 추가</button>}/>
    <div className="medicines-toolbar"><p className="muted">{formatDate(date)} 기준 · 등록한 약 {meds.length}개</p><button className="btn subtle" onClick={() => open('slots')}><Clock3 size={17}/> 복약 시간 관리</button></div>
    {!slots.length && <Empty icon={Clock3} title="나에게 맞는 복약 시간부터" text="아침, 점심, 자기 전처럼 편한 이름으로 시간을 추가해요." action={<button className="btn primary" onClick={() => open('slots')}>시간 추가</button>}/>}
    <div className="medicines-schedule">{slots.map(slot => <section className="panel medicine-slot" key={slot.id}>
      <div className="panel-head"><div className="medicine-slot-title"><span className="medicine-clock"><Clock3 size={20}/></span><div><h2>{slot.name}</h2><span className="muted">{slot.time}</span></div></div><button className="icon-btn" aria-label={`${slot.name}에 약 추가`} onClick={() => open('med', {slotId: slot.id})}><Plus size={19}/></button></div>
      {forSlot(slot.id).length ? <div className="record-list">{forSlot(slot.id).map(med => <MedicineRow med={med} key={med.id} open={open}/>)}</div> : <div className="medicine-slot-empty"><p className="muted">아직 등록한 약이 없어요.</p><button className="btn subtle small" onClick={() => open('med', {slotId: slot.id})}>약 추가 <ArrowRight size={15}/></button></div>}
    </section>)}</div>
    {!!unassigned.length && <section className="panel medicine-unassigned"><h2>시간을 정하지 않은 약</h2><p className="muted">약을 수정해 복약 시간을 연결해 주세요.</p>{unassigned.map(med => <MedicineRow key={med.id} med={med} open={open}/>)}</section>}
    {meds.some(m => m.schedule?.type === 'prn') && <section className="panel medicine-unassigned"><h2>필요시 복약</h2><p className="muted">정기 알람 없이 실제 복용할 때 기록해요.</p>{meds.filter(m => m.schedule?.type === 'prn').map(med => <MedicineRow key={med.id} med={med} open={open}/>)}</section>}
    <p className="medicine-footnote">약 이름과 복용량은 처방전이나 약 봉투를 보며 기록해 주세요.</p>
  </div>;
}
function MedicineRow({med, open}) {
  return <div className="record-row medicine-row"><Pill size={19} aria-hidden="true"/><div className="medicine-row-copy"><strong>{med.name}</strong><span>{med.dose || '복용량 미입력'} · {scheduleLabel(med.schedule)}</span>{med.note && <p className="muted">{med.note}</p>}</div><button className="icon-btn" aria-label={`${med.name} 수정`} onClick={() => open('med', {id: med.id})}><Pencil size={16}/></button></div>;
}
export function MedicineDialog({name, payload = {}}) {
  const {date} = useApp();
  if (name === 'med') return <MedForm key={`med-${payload.id || 'new'}-${date}`} payload={payload}/>;
  if (name === 'slots') return <SlotsForm key={`slots-${date}`}/>;
  return null;
}
function EffectiveDate({value, onChange, correcting = false}) {
  return <label className="field">{correcting ? '최초 시작일' : '변경 적용일'}<input type="date" value={value} required onChange={event => onChange(event.target.value)}/><small className="muted">{correcting ? '첫 복용 기간의 시작일을 바로잡아요. 이후 변경과 기존 복용 체크는 유지하며, 새 체크는 만들지 않아요.' : '이 날짜부터 바뀌어요. 이전 기록과 이후 예약된 변경은 유지해요.'}</small></label>;
}
// Index check keys once at form opening; never resolve unrelated dose snapshots.
function checkHistory(data, medId) {
  if (medId === '') return [];
  return Object.entries(data.checks || {}).flatMap(([key,value]) => {
    const [date,slotId,id,extra] = key.split('|');
    return value && isDateKey(date) && slotId && id && extra === undefined && (medId === undefined || id === medId) ? [{date,slotId,medId:id}] : [];
  });
}
function impactNotice(history, future) {
  const dates = new Map();
  for (const item of history) dates.set(item.date,(dates.get(item.date) || 0) + 1);
  if (!dates.size && !future.length) return null;
  return <aside className="medicine-change-impact" aria-label="변경 영향 안내"><strong>변경 전 확인</strong>
    {!!dates.size && <><p>해당 기간의 실제 복용 체크는 스냅샷으로 보존해요.</p><ul>{[...dates].sort(([a],[b]) => a.localeCompare(b)).map(([date,count]) => <li key={date}>{date} · {count}회</li>)}</ul></>}
    {!!future.length && <><p>연결된 이후 처방 · 변경 후에도 복약 시간이 필요해요.</p><ul>{future.map(med => <li key={med.id + med.from}>{med.from} · {med.name}</li>)}</ul></>}
  </aside>;
}
function persistForm(update, base, mutate, setError, check) {
  let reason = '';
  const capture = fn => draft => {
    try { return fn(draft); } catch (error) {reason = error.message; throw error;}
  };
  try {
    // Show domain errors even when core.update catches exceptions and returns false.
    mutate(structuredClone(base));
    const saved = update(capture(mutate), {base, ...(check ? {check:capture(check)} : {})});
    if (saved !== false) return true;
    setError(reason || '저장하지 못했어요. 다른 창의 변경·복원 여부와 저장 공간을 확인하고, 창을 닫아 최신 기록으로 다시 열어 주세요.');
  } catch (error) {setError(error.message);}
  return false;
}
function MedForm({payload}) {
  const {data:openingData, date, update, close, notify} = useApp();
  const [data] = useState(openingData);
  const [effective, setEffective] = useState(date || todayKey());
  const [editMode, setEditMode] = useState('change');
  const [endCorrection, setEndCorrection] = useState(false);
  const [history] = useState(() => checkHistory(data,payload.id || ''));
  const first = data.meds.filter(med => med.id === payload.id).sort((a,b) => a.from.localeCompare(b.from))[0];
  const correcting = !!payload.id && (editMode === 'start' || !!first && effective < first.from);
  const current = activeVersions(data.meds,effective).find(med => med.id === payload.id);
  const [medicine, setMedicine] = useState(() => current ? {...current, slotIds: [...current.slotIds]} : {name:'', dose:'', note:'', slotIds: payload.slotId ? [payload.slotId] : []});
  const originalUntil = (correcting ? first : current)?.until;
  const impactUntil = !endCorrection ? originalUntil : !originalUntil || !medicine.until ? undefined : [originalUntil,medicine.until].sort().at(-1);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState([]);
  const [localSearch, setLocalSearch] = useState({query:'', results:[], busy:false, error:''});
  const localClient = useRef(null);
  useEffect(() => {
    const client = createDrugSearchClient(setLocalSearch);
    localClient.current = client;
    return () => {client.dispose(); localClient.current = null;};
  }, []);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  const slots = slotsOn(data, effective);
  const local = localSearch.query === query ? localSearch : {results:[], busy:!!query.trim(), error:''};
  const results = [...local.results, ...remote];
  const patch = (key, value) => setMedicine(old => ({...old, [key]: value}));
  const changeQuery = value => {request.current?.abort(); setBusy(false); setQuery(value); localClient.current?.search(value); setRemote([]); setStatus('');};
  const liveSearch = async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setRemote([]); setStatus('');
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const found = await searchRxNorm(query, {signal: controller.signal});
      if (request.current !== controller) return;
      setRemote(found); setStatus(found.length ? `미국 의약품 명칭 ${found.length}개를 찾았어요.` : '영문 검색 결과가 없어요. 직접 입력할 수 있어요.');
    } catch {
      if (request.current === controller) setStatus('온라인 검색에 연결하지 못했어요. 오프라인 검색이나 직접 입력을 이용해 주세요.');
    } finally {clearTimeout(timeout); if (request.current === controller) setBusy(false);}
  };
  const submit = event => {
    event.preventDefault(); setError('');
    if (!isDateKey(effective)) {setError('올바른 날짜를 선택해 주세요.'); return;}
    if (payload.id && !current && !correcting) {setError('적용일에 이 약이 없어요. 등록된 날짜를 선택해 주세요.'); return;}
    if (!medicine.name.trim()) {setError('약 이름을 입력해 주세요.'); return;}
    if (medicine.schedule?.type !== 'prn' && !medicine.slotIds.some(id => slots.some(slot => slot.id === id))) {setError('복약 시간을 하나 이상 선택해 주세요.'); return;}
    try {
      const id = payload.id || uid();
      const saved = persistForm(update, data, draft => {saveMedicine(draft, id, effective, {name:medicine.name.trim(), dose:medicine.dose, note:medicine.note, slotIds:medicine.slotIds, schedule:medicine.schedule}, {correctStart:correcting, ...(endCorrection ? {until:medicine.until || ''} : {})});}, setError, merged => validateMedicationSlots(merged,{from:effective,medIds:[id]}));
      if (!saved) return;
      notify(correcting ? '최초 시작일을 정정했어요. 기존 복용 체크와 이후 변경은 유지했어요.' : '약을 저장했어요.'); close();
    } catch (failure) {setError(failure.message);}
  };
  const remove = () => {
    if (!isDateKey(effective)) {setError('올바른 날짜를 선택해 주세요.'); return;}
    if (correcting) {setError('최초 시작일 정정 중에는 삭제할 수 없어요. 날짜부터 변경을 선택해 주세요.'); return;}
    if (!current) {setError('적용일에 이 약이 없어요.'); return;}
    const saved = persistForm(update, data, draft => {preserveDoseSnapshots(draft); draft.meds = replaceVersion(draft.meds, payload.id, effective, null);}, setError);
    if (!saved) return;
    notify('선택한 날짜부터 약 목록에서 제외했어요.'); close();
  };
  return <Modal title={payload.id ? '약 수정' : '약 추가'} subtitle="약 봉투에 적힌 내용을 편하게 옮겨 주세요." onClose={close}>
    <form className="form-stack medicine-form" onSubmit={submit}>
      {payload.id && <label className="field">수정 방식<select value={correcting ? 'start' : 'change'} onChange={event => {
        const mode = event.target.value;
        setEditMode(mode); setRemoving(false); setError('');
        const value = mode === 'start' ? first?.from || effective : date;
        setEffective(value);
        const version = mode === 'start' ? first : data.meds.find(med => med.id === payload.id && activeOn(med, value));
        if (version) setMedicine({...version, slotIds:[...version.slotIds]});
      }}><option value="change">이 날짜부터 변경</option><option value="start">최초 시작일 정정</option></select></label>}
      <EffectiveDate value={effective} correcting={correcting} onChange={value => {
        setEffective(value); setRemoving(false); setError('');
        const correctingStart = editMode === 'start' || first && value < first.from;
        const version = correctingStart ? first : data.meds.find(med => med.id === payload.id && activeOn(med, value));
        if (version) setMedicine({...version, slotIds:[...version.slotIds]});
      }}/>
      {payload.id && impactNotice(history.filter(item => item.date >= (correcting && first?.from < effective ? first.from : effective) && (!impactUntil || item.date < impactUntil)), data.meds.filter(med => med.id === payload.id && med.from > effective))}
      {correcting && <p className="muted" role="status">최초 시작일을 정정하고 있어요. 첫 복용 기간 전체에 입력한 내용을 적용해요.</p>}
      <label className="check-row"><input type="checkbox" checked={endCorrection} onChange={event => setEndCorrection(event.target.checked)}/>종료일도 정정</label>
      {endCorrection && <label className="field">복용하지 않는 첫날<input type="date" value={medicine.until || ''} onChange={event => patch('until',event.target.value)}/><small>이 날짜부터 예정에서 제외해요. 비우면 종료일을 없애요. 실제 기록과 이후 예약 변경은 유지해요.</small></label>}
      <div className="medicine-search"><label className="field" htmlFor="medicine-search">약 이름 찾기 <span className="muted">선택 사항</span></label><div className="medicine-search-input"><Search size={18}/><input id="medicine-search" value={query} onChange={event => changeQuery(event.target.value)} placeholder="제품명 또는 성분명 검색" autoComplete="off"/></div>
        <p className="muted">HIRA 공개 목록 {CATALOG_COUNT.toLocaleString('ko-KR')}개 · {CATALOG_DATE} 자료 · 오프라인 검색 가능</p>
        {!!query.trim() && <div className="medicine-results" aria-label="약 검색 결과">{results.map(drug => <div className="medicine-result" key={drug.id}><button type="button" onClick={() => {patch('name', drug.name); setStatus('약 이름을 선택했어요. 복용량과 시간을 입력해 주세요.');}}><strong>{drug.name}</strong><small>{drug.ingredient || '국내 의약품 · HIRA 공개 목록'}</small></button><a href={drug.sourceUrl} target="_blank" rel="noreferrer" aria-label={`${drug.name} 공식 출처 새 창`}><ExternalLink size={16}/></a></div>)}{!results.length && <p className="muted" role="status">{local.busy ? '약 이름을 찾고 있어요…' : local.error || '확인된 목록에 없어요. 아래에 약 이름을 직접 입력해 주세요.'}</p>}</div>}
        <button type="button" className="btn subtle small" disabled={busy || !/^[a-z0-9\s.,()[\]/+%-]+$/i.test(query.trim())} onClick={liveSearch}>{busy ? '영문 이름 찾는 중…' : 'NIH에서 영문 이름 검색'}</button>
        <p className="muted medicine-search-privacy">버튼을 누르면 검색어만 미국 NIH에 보내요. 복용량·메모는 보내지 않아요.</p><p role="status">{status}</p>
        <details className="medicine-sources"><summary>검색 출처 안내</summary><p><a href={HIRA_SOURCE} target="_blank" rel="noreferrer">건강보험심사평가원 약가마스터 의약품표준코드</a>의 제품명과 품목기준코드를 포장 중복 없이 정리했어요. 성분명은 <a href="https://www.data.go.kr/data/15067461/fileData.do" target="_blank" rel="noreferrer">HIRA 의약품주성분</a> 자료를 연결했어요. {CATALOG_VERIFIED} 내려받음 · 공공누리 제1유형(출처표시). 누적 자료여서 예전 이름과 취소된 품목이 포함될 수 있고, 현재 허가·판매·급여 여부와는 달라요. 검색 목록은 복용을 권하는 정보가 아니에요.</p><p><a href={RXNORM_SOURCE} target="_blank" rel="noreferrer">NIH NLM RxNorm</a>은 미국 의약품 명칭이에요.</p><p lang="en">This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.</p></details>
      </div>
      <label className="field">약 이름 · 직접 입력 가능<input value={medicine.name} onChange={event => patch('name', event.target.value)} required placeholder="약 봉투에 적힌 이름"/></label>
      <label className="field">한 번에 먹는 양<input value={medicine.dose} onChange={event => patch('dose', event.target.value)} placeholder="예: 2정, 1포, 5mL"/></label>
      <label className="field">복약 주기<select value={medicine.schedule?.type || 'daily'} onChange={event => patch('schedule', event.target.value === 'weekdays' ? {type:'weekdays',days:[1]} : event.target.value === 'interval' ? {type:'interval',every:2,anchor:effective} : {type:event.target.value})}><option value="daily">매일</option><option value="weekdays">요일별</option><option value="interval">격일</option><option value="prn">필요시</option></select></label>
      {medicine.schedule?.type === 'weekdays' && <fieldset className="medicine-slot-picker"><legend>복용 요일</legend>{['일','월','화','수','목','금','토'].map((label,day) => <label key={day}><input type="checkbox" checked={medicine.schedule.days.includes(day)} onChange={event => patch('schedule',{type:'weekdays',days:event.target.checked ? [...medicine.schedule.days,day] : medicine.schedule.days.filter(d => d !== day)})}/>{label}</label>)}</fieldset>}
      {medicine.schedule?.type === 'interval' && <label className="field">격일 기준일<input type="date" required value={medicine.schedule.anchor} onChange={event => patch('schedule',{type:'interval',every:2,anchor:event.target.value})}/><small>기준일과 그 전후 2일 간격으로 예정돼요.</small></label>}
      {medicine.schedule?.type === 'prn' && <p className="muted">필요할 때마다 오늘 화면에서 복용을 기록해요. 정기 알람과 예정 횟수에서 제외해요.</p>}
      <fieldset className="medicine-slot-picker"><legend>복약 시간 · 여러 개 선택 가능</legend>{slots.map(slot => <label key={slot.id}><input type="checkbox" checked={medicine.slotIds.includes(slot.id)} onChange={event => patch('slotIds', event.target.checked ? [...medicine.slotIds, slot.id] : medicine.slotIds.filter(id => id !== slot.id))}/><span>{slot.name} <small>{slot.time}</small></span></label>)}{!slots.length && <p className="muted">먼저 ‘복약 시간 관리’에서 시간을 추가해 주세요.</p>}</fieldset>
      <label className="field">복용 방법·메모<textarea value={medicine.note} onChange={event => patch('note', event.target.value)} placeholder="예: 아침 식후, 약 봉투의 안내" rows={3}/></label>
      {error && <p className="medicine-error" role="alert">{error}</p>}
      {removing && <div className="medicine-remove-confirm"><p>{effective}부터 이 약을 목록에서 제외할까요? 이전 복약 기록은 남아요.</p><button type="button" className="btn" onClick={remove}>목록에서 제외</button><button type="button" className="btn subtle" onClick={() => setRemoving(false)}>계속 수정</button></div>}
      <div className="form-actions">{payload.id && !correcting && !removing && <button type="button" className="btn subtle medicine-delete" onClick={() => setRemoving(true)}><Trash2 size={16}/> 약 삭제</button>}<button type="button" className="btn subtle" onClick={close}>취소</button><button type="submit" className="btn primary">저장</button></div>
    </form>
  </Modal>;
}
function SlotsForm() {
  const {data:openingData, date, update, close, notify} = useApp();
  const [data] = useState(openingData);
  const [effective, setEffective] = useState(date || todayKey());
  const [history] = useState(() => checkHistory(data));
  const [slots, setSlots] = useState(() => slotsOn(data, effective).map(slot => ({...slot})));
  const [mapping, setMapping] = useState(() => Object.fromEntries(data.meds.filter(med => activeOn(med, effective)).map(med => [med.id, [...med.slotIds]])));
  const [error, setError] = useState('');
  const meds = data.meds.filter(med => activeOn(med, effective));
  const changeDate = value => {
    setEffective(value); setSlots(slotsOn(data, value).map(slot => ({...slot})));
    setMapping(Object.fromEntries(data.meds.filter(med => activeOn(med, value)).map(med => [med.id, [...med.slotIds]]))); setError('');
  };
  const changeSlot = (id, field, value) => setSlots(old => old.map(slot => slot.id === id ? {...slot, [field]: value} : slot));
  const removeSlot = id => {setSlots(old => old.filter(slot => slot.id !== id)); setMapping(old => Object.fromEntries(Object.entries(old).map(([medId, ids]) => [medId, ids.filter(slotId => slotId !== id)])));};
  const changedSlots = new Set(slotsOn(data,effective).filter(old => !slots.some(slot => slot.id === old.id && slot.name === old.name && slot.time === old.time)).map(slot => slot.id));
  const remapped = new Set(meds.filter(med => JSON.stringify([...(mapping[med.id] || [])].sort()) !== JSON.stringify([...med.slotIds].sort())).map(med => med.id));
  const future = data.meds.filter(med => med.from > effective && med.slotIds.some(id => changedSlots.has(id)));
  const submit = event => {
    event.preventDefault(); setError('');
    if (slots.some(slot => !slot.name.trim() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time))) {setError('시간 이름과 시각을 확인해 주세요.'); return;}
    const missing = meds.find(med => med.schedule?.type !== 'prn' && !(mapping[med.id] || []).some(id => slots.some(slot => slot.id === id)));
    if (missing) {setError(`‘${missing.name}’의 복약 시간을 하나 이상 선택해 주세요.`); return;}
    try {
      const saved = persistForm(update, data, draft => {saveSlots(draft, effective, slots.map(slot => ({id:slot.id, name:slot.name.trim(), time:slot.time})), mapping);}, setError, merged => validateMedicationSlots(merged,{from:effective}));
      if (!saved) return;
      notify('복약 시간을 저장했어요.'); close();
    } catch (failure) {setError(failure.message);}
  };
  return <Modal title="복약 시간 관리" subtitle="생활 리듬에 맞춰 이름과 시간을 정해요." onClose={close}><form className="form-stack medicine-form" onSubmit={submit}>
    <EffectiveDate value={effective} onChange={changeDate}/>
    {impactNotice(history.filter(item => item.date >= effective && (changedSlots.has(item.slotId) || remapped.has(item.medId))),future)}
    <div className="medicine-slot-editor">{slots.map((slot, index) => <div className="medicine-slot-edit" key={slot.id}><label className="field">시간 이름 {index + 1}<input value={slot.name} required onChange={event => changeSlot(slot.id, 'name', event.target.value)} placeholder="예: 자기 전"/></label><label className="field">시각<input type="time" required value={slot.time} onChange={event => changeSlot(slot.id, 'time', event.target.value)}/></label><button type="button" className="icon-btn" aria-label={`${slot.name || index + 1} 시간 삭제`} onClick={() => removeSlot(slot.id)}><Trash2 size={17}/></button></div>)}</div>
    <button type="button" className="btn subtle" onClick={() => setSlots(old => [...old, {id:uid(), name:'', time:'09:00'}])}><Plus size={17}/> 시간 추가</button>
    {!!meds.length && <div className="medicine-mapping"><h3>약과 시간 연결</h3><p className="muted">시간을 삭제했다면 먹는 약을 다른 시간에 연결해 주세요.</p>{meds.map(med => <fieldset className="medicine-slot-picker" key={med.id}><legend>{med.name}</legend>{slots.map(slot => <label key={slot.id}><input type="checkbox" checked={(mapping[med.id] || []).includes(slot.id)} onChange={event => setMapping(old => ({...old, [med.id]:event.target.checked ? [...(old[med.id] || []), slot.id] : (old[med.id] || []).filter(id => id !== slot.id)}))}/><span>{slot.name || '새 시간'} <small>{slot.time}</small></span></label>)}</fieldset>)}</div>}
    {error && <p className="medicine-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="btn subtle" onClick={close}>취소</button><button type="submit" className="btn primary">저장</button></div>
  </form></Modal>;
}
