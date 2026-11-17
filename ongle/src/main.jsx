import {isAndroidPackage} from './data/androidReference.js';
import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Activity, ArrowLeft, ArrowRight, Bell, BookHeart, BookOpen, BookOpenCheck, CalendarDays, CalendarPlus, CheckCheck, ChevronRight, ClipboardList, Ellipsis, FlaskConical, FolderHeart, House, LayoutDashboard, LockKeyhole, MonitorSmartphone, NotebookPen, Pill, Plus, Settings2, ShieldCheck, Sprout, Stethoscope, X} from 'lucide-react';
import {AppProvider,useApp} from './core.jsx';
import {Modal,PageHead} from './ui.jsx';
import {todayKey} from './model.js';
import {Today} from './features/Today.jsx';
import {MedicineDialog,Medicines} from './features/Medicines.jsx';
import {Calendar,Diary,Visits,RecordDialog} from './features/Records.jsx';
import {LabDialog,Labs} from './features/Labs.jsx';
import {ReminderEngine,ReminderSettings} from './features/Reminders.jsx';
import {BackupSettings} from './features/Backup.jsx';
import {SummaryDialog} from './features/Summary.jsx';
import './theme.css';

const base = import.meta.env.BASE_URL;

const nav = [
  ['today','오늘','오늘',House],['meds','복약 관리','복약',Pill],['calendar','기록 캘린더','캘린더',CalendarDays],
  ['diary','증상 일기','일기',BookOpen],['visits','진료·검사 이력','진료·검사',Stethoscope],['labs','검사 수치','검사 수치',Activity],['settings','설정·백업','설정',Settings2]
];
function Brand() {
  const {go}=useApp();
  return <button className="brand" aria-label="온결 홈" onClick={()=>go('today')}><img src={base+'mark.svg'} alt="" width="40" height="40"/><span>온결</span></button>;
}
function SideNav() {
  const {page,go,open,demo}=useApp();
  const link=([key,label,,Icon])=><button key={key} className={'nav-link '+(page===key?'active':'')} onClick={()=>go(key)} aria-current={page===key?'page':undefined}><Icon size={19}/><span>{label}</span>{page===key&&<i/>}</button>;
  return <aside className="side-rail"><div className="brand-block"><Brand/><span>나의 건강 수첩</span></div>
    <nav aria-label="주 메뉴"><span className="nav-group">건강 기록</span>{nav.slice(0,6).map(link)}<div className="nav-rule"/>{nav.slice(6).map(link)}</nav>
    <div className="rail-bottom"><button className="sample-button" onClick={()=>open('example')}><span className="sample-icon"><BookOpenCheck size={19}/></span><span><b>{demo?'내 수첩으로 돌아가기':'예시 수첩 둘러보기'}</b><small>{demo?'체험 종료':'기능을 미리 확인해요'}</small></span><ChevronRight size={15}/></button><div className="private-note"><LockKeyhole size={13}/>{isAndroidPackage()?'이 앱에 보관되는 수첩':'이 브라우저에 보관되는 수첩'}</div></div>
  </aside>;
}
function TopBar() {
  const {page,open,go}=useApp(), current=nav.find(n=>n[0]===page);
  return <header className="top-bar"><div className="top-brand"><Brand/></div><div className="breadcrumb"><FolderHeart size={16}/><span>나의 수첩</span><ChevronRight size={12}/><strong>{current[1]}</strong></div>
    <div className="header-actions"><button type="button" className="icon-btn top-bell" onClick={()=>{go('settings');requestAnimationFrame(()=>document.getElementById('reminder-settings')?.scrollIntoView({block:'start'}));}} aria-label="알림 설정"><Bell size={19}/></button><button className="btn primary quick" onClick={()=>open('quick')}><Plus size={16} strokeWidth={2.3}/>기록 추가</button></div>
  </header>
}
function MobileNav() {
  const {page,go,open}=useApp();
  return <nav className="bottom-nav" aria-label="모바일 메뉴">{nav.slice(0,4).map(([key,,label,Icon])=><button key={key} className={page===key?'active':''} aria-current={page===key?'page':undefined} onClick={()=>go(key)}><span><Icon size={20}/></span>{label}</button>)}<button className={!['today','meds','calendar','diary'].includes(page)?'active':''} onClick={()=>open('more')}><span><Ellipsis size={20}/></span>더보기</button></nav>;
}
const quickItems = [
  ['med','약 등록','먹을 약과 시간대를 정해요',Pill],['entry','증상 일기','몸 상태와 하루 메모를 남겨요',NotebookPen],
  ['visit','병원 방문','진료 일정과 상담 내용을 적어요',Stethoscope],['exam','검사 일정·이력','내시경 등 받은 검사를 기록해요',CalendarPlus],['lab','검사 수치','수치와 단위, 참고범위를 적어요',FlaskConical]
];
function Dialogs() {
  const {dialog,close,go,open,date,demo,changeMode}=useApp();
  if(!dialog) return null;
  const {name,payload}=dialog;
  if(name==='med'||name==='slots') return <MedicineDialog name={name} payload={payload}/>;
  if(name==='visit'||name==='entry') return <RecordDialog name={name} payload={payload}/>;
  if(name==='lab')return <LabDialog name={name} payload={payload}/>;
  if(name==='summary')return <SummaryDialog/>;
  if(name==='example')return <Modal title={demo?'내 수첩으로 돌아가기':'예시 수첩 둘러보기'} onClose={close}><p className="dialog-intro">{demo?'체험 중 바꾼 내용은 사라지고, 기기에 저장한 내 기록이 다시 열려요.':'가상의 기록이 담긴 수첩에서 복약 체크와 검사 그래프를 살펴보세요. 예시 수첩에서 바꾼 내용은 내 기록에 저장되지 않아요.'}</p><div className="form-actions"><button className="btn subtle" onClick={close}>닫기</button><button className="btn primary" onClick={changeMode}>{demo?'내 수첩 열기':'예시 수첩 열기'}<ArrowRight size={16}/></button></div></Modal>;
  if(name==='quick')return <Modal title="무엇을 기록할까요?" subtitle="기록할 항목을 선택하세요." onClose={close}><div className="menu-choices">{quickItems.map(([key,title,desc,Icon])=><button key={key} onClick={()=>{const day=key==='entry'&&date>todayKey()?todayKey():date;open(key==='exam'?'visit':key,{date:day,...(key==='exam'?{type:'exam'}:{})});}}><span className="choice-icon"><Icon size={20}/></span><span><strong>{title}</strong><small>{desc}</small></span><ChevronRight size={16}/></button>)}</div></Modal>;
  if(name==='more')return <Modal title="수첩 메뉴" onClose={close}><div className="menu-choices">{nav.slice(4).map(([key,label,,Icon])=><button key={key} onClick={()=>go(key)}><span className="choice-icon"><Icon size={20}/></span><strong>{label}</strong><ChevronRight size={16}/></button>)}<button onClick={()=>open('summary')}><span className="choice-icon"><ClipboardList size={20}/></span><strong>진료용 요약</strong><ChevronRight size={16}/></button><button onClick={()=>open('example')}><span className="choice-icon"><BookOpenCheck size={20}/></span><strong>{demo?'내 수첩으로 돌아가기':'예시 수첩 둘러보기'}</strong><ChevronRight size={16}/></button></div></Modal>;
  return null;
}
function AndroidDownload() {
  const [available,setAvailable]=useState(false);
  useEffect(()=>{
    if(location.hostname==='appassets.androidplatform.net') return;
    const controller=new AbortController();
    fetch(base+'android.apk',{method:'HEAD',cache:'no-store',signal:controller.signal})
      .then(response=>setAvailable(response.ok && response.headers.get('content-type')==='application/vnd.android.package-archive'))
      .catch(()=>{});
    return ()=>controller.abort();
  },[]);
  if(!available) return null;
  return <section className="panel settings-summary"><div><h2>안드로이드 앱</h2><p>휴대폰에 온결을 설치해 오프라인에서도 기록하세요. 기존 웹 기록은 백업으로 옮길 수 있어요.</p></div><a className="btn primary" href={base+'android.apk'} download="ongyeol-android.apk">APK 내려받기</a></section>;
}
function Settings() {
  const {open,demo}=useApp();
  return <><PageHead title="설정·백업" description="복약 알림과 기기에 저장된 기록을 관리해요."/><div className="settings-stack">
    <div className="privacy-bar"><ShieldCheck size={22}/><div><strong>{demo?'예시 수첩을 보고 있어요':isAndroidPackage()?'내 기록은 이 앱에 저장돼요':'내 기록은 이 브라우저에 저장돼요'}</strong><p>기기를 바꾸거나 {isAndroidPackage()?'앱을 삭제하기':'사이트 데이터를 지우기'} 전에는 백업 파일을 만들어 주세요.</p></div></div>
    <section className="panel settings-summary"><div><h2>진료용 요약</h2><p>원하는 기간의 복약, 증상과 검사 결과를 모아 보고 인쇄해요.</p></div><button className="btn subtle" onClick={()=>open('summary')}><ClipboardList size={16}/>요약 보기</button></section>
    <AndroidDownload/><div id="reminder-settings"><ReminderSettings/></div><BackupSettings/>
  </div></>;
}
const surfaces={today:Today,meds:Medicines,calendar:Calendar,diary:Diary,visits:Visits,labs:Labs,settings:Settings};
function App() {
  const {page,demo,changeMode,dialog,storageError}=useApp(), Page=surfaces[page]||Today;
  useEffect(()=>{ document.title=(nav.find(item=>item[0]===page)?.[1]||'오늘')+' · 온결 건강 수첩'; },[page]);
  return <><a href="#main-area" className="skip" onClick={e=>{e.preventDefault();document.querySelector('main')?.focus();}}>본문 바로가기</a><SideNav/><div className="app-column"><TopBar/><main id="main-area" tabIndex="-1"><div className="main-inner">
    {demo&&<div className="demo-strip"><span><BookOpenCheck size={16}/><strong>예시 수첩</strong> <span>가상의 기록이에요.</span></span><button onClick={changeMode}>내 수첩으로 <ArrowRight size={14}/></button></div>}
    {storageError&&!demo&&<p className="storage-error" role="alert">{storageError}</p>}
    <Page key={page}/></div></main></div><MobileNav/><Dialogs key={dialog?.name||'none'}/><ReminderEngine/></>
}
createRoot(document.getElementById('root')).render(<AppProvider><App/></AppProvider>);
if (location.hostname !== 'appassets.androidplatform.net' && 'serviceWorker' in navigator && window.isSecureContext) window.addEventListener('load',()=>{
  navigator.serviceWorker.register(base+'sw.js',{scope:base,updateViaCache:'none'}).catch(()=>{});
});
