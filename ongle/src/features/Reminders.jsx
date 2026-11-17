import React, { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, CalendarDays, Download, ShieldCheck } from 'lucide-react';
import { useApp } from '../core.jsx';
import { addDays, todayKey } from '../model.js';
import { createNativeAlarmSync, nativeAlarmBridge } from '../data/nativeAlarms.js';
import { saveFile } from '../data/fileSave.js';
import { isAndroidPackage } from '../data/androidReference.js';
import {
  buildReminderCalendar, createReminderDelivery, dueReminders,
  EXPORT_KEY, reminderFingerprint,
} from '../data/alarms.js';

const base = import.meta.env?.BASE_URL || '/';

function notificationSupported() {
  return !isAndroidPackage() && typeof window !== 'undefined' && window.isSecureContext &&
    'Notification' in window && 'serviceWorker' in navigator;
}

async function rootRegistration() {
  const registration = await navigator.serviceWorker.getRegistration(base);
  if (!registration?.active || new URL(registration.scope).pathname !== base ||
      new URL(registration.active.scriptURL).pathname !== base+'sw.js') return null;
  return registration;
}

function localStorageOrNull() {
  try { return window.localStorage; } catch { return null; }
}

/** Mount once under the app provider. Never asks for permission or uses Push. */
export function ReminderEngine() {
  const app = useApp();
  const current = useRef(app);
  current.current = app;
  const delivery = useRef(null);
  useEffect(() => {
    let stopped = false;
    let running = false;
    let warned = false;
    delivery.current ||= createReminderDelivery(localStorageOrNull());
    const allowed = () => !stopped && !current.current.demo && current.current.data.reminders === true &&
      document.visibilityState === 'visible' && notificationSupported() && Notification.permission === 'granted';
    async function tick() {
      if (running || !allowed()) return;
      running = true;
      try {
        const send = async () => {
          if (!allowed()) return;
          const registration = await rootRegistration();
          if (!registration || !allowed()) return;
          await delivery.current(dueReminders(current.current.data), async reminder => {
            // Re-read current checks after asynchronous registration/lock work.
            if (!allowed() || !dueReminders(current.current.data).some(item => item.key === reminder.key)) {
              throw new Error('Reminder no longer due');
            }
            try {
              await registration.showNotification('나를 돌볼 시간', {
                body: '온결에서 오늘의 복약을 확인해 주세요.',
                tag: `ongle:${reminder.key}`, renotify: false,
                data: { url: base+'#today', page: 'today' },
              });
            } catch (error) {
              if (!warned) {
                current.current.notify('기기 알림을 표시하지 못했어요. 브라우저 알림 설정을 확인해 주세요.');
                warned = true;
              }
              throw error;
            }
          }, allowed);
        };
        if (navigator.locks?.request) {
          await navigator.locks.request('ongle-reminder-delivery', { ifAvailable: true }, lock => lock ? send() : undefined);
        } else await send();
      } catch { /* Unsupported/temporarily unavailable service worker: retry next tick. */ }
      finally { running = false; }
    }
    void tick();
    const interval = window.setInterval(tick, 15000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, []);
  const nativeSync = useRef(null);
  useEffect(() => {
    const announce = detail => window.dispatchEvent(new CustomEvent('ongyeol-alarms-state', { detail }));
    const sync = createNativeAlarmSync({
      onStatus: status => announce({ status, error: false }),
      onError: () => announce({ error: true }),
    });
    nativeSync.current = sync;
    const refresh = () => { void sync.refresh(); };
    window.addEventListener('ongyeol-alarms-ready', refresh);
    window.addEventListener('ongyeol-alarms-resume', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 15000);
    void sync.update(current.current);
    return () => {
      sync.stop();
      window.clearInterval(timer);
      window.removeEventListener('ongyeol-alarms-ready', refresh);
      window.removeEventListener('ongyeol-alarms-resume', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  useEffect(() => { void nativeSync.current?.update(app); }, [app.data, app.demo, app.storageError]);
  return null;
}

export function ReminderSettings() {
  const { data, update, notify, demo } = useApp();
  const android = isAndroidPackage();
  const [permission, setPermission] = useState(() => notificationSupported() ? Notification.permission : 'unsupported');
  const [nativeStatus, setNativeStatus] = useState(null);
  const [nativeError, setNativeError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [endDate, setEndDate] = useState(() => addDays(todayKey(), 90));
  const [includeVisits, setIncludeVisits] = useState(false);
  const [includeDetails, setIncludeDetails] = useState(false);
  const [visitMinutes, setVisitMinutes] = useState(30);
  const [exportBusy, setExportBusy] = useState(false);
  const exporting = useRef(false);
  const [exported, setExported] = useState(() => {
    try { return JSON.parse(localStorageOrNull()?.getItem(EXPORT_KEY) || 'null'); } catch { return null; }
  });
  const fingerprint = reminderFingerprint(data);
  const calendarChanged = exported && exported.fingerprint !== fingerprint;
  useEffect(() => {
    const refresh = () => setPermission(notificationSupported() ? Notification.permission : 'unsupported');
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  useEffect(() => {
    if (!android) return;
    let active = true;
    let generation = 0;
    const refresh = async () => {
      const ticket = ++generation;
      try {
        const status = await nativeAlarmBridge()?.status();
        if (active && ticket === generation) setNativeStatus(status || null);
      } catch { if (active && ticket === generation) setNativeError(true); }
    };
    const changed = event => {
      generation += 1;
      if (event.detail.status) setNativeStatus(event.detail.status);
      setNativeError(event.detail.error);
    };
    void refresh();
    window.addEventListener('ongyeol-alarms-state', changed);
    window.addEventListener('ongyeol-alarms-ready', refresh);
    window.addEventListener('ongyeol-alarms-resume', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('ongyeol-alarms-state', changed);
      window.removeEventListener('ongyeol-alarms-ready', refresh);
      window.removeEventListener('ongyeol-alarms-resume', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [android]);

  async function nativePermission(exact = false) {
    if (demo || busy) return;
    const bridge = nativeAlarmBridge();
    if (!bridge) { notify('기기 알림을 준비 중이에요. 잠시 후 다시 시도해 주세요.'); return; }
    setBusy(true);
    try {
      // Invoke permission APIs directly from a user gesture.
      if (exact) await bridge.requestExact();
      else await bridge.requestPermission();
      const status = await bridge.status();
      setNativeStatus(status);
      if (!exact && status.notifications) {
        if (update(draft => { draft.reminders = true; }) === false) return;
      }
      window.dispatchEvent(new Event('ongyeol-alarms-ready'));
      notify(!status.notifications ? 'Android 설정에서 온결 알림을 허용해 주세요.' :
        status.exact ? '기기 알림 설정을 확인했어요.' : '대략적인 시간에 알려드려요. 정확한 시각 알림도 허용할 수 있어요.');
    } catch { setNativeError(true); notify('알림 설정을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }

  async function toggle() {
    if (demo || busy) return;
    if (data.reminders) {
      if (update(draft => { draft.reminders = false; }) === false) return;
      notify(android ? '기기 알림을 껐어요.' : '기기 알림을 껐어요. 가져온 캘린더 알림은 별도로 삭제해 주세요.');
      return;
    }
    if (android) { await nativePermission(); return; }
    if (!notificationSupported()) {
      notify('이 환경에서는 기기 알림을 쓸 수 없어요. 캘린더 알림을 이용해 주세요.');
      return;
    }
    setBusy(true);
    try {
      // Keep the request directly inside the user's click handler (iOS).
      const result = Notification.permission === 'default'
        ? await Notification.requestPermission() : Notification.permission;
      setPermission(result);
      if (result !== 'granted') {
        notify(result === 'denied' ? '알림이 차단되어 있어요. 브라우저의 사이트 설정에서 허용해 주세요.' : '알림을 허용하면 기기 알림을 켤 수 있어요.');
        return;
      }
      if (!await rootRegistration()) {
        notify('기기 알림을 준비 중이에요. 잠시 후 다시 켜 주세요.');
        return;
      }
      if (update(draft => { draft.reminders = true; }) === false) return;
      notify('기기 알림을 켰어요. 앱이 화면에 열려 있을 때 알려드려요.');
    } catch {
      notify('알림을 켜지 못했어요. 브라우저 설정을 확인하거나 캘린더 알림을 이용해 주세요.');
    } finally { setBusy(false); }
  }

  async function download() {
    if (demo || exporting.current) return;
    exporting.current = true; setExportBusy(true);
    try {
      const calendar = buildReminderCalendar(data, { endDate, includeVisits, includeDetails, visitMinutes });
      if (!calendar.eventCount) {
        notify('선택한 기간에 알림을 만들 일정이 없어요. 복약 시간과 등록한 약을 확인해 주세요.');
        return;
      }
      const result = await saveFile({ blob: new Blob([calendar.text], { type: 'text/calendar;charset=utf-8' }), name: `ongle-reminders-${calendar.startDate}.ics` });
      if (result.status === 'cancelled') { notify('캘린더 파일 저장을 취소했어요.'); return; }
      if (result.status === 'failed') { notify('캘린더 파일을 저장하지 못했어요. 다시 시도해 주세요.'); return; }
      const snapshot = { fingerprint, endDate, status: result.status };
      setExported(snapshot);
      try { localStorageOrNull()?.setItem(EXPORT_KEY, JSON.stringify(snapshot)); } catch { /* Optional marker. */ }
      notify(result.status === 'saved' ? '캘린더 파일을 기기에 저장했어요. 가져온 뒤 시간과 알림을 확인해 주세요.' : '캘린더 다운로드를 요청했어요. 실제 파일 저장을 확인한 뒤 캘린더에 가져와 주세요.');
    } catch (error) { notify(error.message || '캘린더 파일을 만들지 못했어요.'); }
    finally { exporting.current = false; setExportBusy(false); }
  }

  return <section className="panel reminder-settings" aria-labelledby="reminder-heading">
    <style>{`
      .reminder-settings .reminder-block { display:grid; gap:12px; padding:20px 0; }
      .reminder-settings .reminder-block + .reminder-block { border-top:1px solid var(--border, #e5e9e4); }
      .reminder-settings .reminder-title { display:flex; align-items:center; gap:8px; margin:0; font-size:1rem; }
      .reminder-settings .reminder-options { display:flex; flex-wrap:wrap; gap:16px; }
      .reminder-settings .reminder-option { display:flex; gap:8px; align-items:center; }
      .reminder-settings p { margin:0; line-height:1.65; }
      .reminder-settings ol { margin:0; padding-left:22px; line-height:1.8; }
      .reminder-settings input[type=checkbox] { width:18px; height:18px; accent-color:var(--primary, #45765c); }
      .reminder-settings .reminder-warning { padding:12px; background:#fff5df; color:#72531d; border-radius:12px; }
      .reminder-settings .reminder-sources { display:flex; flex-wrap:wrap; gap:12px; font-size:.8rem; }
    `}</style>
    <div className="panel-head"><h2 id="reminder-heading">잊지 않도록, 알림</h2><Bell size={20} aria-hidden="true" /></div>
    <div className="reminder-block">
      <h3 className="reminder-title"><Bell size={18} aria-hidden="true" /> 이 기기에서 받기</h3>
      <p className="muted">{android ? '등록한 복약 시간에 아직 체크하지 않은 약이 있으면 알려드려요. 앱을 닫거나 화면을 잠가도 동작하며 기기를 다시 켜면 일정을 복구해요. Android 설정에서 앱을 강제 종료하면 다시 열 때까지 알림이 멈출 수 있어요.' : '등록한 복약 시간에 아직 체크하지 않은 약이 있으면 알려드려요. 앱이 화면에 열려 있을 때만 확인하며, 화면 잠금·절전·앱 종료 중에는 알림을 보장하지 않아요.'}</p>
      <div><button className={`btn ${data.reminders ? 'subtle' : 'primary'}`} onClick={toggle} disabled={busy || !!demo} type="button" aria-pressed={!!data.reminders}>
        {data.reminders ? <BellOff size={16} aria-hidden="true" /> : <Bell size={16} aria-hidden="true" />}
        {busy ? '확인 중…' : data.reminders ? '기기 알림 끄기' : '기기 알림 켜기'}
      </button></div>
      {android && <>
        <p role="status">{!nativeStatus ? '기기 알림 연결을 확인 중이에요.' : !nativeStatus.notifications ? 'Android 알림 권한이 꺼져 있어요.' : !data.reminders ? '기기 알림이 꺼져 있어요.' : !nativeStatus.enabled ? '기기 알림 일정을 적용 중이에요.' : nativeStatus.exact ? '정확한 시각 알림이 허용되어 있어요.' : '대략적인 시간에 알려드려요. 절전 설정에 따라 늦어질 수 있어요.'}</p>
        {!nativeStatus?.notifications && <div><button type="button" className="btn" onClick={() => nativePermission()} disabled={busy || !!demo}>알림 권한 허용하기</button></div>}
        {nativeStatus?.notifications && !nativeStatus.exact && <div><button type="button" className="btn" onClick={() => nativePermission(true)} disabled={busy || !!demo}>정확한 시각 알림 허용하기</button></div>}
        {nativeError && <p className="reminder-warning" role="alert">기기 알림 일정을 반영하지 못했어요. 앱을 다시 열거나 Android 알림 설정을 확인해 주세요. 다시 연결되면 재시도해요.</p>}
        <p className="muted">복약 시간·약·체크·복원 내용은 자동으로 반영돼요. 캘린더 파일을 가져올 필요는 없어요.</p>
      </>}
      {permission === 'denied'  && <p role="status">알림이 차단되어 있어요. 브라우저의 사이트 설정에서 알림을 허용하거나 아래 캘린더 알림을 이용해 주세요.</p>}
      {permission === 'unsupported' && !android && <p role="status">현재 환경에서 기기 알림을 지원하지 않아요. HTTPS로 접속하거나 캘린더 알림을 이용해 주세요.</p>}
      {!android && <p className="muted">iPhone·iPad는 iOS/iPadOS 16.4 이상에서 ‘홈 화면에 추가’한 앱으로 열고 알림을 허용해 주세요. 브라우저·기기 설정에 따라 지원이 달라요.</p>}
      {demo && <p role="status">체험 중에는 기기 알림과 캘린더 내보내기가 꺼져 있어요.</p>}
    </div>
    <div className="reminder-block">
      <h3 className="reminder-title"><CalendarDays size={18} aria-hidden="true" /> {android ? '선택 사항: 캘린더로 내보내기' : '앱을 닫아도 캘린더로'}</h3>
      <p className="muted">오늘부터 선택한 마지막 날까지, 복약 일정과 알림이 담긴 파일을 만들어요. 캘린더 앱에 직접 가져와야 하며, 기기 알림 설정과 별도로 동작해요.</p>
      <label className="field">알림 마지막 날 (이 날짜 포함)
        <input type="date" value={endDate} min={todayKey()} max={addDays(todayKey(), 3660)} onChange={event => setEndDate(event.target.value)} />
      </label>
      <div className="reminder-options">
        <label className="reminder-option"><input type="checkbox" checked={includeVisits} onChange={event => setIncludeVisits(event.target.checked)} />진료·검사도 포함</label>
        <label className="reminder-option"><input type="checkbox" checked={includeDetails} onChange={event => setIncludeDetails(event.target.checked)} />약 이름·일정 제목 표시</label>
      </div>
      {includeVisits && <label className="field">진료·검사 알림
        <select value={visitMinutes} onChange={event => setVisitMinutes(Number(event.target.value))}>
          <option value={0}>예정 시각</option><option value={15}>15분 전</option><option value={30}>30분 전</option><option value={60}>1시간 전</option>
        </select>
      </label>}
      <p className="muted"><ShieldCheck size={16} aria-hidden="true" /> 기본 제목은 ‘나를 돌볼 시간’이에요. 파일 생성과 기기 알림은 기기 안에서 처리해요. 가져온 파일은 선택한 캘린더 계정에 동기화될 수 있어요.</p>
      {calendarChanged && <p className="reminder-warning" role="status">마지막 파일 생성 후 일정이 바뀌었어요. 기존 온결 캘린더를 삭제하고 새 파일을 가져와 주세요.</p>}
      {exported && <p className="muted">{exported.status === 'saved' ? '마지막 기기 저장' : '마지막 다운로드 요청 (저장 확인 필요)'} 파일의 종료일: {exported.endDate}. 파일 생성만으로 가져오기가 완료되지는 않아요.</p>}
      <div><button type="button" className="btn primary" onClick={download} disabled={!!demo || exportBusy}><Download size={16} aria-hidden="true" /> 캘린더 파일 받기 (.ics)</button></div>
      <ol>
        <li>캘린더 앱에서 ‘온결 알림’ 전용 캘린더를 만들고 파일을 가져와 주세요.</li>
        <li>가져온 일정의 시간·반복 종료일·알림을 확인하고, 기기에서 캘린더 알림을 허용해 주세요. 앱에 따라 파일의 알림을 생략할 수 있어요.</li>
        <li>시간은 현재 지역의 현지 시각을 따라요. 시간대가 바뀌면 일정을 확인해 주세요. 시간이 없는 진료·검사는 포함하지 않아요.</li>
        <li>복약·진료 수정이나 중단 후에는 기존 전용 캘린더를 삭제하고 새로 가져와 주세요. 반복 가져오기는 중복될 수 있어요.</li>
      </ol>
      <p className="muted">캘린더는 자동 연동되지 않아 이후 복약 체크도 반영하지 않아요. 알림을 멈추려면 가져온 전용 캘린더를 삭제하거나 알림을 꺼 주세요. 기기 알림도 함께 켜면 두 번 울릴 수 있어요.</p>
      <div className="reminder-sources">
        {!android && <><a href="https://webkit.org/blog/13878/" target="_blank" rel="noreferrer">iPhone 알림 지원 안내</a>
        <a href="https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification" target="_blank" rel="noreferrer">브라우저 알림 안내</a></>}
      </div>
    </div>
  </section>;
}
