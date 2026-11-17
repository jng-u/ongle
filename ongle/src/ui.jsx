import React, {useEffect, useId, useRef} from 'react';
import {X, Notebook} from 'lucide-react';
export function PageHead({title,description,action}) {
  return <header className="page-head"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</header>
}
export function Empty({icon:Icon=Notebook,title,text,action}) {
  return <div className="empty"><span className="empty-icon"><Icon size={23} aria-hidden="true"/></span><strong>{title}</strong>{text && <p>{text}</p>}{action}</div>
}
export function Modal({title,subtitle,onClose,children}) {
  const ref = useRef(null), id = useId(), onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(()=>{
    const dialog = ref.current, prior = document.activeElement;
    if (!dialog.open) dialog.showModal();
    const previous = document.body.style.overflow; document.body.style.overflow='hidden';
    const cancel = event=>{event.preventDefault();onCloseRef.current?.();};
    dialog.addEventListener('cancel',cancel);
    return ()=>{
      dialog.removeEventListener('cancel',cancel); dialog.close();
      document.body.style.overflow=previous;
      if (prior?.isConnected) prior.focus({preventScroll:true});
    };
  },[]);
  return <dialog ref={ref} aria-labelledby={id} className="modal-shell" onClick={e=>{
    if (e.target !== ref.current) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (e.clientX<box.left || e.clientX>box.right || e.clientY<box.top || e.clientY>box.bottom) onClose();
  }}><div className="modal-head"><div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}><X size={20}/></button></div><div className="modal-content">{children}</div></dialog>
}
export const conditionNames = ['매우 나쁨','나쁨','보통','좋음','매우 좋음'];
export function MoodFace({value=3,size=36}) {
  const fill = ['#eac0b2','#eed1af','#ecdbaa','#c5d8b9','#adcfb8'][value-1], ink = ['#79493d','#755036','#695b35','#486445','#315c49'][value-1];
  const mouth = ['M11.5 24q4.5-6 9 0','M12.5 22.7q3.5-3.4 7 0','M12 22h8','M11.7 20.8q4.3 5.2 8.6 0','M11 20q5 7.8 10 0'][value-1];
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <circle cx="16" cy="16" r="14.6" fill={fill}/><g stroke={ink} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {value===5?<><path d="M8.8 14.8q1.9-3 3.6 0M19.6 14.8q1.8-3 3.6 0"/></>:<><path d="M10.6 14.2v1.3M21.4 14.2v1.3"/>{value===1&&<path d="m8.5 10.8 3.2 1.4m8.6 0 3.2-1.4"/>}</>}
    <path d={mouth}/></g></svg>;
}
