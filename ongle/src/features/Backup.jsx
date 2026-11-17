import {isAndroidPackage} from '../data/androidReference.js';
import React, { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useApp } from '../core.jsx';
import { todayKey } from '../model.js';
import { encryptBackup, decryptBackup, validateBackupData, backupCounts, MAX_BACKUP_BYTES } from '../data/backup.js';
import './backup.css';
import { saveFile } from '../data/fileSave.js';
import { backupSnapshot, backupDifference, readBackupMarker, BACKUP_MARKER_KEY } from '../data/backupReview.js';

function Counts({ data }) {
  const counts = backupCounts(data);
  return <dl className="backup-counts"><div><dt>복약 시간 이력</dt><dd>{data.slots.length}건</dd></div><div><dt>복용 체크</dt><dd>{Object.keys(data.checks).length}건</dd></div><div><dt>약 이력</dt><dd>{counts.meds}건</dd></div><div><dt>하루 기록</dt><dd>{counts.entries}일</dd></div><div><dt>진료·검사 일정</dt><dd>{counts.visits}건</dd></div><div><dt>검사 결과</dt><dd>{counts.labs}건</dd></div></dl>;
}

export function BackupSettings() {
  const { data, replaceJournal, captureRestoreBase, notify, demo, storageError } = useApp();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [file, setFile] = useState(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [preview, setPreview] = useState(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [marker, setMarker] = useState(() => { try { return readBackupMarker(window.localStorage); } catch { return null; } });
  const [changed, setChanged] = useState(null);
  const [difference, setDifference] = useState(null);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    setChanged(null); setDifference(null);
    if (!demo && !storageError && (marker || preview)) backupSnapshot(data).then(current => {
      if (active && marker) setChanged(backupDifference(current, marker.records));
      if (preview) return backupSnapshot(preview).then(restored => {
        if (active) setDifference(backupDifference(restored, current));
      });
    }).catch(() => {});
    return () => { active = false; };
  }, [data, marker, preview, demo, storageError]);
  const previewBase = useRef(null);
  const fileInput = useRef(null);
  useEffect(() => () => { generation.current += 1; }, []);
  function resetPreview() { previewBase.current = null; generation.current += 1; setPreview(null); setReplace(false); setError(''); }
  async function exportFile(event) {
    event.preventDefault();
    if (demo || busy || storageError) return;
    if (password !== confirmation) { setError('백업 비밀번호와 확인 입력이 같아야 해요.'); return; }
    const ticket = ++generation.current;
    setBusy('export'); setError('');
    try {
      const snapshot = structuredClone(data);
      const records = await backupSnapshot(snapshot);
      const encrypted = await encryptBackup(snapshot, password);
      if (ticket !== generation.current) return;
      const result = await saveFile({ blob: new Blob([encrypted], { type: 'application/json' }), name: `ongle-backup-${todayKey()}.json` });
      if (ticket !== generation.current) return;
      if (result.status === 'cancelled') { setError('파일 저장을 취소했어요. 백업 상태와 비밀번호는 유지돼요.'); return; }
      if (result.status === 'failed') throw new Error('파일을 저장하지 못했어요. 비밀번호는 유지돼요. 다시 시도해 주세요.');
      const nextMarker = { records, status: result.status, at: new Date().toISOString() };
      try { window.localStorage.setItem(BACKUP_MARKER_KEY, JSON.stringify(nextMarker)); setMarker(nextMarker); }
      catch { setError('파일 내보내기는 처리했지만 마지막 백업 상태를 기기에 기록하지 못했어요.'); }
      if (result.status === 'saved') {
        setPassword(''); setConfirmation('');
        notify('암호화된 백업 파일을 기기에 저장했어요.');
      } else notify('다운로드를 요청했어요. 브라우저에서 파일이 실제로 저장됐는지 확인해 주세요.');
    } catch (err) { if (ticket === generation.current) setError(err.message); }
    finally { if (ticket === generation.current) setBusy(''); }
  }
  async function previewFile(event) {
    event.preventDefault();
    if (demo || busy || !file) return;
    const ticket = ++generation.current;
    setBusy('restore'); setError(''); setPreview(null); setReplace(false); previewBase.current = null;
    try {
      if (!file.size || file.size > MAX_BACKUP_BYTES) throw new Error('비어 있거나 8MB를 넘는 파일은 열 수 없어요. 온결 백업 파일을 선택해 주세요.');
      if (typeof captureRestoreBase !== 'function') throw new Error('안전한 복원 기능을 준비 중이에요. 잠시 후 다시 시도해 주세요.');
      const base = captureRestoreBase();
      const restored = await decryptBackup(await file.text(), restorePassword);
      if (ticket === generation.current) { previewBase.current = { value: base }; setPreview(restored); setRestorePassword(''); }
    } catch (err) { if (ticket === generation.current) setError(err.message); }
    finally { if (ticket === generation.current) setBusy(''); }
  }
  function restore() {
    if (!preview || !previewBase.current || !replace || busy || demo) return;
    try {
      const restored = validateBackupData(preview, { importing: true });
      const saved = replaceJournal(restored, previewBase.current.value);
      if (saved !== true) { setError('기기에 저장하지 못했어요. 기존 기록은 유지돼요. 다른 창의 변경 여부와 저장 공간을 확인하고 파일 미리보기를 다시 진행해 주세요.'); return; }
      resetPreview(); setFile(null); setRestorePassword('');
      if (fileInput.current) fileInput.current.value = '';
      notify('백업 기록으로 교체했어요. 알림은 이 기기에서 다시 켜 주세요.');
    } catch (err) { setError(err.message); }
  }
  return <section className="panel backup-settings" aria-labelledby="backup-title">
    <div className="panel-head"><div><h2 id="backup-title">기록 백업</h2><p className="muted">이 기기에 저장하고, 필요할 때 파일로 옮겨요.</p></div><Download size={22} aria-hidden="true" /></div>
    <p>기록은 기기마다 따로 저장돼요. 기기를 바꾸거나 {isAndroidPackage()?'앱을 삭제하기':'브라우저 데이터를 지우기'} 전에 암호화 백업을 보관해 주세요. 백업과 복원은 기기 안에서 처리하며 개인 기록을 서버로 보내지 않아요.</p>
    {demo && <p role="status">체험 기록은 백업하거나 실제 기록으로 복원할 수 없어요. 체험을 마친 뒤 이용해 주세요.</p>}
    {storageError && <p role="alert">현재 기기 기록을 읽지 못했어요. 검증된 백업 파일로 복원할 수 있어요. 현재 기록과의 차이는 확인할 수 없어요.</p>}
    {!demo && marker && <p role="status">{marker.status === 'saved' ? '마지막 기기 저장' : '마지막 다운로드 요청 (실제 저장 여부 확인 필요)'}: {new Date(marker.at).toLocaleString('ko-KR')}{changed && <> · 이후 바뀐 기록·설정 {changed.total}건 (추가 {changed.added} · 수정 {changed.changed} · 삭제 {changed.removed})</>}</p>}
    {!demo && !marker && <p className="muted">아직 백업 이력이 없어요. 변경 수에는 복약 시간·약 이력·복용 체크·하루 기록·일정·검사·기록 설정을 포함해요.</p>}
    <fieldset className="backup-controls" disabled={demo || Boolean(busy)}>
      <form className="form-stack backup-form" onSubmit={exportFile}>
        <h3>암호화 파일로 저장</h3><p className="muted">비밀번호를 잊으면 파일을 복원할 수 없어요. 파일과 비밀번호는 따로 보관해 주세요.</p>
        <label className="field">백업 비밀번호<input type="password" autoComplete="new-password" minLength={8} maxLength={1024} required value={password} onChange={event => setPassword(event.target.value)} /><small>8자 이상 입력해 주세요. 기기에 저장하지 않아요.</small></label>
        <label className="field">비밀번호 확인<input type="password" autoComplete="new-password" minLength={8} maxLength={1024} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        <div className="form-actions"><button className="btn primary" type="submit" disabled={Boolean(storageError)}><Download size={18} aria-hidden="true" />{busy === 'export' ? '암호화·파일 저장 중…' : '백업 파일 저장'}</button></div>
      </form>
      <form className="form-stack backup-form" onSubmit={previewFile}>
        <h3>백업 파일 불러오기</h3><p className="muted">먼저 내용을 확인한 뒤 교체해요. 현재 기록과 합쳐지지 않으니, 현재 기록도 먼저 백업해 두세요.</p>
        <label className="field">온결 백업 파일 (최대 8MB)<input ref={fileInput} type="file" accept=".json,application/json" required onChange={event => { resetPreview(); setFile(event.target.files?.[0] || null); setRestorePassword(''); }} /></label>
        <label className="field">파일의 비밀번호<input type="password" autoComplete="off" minLength={8} maxLength={1024} required value={restorePassword} onChange={event => { resetPreview(); setRestorePassword(event.target.value); }} /></label>
        <div className="form-actions"><button className="btn" type="submit" disabled={!file}>{busy === 'restore' ? '파일을 확인하는 중…' : '파일 검증 및 복원 미리보기'}</button></div>
      </form>
    </fieldset>
    {error && <p className="backup-error" role="alert">{error}</p>}
    {preview && <section className="backup-preview" aria-labelledby="backup-preview-title" aria-live="polite"><h3 id="backup-preview-title">교체할 기록 확인</h3><Counts data={preview} /><p role="status">파일의 암호화와 기록 형식을 확인했어요. 현재 기록은 아직 바뀌지 않았어요.</p>{difference && <p>현재 기록 → 복원본: 추가 {difference.added}건 · 수정 {difference.changed}건 · 삭제 {difference.removed}건. 알림은 끄며, 기록 설정도 파일로 교체해요.</p>}<p>복원하면 현재 기기의 모든 기록이 파일의 기록으로 교체돼요. 알림은 꺼진 상태로 시작해요.</p><label className="backup-consent"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} />현재 기록을 백업 파일의 기록으로 교체하는 데 동의해요.</label><div className="form-actions"><button className="btn subtle" type="button" disabled={Boolean(busy)} onClick={resetPreview}>취소</button><button className="btn primary" type="button" disabled={!replace || demo || Boolean(busy)} onClick={restore}>현재 기록 교체하기</button></div></section>}
  </section>;
}
