import React, {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';
import {blankJournal, demoJournal, todayKey} from './model.js';

import {createJournalStore, JOURNAL_KEY as key, JournalConflict, JournalReadError, JournalWriteError, mergeJournal} from './data/journalStore.js';
import {validateBackupData} from './data/backup.js';
import {saveFile} from './data/fileSave.js';
import {isAndroidPackage} from './data/androidReference.js';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);
const pages = new Set(['today','meds','calendar','diary','labs','visits','settings']);
function pageFromLocation() {
  const route = location.hash.slice(1).split('?')[0];
  return pages.has(route) ? route : 'today';
}
const readJournal = () => createJournalStore(localStorage).read();
const readError = '기기에 저장된 기록을 열지 못했어요. 브라우저의 저장 공간 설정을 확인해 주세요. 기존 파일은 덮어쓰지 않았어요.';
function initial() {
  try { return {data:readJournal(), error:''}; }
  catch { return {data:blankJournal(), error:readError}; }
}
export function AppProvider({children}) {
  const [real, setReal] = useState(initial);
  const [recoveryCopy, setRecoveryCopy] = useState(()=>{try { return createJournalStore(localStorage).recoveryInfo(); } catch { return null; }});
  const [writeError, setWriteError] = useState('');
  const [updateError, setUpdateError] = useState('');
  const [recoveryDelete, setRecoveryDelete] = useState(null);
  const [demo, setDemo] = useState(false);
  const [example, setExample] = useState(null);
  const [date, setDate] = useState(todayKey);
  const [page, setPage] = useState(pageFromLocation);
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef();
  const demoRestoreBases = useRef(new WeakMap());
  const previousToday = useRef(todayKey());
  const notify = useCallback(message => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(()=>setToast(''), 3200);
  }, []);
  const close = useCallback(()=>setDialog(null), []);
  const open = useCallback((name,payload={})=>setDialog({name,payload}), []);
  const go = useCallback(name => {
    if (!pages.has(name)) return;
    if (pageFromLocation() !== name) location.hash = name;
    setPage(name); setDialog(null);
    window.scrollTo({top:0,behavior:'instant'});
  }, []);
  useEffect(()=>{
    const route = ()=>{setPage(pageFromLocation()); setDialog(null); window.scrollTo(0,0);};
    const load = event => {
      if (event.key === `${key}.recovery` || event.key === null) {
        try { setRecoveryCopy(createJournalStore(localStorage).recoveryInfo()); } catch { /* Keep last known recovery status. */ }
      }
      if (event.key === key || event.key === null) {
        try { setReal({data:readJournal(),error:''}); }
        catch { setReal(prev=>({...prev,error:readError})); }
      }
    };
    const rollover = ()=>{
      const now = todayKey();
      if (previousToday.current !== now) {
        const old = previousToday.current; previousToday.current = now;
        setDate(selected=>selected===old?now:selected);
      }
    };
    const timer = setInterval(rollover,30000);
    window.addEventListener('hashchange',route); window.addEventListener('storage',load); window.addEventListener('focus',rollover);
    return ()=>{clearInterval(timer);clearTimeout(toastTimer.current);window.removeEventListener('hashchange',route);window.removeEventListener('storage',load);window.removeEventListener('focus',rollover);};
  }, []);
  const update = useCallback((fn, {base,check} = {})=>{
    setUpdateError(''); setWriteError('');
    try {
      if (demo) {
        const draft = structuredClone(base ?? example);
        if (fn(draft) === false) throw new JournalConflict();
        const merged = base ? mergeJournal(base,draft,example) : draft;
        if (check && check(merged) === false) throw new JournalConflict();
        setExample(validateBackupData(merged));
        return true;
      }
      // Do not run a mutation against an unreadable source.
      try { readJournal(); } catch { setReal(prev=>({...prev,error:readError})); return false; }
      const data = createJournalStore(localStorage).update(fn,base,check);
      setReal({data,error:''}); return true;
    } catch (error) {
      const message = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '변경 내용을 적용하지 못했어요. 입력 내용을 확인해 주세요.';
      setUpdateError(message);
      if (error instanceof JournalReadError && !demo) setReal(prev=>({...prev,error:readError}));
      if (error instanceof JournalWriteError) setWriteError(message);
      notify(message);
      return false;
    }
  },[demo,example,notify]);
  const captureRestoreBase = useCallback(()=>{
    if (!demo) return createJournalStore(localStorage).captureRestoreBase();
    const token = Object.freeze({});
    demoRestoreBases.current.set(token,example);
    return token;
  },[demo,example]);
  const replaceJournal = useCallback((candidate,base)=>{
    setWriteError(''); setUpdateError('');
    try {
      if (demo) {
        if (base !== undefined && demoRestoreBases.current.get(base) !== example) throw new JournalConflict();
        setExample(validateBackupData(candidate,{importing:true}));
      }
      else {
        const store = createJournalStore(localStorage);
        try { setReal({data:store.replace(candidate,base),error:''}); }
        finally { try { setRecoveryCopy(store.recoveryInfo()); } catch { /* Preserve known recovery status. */ } }
      }
      return true;
    } catch (error) {
      const message = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '복원하지 못했어요. 백업 내용과 기존 원본을 보관할 저장 공간을 확인해 주세요. 기존 기록은 유지돼요.';
      setUpdateError(message);
      if (error instanceof JournalWriteError) setWriteError(message);
      notify(message);
      return false;
    }
  },[demo,example,notify]);
  const readRecoveryCopy = useCallback(()=>createJournalStore(localStorage).readRecoveryCopy(),[]);
  const saveRecoveryCopy = async () => {
    try {
      if (isAndroidPackage()) { notify('Android에서는 암호화되지 않은 손상 원본을 내보낼 수 없어요. 복구 사본은 기기에 보관돼요.'); return; }
      const raw = readRecoveryCopy();
      if (raw === null) { notify('보관된 손상 원본이 없어요.'); return; }
      const result = await saveFile({blob:new Blob([raw],{type:'text/plain;charset=utf-8'}),name:'ongle-damaged-original.txt'});
      notify(result.status === 'saved' ? '손상 원본 파일을 저장했어요.' : result.status === 'requested' ? '손상 원본 다운로드를 요청했어요. 파일 저장을 확인해 주세요.' : result.status === 'cancelled' ? '원본 파일 저장을 취소했어요.' : '원본 파일을 저장하지 못했어요. 다시 시도해 주세요.');
    } catch { notify('손상 원본을 읽지 못했어요. 기기의 저장 공간 설정을 확인해 주세요.'); }
  };
  const deleteRecoveryCopy = () => {
    try {
      createJournalStore(localStorage).deleteRecoveryCopy(recoveryDelete);
      setRecoveryCopy(null); setRecoveryDelete(null); notify('손상 원본 복구 사본을 삭제했어요.');
    } catch { setRecoveryDelete(null); notify('복구 사본을 삭제하지 못했어요. 원본이 변경되었거나 저장 공간에 접근할 수 없어요.'); }
  };
  function changeMode() {
    if (!demo) setExample(demoJournal());
    setDemo(!demo); setDate(todayKey()); go('today');setToast('');
  }
  return <AppContext.Provider value={{data:demo?example:real.data,update,replaceJournal,captureRestoreBase,recoveryCopy,readRecoveryCopy,writeError,updateError,date,setDate,page,go,open,close,dialog,notify,demo,changeMode,storageError:real.error}}>
    {children}{!demo && recoveryCopy && <aside className="panel" role="status"><p>손상된 기록 원본을 복구 사본 하나로 기기에 보관하고 있어요. 이 파일에는 암호화되지 않은 건강 기록이 포함될 수 있어요.</p>{isAndroidPackage() ? <p>Android에서는 원본 파일 내보내기를 지원하지 않아요. 복구 사본은 기기에 보관돼요.</p> : <button className="btn subtle small" type="button" onClick={saveRecoveryCopy}>손상 원본 파일 저장</button>}{recoveryDelete !== null ? <div><p>손상 원본 복구 사본을 삭제할까요? 이 사본은 되돌릴 수 없어요. 현재 수첩 기록은 유지돼요.</p><button className="btn subtle small" type="button" onClick={deleteRecoveryCopy}>복구 사본 삭제 확인</button><button className="btn subtle small" type="button" onClick={()=>setRecoveryDelete(null)}>취소</button></div> : <button className="btn subtle small" type="button" onClick={()=>{try { setRecoveryDelete(readRecoveryCopy()); } catch { notify('복구 사본을 읽지 못했어요.'); }}}>복구 사본 삭제</button>}</aside>}{toast && <div role="status" className="toast">{toast}</div>}
  </AppContext.Provider>
}
