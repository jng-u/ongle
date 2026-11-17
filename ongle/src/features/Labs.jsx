import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, FlaskConical, ArrowUpRight, Pencil, Trash2, BookOpen, Search, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../core.jsx';
import { uid, todayKey, formatDate } from '../model.js';
import { PageHead, Empty, Modal } from '../ui.jsx';
import { labReferences, REFERENCE_SYNC_DATE, groupLabs, metricKey, referenceCandidates, searchReferences, rangeText, rangeStatus, validateLab, labFromForm, putLab, removeLab } from '../data/labRefs.js';
import { onlineLabIds, isOnlineLabReference } from '../data/onlineLab.js';
import { isAndroidPackage, getAndroidLabReference } from '../data/androidReference.js';
import './labs.css';

const numberText = value => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 6 }).format(value);
const fullDate = date => formatDate(date, { year: 'numeric', month: 'long', day: 'numeric' });
const dayStamp = date => Date.parse(`${date}T12:00:00Z`);

function ReferenceDetail({ record }) {
  const ref = record.reference;
  const knownSource = ref && labReferences.find(item => item.id === ref.id && item.url === ref.url);
  return <div className="labs-reference-detail">
    <strong>참고범위 {rangeText(record)} {record.low != null || record.high != null ? record.unit : ''}</strong>
    {ref?.population && <p>{ref.population}</p>}
    {ref?.bands && <p>{ref.bands}</p>}
    {ref?.caveat && <p>{ref.caveat}</p>}
    {knownSource && <a href={knownSource.url} target="_blank" rel="noreferrer">{ref.publisher || '참고 출처'} 원문 <ArrowUpRight size={14} /></a>}
    {ref?.mode === 'online' ? <small>온라인 원문 확인 {new Date(ref.checkedAt).toLocaleString('ko-KR')} · 검증된 참고범위 버전 {ref.referenceVersion}</small> : ref?.syncedAt && <small>공식 출처 확인 {ref.syncedAt} · 오프라인 저장 자료</small>}
    {ref?.mode === 'online' && isOnlineLabReference(ref, ref.id) && ref.resolvedUrl !== ref.url && <a href={ref.resolvedUrl} target="_blank" rel="noreferrer">실제로 확인한 카탈로그 원문 <ArrowUpRight size={14} /></a>}
    {!ref && record.source && <p>기록한 출처: {record.source}</p>}
  </div>;
}

function TrendChart({ records, unit, selectedId, onSelect }) {
  const chartRef = useRef(null);
  const [chartWidth, setChartWidth] = useState(760);
  useEffect(() => {
    const measure = () => setChartWidth(Math.max(280, chartRef.current ? chartRef.current.clientWidth - 40 : 760));
    measure();
    const observer = new ResizeObserver(entries => {
      if (entries[0]) setChartWidth(Math.max(280, entries[0].contentRect.width));
    });
    if (chartRef.current) observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);
  const finite = records.filter(record => Number.isFinite(record.value));
  if (!finite.length) return <p className="muted">표시할 숫자 기록이 없어요.</p>;
  const selected = finite.find(record => record.id === selectedId) || finite.at(-1);
  const bounds = finite.map(record => record.value).concat([selected.low, selected.high].filter(value => value != null && Number.isFinite(value)));
  const min = Math.min(...bounds), max = Math.max(...bounds), padding = (max - min || Math.abs(max) || 1) * .16;
  const bottom = min - padding, top = max + padding;
  const width = chartWidth, height = 258, left = 64, right = 24, yTop = 20, yBottom = 218;
  const start = dayStamp(finite[0].date), end = dayStamp(finite.at(-1).date);
  const x = record => start === end ? (width + left - right) / 2 : left + (dayStamp(record.date) - start) / (end - start) * (width - left - right);
  const y = value => yBottom - (value - bottom) / (top - bottom) * (yBottom - yTop);
  const currentIndex = finite.findIndex(record => record.id === selected.id);
  return <div className="labs-trend" ref={chartRef}>
    <div className="labs-chart-readout" aria-live="polite"><span>{fullDate(selected.date)}</span><strong>{numberText(selected.value)} <small>{unit}</small></strong><span>{rangeStatus(selected)}</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${unit} 단위 검사 추세, ${finite.length}개 기록. 아래 이전·다음 버튼으로 기록을 살펴보세요.`}>
      <title>검사일 간격에 따른 수치 변화</title>
      {[0, 1, 2, 3].map(index => { const value = bottom + (top - bottom) * index / 3; return <g key={index}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="labs-grid-line" /><text x={left - 10} y={y(value) + 4} textAnchor="end">{numberText(value)}</text></g>; })}
      {[['low', selected.low], ['high', selected.high]].filter(([, value]) => value != null).map(([key, value]) => <line key={key} x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="labs-reference-line"><title>{`${key === 'low' ? '하한' : '상한'} ${value} ${unit} · 선택한 기록의 참고범위`}</title></line>)}
      <polyline points={finite.map(record => `${x(record)},${y(record.value)}`).join(' ')} className="labs-trend-line" />
      {finite.map(record => <circle key={record.id} cx={x(record)} cy={y(record.value)} r={record.id === selected.id ? 7 : 4.5} className={`labs-point ${record.id === selected.id ? 'is-selected' : ''}`} onMouseEnter={() => onSelect(record.id)} onClick={() => onSelect(record.id)}><title>{`${record.date}: ${record.value} ${unit}`}</title></circle>)}
      <text x={left} y={246}>{finite[0].date}</text><text x={width - right} y={246} textAnchor="end">{finite.length > 1 ? finite.at(-1).date : ''}</text>
    </svg>
    <div className="labs-chart-controls"><button type="button" className="icon-btn" aria-label="이전 검사 기록" disabled={currentIndex === 0} onClick={() => onSelect(finite[currentIndex - 1].id)}><ChevronLeft size={18} /></button><span>{currentIndex + 1} / {finite.length} 기록</span><button type="button" className="icon-btn" aria-label="다음 검사 기록" disabled={currentIndex === finite.length - 1} onClick={() => onSelect(finite[currentIndex + 1].id)}><ChevronRight size={18} /></button><span className="labs-chart-legend">점선: 선택한 기록의 참고 경계</span></div>
    <ReferenceDetail record={selected} />{selected.note && <p className="labs-selected-note">{selected.note}</p>}
  </div>;
}

export function Labs() {
  const { data, open } = useApp();
  const groups = useMemo(() => groupLabs(data.labs || []), [data.labs]);
  const [key, setKey] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [period, setPeriod] = useState('all');
  const group = groups.find(item => item.key === key) || groups[0];
  // Anchor relative periods to today; future-dated records remain in the full history.
  const cutoff = dayStamp(todayKey()) - Number(period) * 86400000;
  const records = group?.records.filter(record => period === 'all' || (dayStamp(record.date) >= cutoff && dayStamp(record.date) <= dayStamp(todayKey()))) || [];
  return <div className="labs-page">
    <PageHead title="검사 기록" description="숫자의 변화를 차근차근 살펴보세요." action={<button className="btn primary" onClick={() => open('lab')}><Plus size={18} />검사 추가</button>} />
    {!group ? <Empty icon={FlaskConical} title="첫 검사 결과를 남겨볼까요?" text="검사 이름, 수치와 단위를 입력하면 변화가 한눈에 보여요." action={<button className="btn primary" onClick={() => open('lab')}>검사 기록하기</button>} /> : <>
      <div className="labs-toolbar"><label className="field">검사 항목 · 단위<select value={group.key} onChange={event => { setKey(event.target.value); setSelectedId(''); }} >{groups.map(item => <option key={item.key} value={item.key}>{item.name} · {item.unit} ({item.records.length})</option>)}</select></label><label className="field">차트 기간<select value={period} onChange={event => { setPeriod(event.target.value); setSelectedId(''); }}><option value="all">전체 기간</option><option value="90">최근 3개월</option><option value="365">최근 1년</option></select></label></div>
      <section className="panel labs-chart-panel" aria-label="검사 추세"><div className="panel-head"><h2>{group.name}의 변화</h2><span className="muted">{group.unit} · {records.length}회</span></div>{records.length ? <TrendChart records={records} unit={group.unit} selectedId={selectedId} onSelect={setSelectedId} /> : <p className="labs-no-period">이 기간에는 기록이 없어요. 전체 기간을 선택해 보세요.</p>}</section>
      <section className="panel labs-history"><div className="panel-head"><h2>검사 이력</h2><span className="muted">{group.records.length}개 · 최신순</span></div><div className="record-list">{[...group.records].reverse().map(record => <div key={record.id} className="record-row labs-history-row"><div><time dateTime={record.date}>{fullDate(record.date)}</time><p className="labs-history-range">{rangeText(record)} {record.low != null || record.high != null ? record.unit : ''}</p></div><div className="labs-history-result"><strong>{numberText(record.value)} <small>{record.unit}</small></strong><span>{rangeStatus(record)}</span></div><button className="icon-btn" aria-label={`${record.date} ${record.name} 기록 수정`} onClick={() => open('lab', { id: record.id })}><Pencil size={16} /></button></div>)}</div></section>
    </>}
    <aside className="labs-guidance"><BookOpen size={19} /><div><strong>결과지의 참고범위를 먼저 확인해 주세요</strong><p>검사기관·검사법·연령에 따라 범위가 달라요. 참고범위 안팎 여부는 진단이나 치료 목표를 뜻하지 않아요. 단위가 다른 기록은 따로 표시해요.</p><details><summary>자동 참고자료의 출처와 갱신</summary><p>공식 검사목록을 직접 확인해 동기화한 저장 자료예요. 자동 제안은 아래 검사 이름과 단위가 일치할 때 제공해요. CRP·칼프로텍틴은 입력 화면의 ‘공식 사이트에서 지금 확인’으로 온라인 원문도 조회할 수 있어요. 마지막 확인: {REFERENCE_SYNC_DATE}.</p><ul>{labReferences.map(ref => <li key={ref.id}><a href={ref.url} target="_blank" rel="noreferrer">{ref.name} · {ref.publisher} <ArrowUpRight size={12} /></a></li>)}</ul><p>다른 검사는 검사기관 결과지의 범위를 직접 입력해 주세요.</p></details></div></aside>
  </div>;
}

function OnlineLookup({ reference, onApply }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState('');
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  if (!onlineLabIds.includes(reference.id)) return null;
  async function lookup() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setResult(null); setFailure('');
    const timer = setTimeout(() => controller.abort(), 11000);
    try {
      let found;
      if (isAndroidPackage()) {
        found = await getAndroidLabReference(reference.id, controller.signal);
      } else {
        const response = await fetch(`/api/lab-reference?id=${encodeURIComponent(reference.id)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error();
        found = await response.json();
      }
      if (!isOnlineLabReference(found, reference.id)) throw new Error();
      if (request.current === controller && !controller.signal.aborted) setResult(found);
    } catch {
      if (request.current === controller) setFailure('온라인 원문을 확인하지 못했어요. 아래 오프라인 저장 자료나 검사 결과지를 이용해 주세요.');
    } finally {
      clearTimeout(timer);
      if (request.current === controller) setBusy(false);
    }
  }
  return <div className="labs-online-lookup">
    <button type="button" className="btn small" disabled={busy} onClick={lookup}><Search size={15} />{busy ? '공식 원문 확인 중…' : '공식 사이트에서 지금 확인'}</button>
    <p className="muted">검사 항목 ID만 전송해요. 수치와 개인 기록은 보내지 않아요.</p>
    {failure && <p role="status">{failure}</p>}
    {result && <div className="labs-online-preview"><strong>온라인 확인 결과 · 적용 전 미리보기</strong><ReferenceDetail record={{ ...result, reference: result }} /><button type="button" className="btn small primary" onClick={() => onApply(result)}><Check size={15} />확인한 참고범위 적용</button></div>}
  </div>;
}

const emptyForm = date => ({ date, name: '', value: '', unit: '', low: '', high: '', lowInclusive: true, highInclusive: true, source: '', note: '', reference: null });
export function LabDialog({ name, payload = {} }) {
  const app = useApp();
  if (name !== 'lab') return null;
  const existing = app.data.labs?.find(record => record.id === payload.id);
  if (payload.id && !existing) return <Modal title="기록을 찾을 수 없어요" onClose={app.close}><p>이미 삭제된 기록일 수 있어요.</p><button className="btn" onClick={app.close}>닫기</button></Modal>;
  return <LabForm key={payload.id || `new-${app.date}`} existing={existing} app={app} />;
}

function LabForm({ existing, app }) {
  const { data, update, date, close, notify } = app;
  const [base] = useState(() => data);
  const [form, setForm] = useState(() => ({ ...emptyForm(date || todayKey()), ...existing, low: existing?.low ?? '', high: existing?.high ?? '' }));
  const [error, setError] = useState('');
  const [query, setQuery] = useState(existing?.name || '');
  const [lookup, setLookup] = useState(false);
  const [auto, setAuto] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const candidates = auto ? referenceCandidates(form.name, form.unit) : [];
  const saved = [...(data.labs || [])].filter(item => item.id !== existing?.id && metricKey(item) === metricKey(form) && (item.low != null || item.high != null)).sort((a, b) => b.date.localeCompare(a.date))[0];
  const patch = (field, value) => { setError(''); setForm(current => ({ ...current, [field]: value, ...(['low', 'high', 'lowInclusive', 'highInclusive', 'source', 'name', 'unit'].includes(field) ? { reference: null, ...(['name', 'unit'].includes(field) ? { low: '', high: '', source: '' } : {}) } : {}) })); };
  function apply(ref, fromSaved = false) {
    setForm(current => ({ ...current, low: ref.low ?? '', high: ref.high ?? '', lowInclusive: ref.lowInclusive !== false, highInclusive: ref.highInclusive !== false, source: fromSaved ? ref.source || '' : `${ref.publisher} · ${ref.name}`, reference: fromSaved ? ref.reference || null : { ...ref } }));
    setError('');
  }
  function submit(event) {
    event.preventDefault();
    const validation = validateLab(form);
    if (validation) { setError(validation); return; }
    const record = labFromForm(form, existing?.id || uid());
    const saved = update(draft => { putLab(draft, record); }, {base});
    if (saved === false) { setError('저장하지 못했어요. 다른 창의 변경과 충돌했거나 기록·저장 공간에 문제가 있어요. 입력 내용을 보관한 뒤 최신 기록을 확인해 주세요.'); return; }
    notify(existing ? '검사 기록을 수정했어요.' : '검사 기록을 저장했어요.');
    close();
  }
  return <Modal title={existing ? '검사 기록 수정' : '검사 결과 남기기'} subtitle="검사 결과지를 보며 입력해 주세요." onClose={close}>
    <form className="form-stack labs-form" onSubmit={submit}>
      <label className="field">검사일<input type="date" required value={form.date} onChange={event => patch('date', event.target.value)} /></label>
      <label className="field">검사 이름<input autoFocus required maxLength={100} placeholder="예: CRP, 대변 칼프로텍틴" list="labs-metric-names" value={form.name} onChange={event => patch('name', event.target.value)} /><datalist id="labs-metric-names">{labReferences.map(ref => <option key={ref.id} value={ref.name} />)}</datalist></label>
      <div className="labs-form-columns"><label className="field">검사 수치<input type="number" step="any" required placeholder="예: 3.2" value={form.value} onChange={event => patch('value', event.target.value)} /></label><label className="field">단위<input required maxLength={30} placeholder="예: mg/L" list="labs-units" value={form.unit} onChange={event => patch('unit', event.target.value)} /><datalist id="labs-units">{['mg/L', 'mg/dL', 'mcg/g', 'g/dL', 'ng/L', 'pg/mL', 'g/L', 'U/L', '10⁹/L'].map(unit => <option key={unit} value={unit} />)}</datalist></label></div>
      <fieldset className="labs-reference-editor"><legend>참고범위 <span className="muted">선택</span></legend><p className="muted">결과지에 적힌 범위를 입력하거나, 출처를 확인한 뒤 적용하세요.</p><div className="labs-form-columns"><label className="field">하한<div className="labs-bound-input"><select aria-label="하한 포함 조건" value={form.lowInclusive === false ? 'exclusive' : 'inclusive'} onChange={event => patch('lowInclusive', event.target.value === 'inclusive')}><option value="inclusive">≥</option><option value="exclusive">&gt;</option></select><input type="number" step="any" aria-label="참고범위 하한" placeholder="없음" value={form.low} onChange={event => patch('low', event.target.value)} /></div></label><label className="field">상한<div className="labs-bound-input"><select aria-label="상한 포함 조건" value={form.highInclusive === false ? 'exclusive' : 'inclusive'} onChange={event => patch('highInclusive', event.target.value === 'inclusive')}><option value="inclusive">≤</option><option value="exclusive">&lt;</option></select><input type="number" step="any" aria-label="참고범위 상한" placeholder="없음" value={form.high} onChange={event => patch('high', event.target.value)} /></div></label></div>
      <label className="field">출처 · 검사기관<input maxLength={200} value={form.source || ''} onChange={event => patch('source', event.target.value)} placeholder="예: 검사 결과지 · 서울 ○○병원" /></label>
      <label className="labs-checkbox"><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} />검사명·단위로 검증된 참고자료 자동 제안</label>
      {candidates.map(ref => <div className="labs-candidate" key={ref.id}><OnlineLookup reference={ref} onApply={apply} /><strong className="labs-offline-label">오프라인 저장 자료</strong><ReferenceDetail record={{ ...ref, reference: ref }} /><button type="button" className="btn small" onClick={() => apply(ref)}><Check size={15} />저장된 참고범위 적용</button></div>)}
      {saved && <button type="button" className="btn subtle small" onClick={() => apply(saved, true)}>이전 기록의 참고범위 사용 · {saved.date}</button>}
      {form.reference && <div className="labs-applied" role="status"><Check size={15} />출처와 참고범위를 이 기록에 함께 저장해요.</div>}
      <button type="button" className="btn subtle small" aria-expanded={lookup} onClick={() => { setLookup(!lookup); setQuery(form.name); }}><Search size={15} />공식 출처 참고자료 찾기</button>
      {lookup && <div className="labs-lookup"><label className="field">검사 이름으로 찾기<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="CRP, 칼프로텍틴, 알부민, B12" /></label><p className="muted">공식 원문을 확인해 저장한 자료 · {REFERENCE_SYNC_DATE} 동기화 · 실시간 검색 아님</p>{searchReferences(query).map(ref => <div className="labs-lookup-result" key={ref.id}><strong>{ref.name} · {ref.unit}</strong><ReferenceDetail record={{ ...ref, reference: ref }} />{referenceCandidates(form.name, form.unit).some(item => item.id === ref.id) && <OnlineLookup reference={ref} onApply={apply} />}<button type="button" className="btn small" disabled={!referenceCandidates(form.name, form.unit).some(item => item.id === ref.id)} onClick={() => apply(ref)}>이 기록에 적용</button>{!referenceCandidates(form.name, form.unit).some(item => item.id === ref.id) && <small>검사 이름과 단위가 일치해야 적용할 수 있어요.</small>}</div>)}{!searchReferences(query).length && <p>일치하는 저장 자료가 없어요. 검사기관 결과지의 참고범위를 직접 입력해 주세요.</p>}</div>}
      <p className="labs-reference-note">기관·검사법·연령에 따라 참고범위가 달라요. 자동 제안은 진단이나 개인의 치료 목표가 아니에요.</p></fieldset>
      <label className="field">메모 <span className="muted">선택</span><textarea rows={2} maxLength={2000} placeholder="검사 당시의 상황이나 진료 때 물어볼 내용을 남겨보세요." value={form.note || ''} onChange={event => patch('note', event.target.value)} /></label>
      {error && <p className="labs-error" role="alert">{error}</p>}
      {confirmDelete && <div className="labs-delete-confirm" role="alert"><p>이 검사 기록을 삭제할까요? 삭제 후 되돌릴 수 없어요.</p><button type="button" className="btn small labs-delete" onClick={() => { const saved = update(draft => { removeLab(draft, existing.id); }, {base}); if (saved === false) { setError('삭제 내용을 저장하지 못했어요. 저장 공간을 확인한 뒤 다시 시도해 주세요.'); return; } notify('검사 기록을 삭제했어요.'); close(); }}>삭제하기</button><button type="button" className="btn small subtle" onClick={() => setConfirmDelete(false)}>유지하기</button></div>}
      <div className="form-actions">{existing && <button type="button" className="btn subtle labs-delete" onClick={() => setConfirmDelete(true)}><Trash2 size={16} />삭제</button>}<button type="button" className="btn subtle" onClick={close}>취소</button><button type="submit" className="btn primary">{existing ? '수정 저장' : '기록 저장'}</button></div>
    </form>
  </Modal>;
}
