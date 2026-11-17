import {getOnlineLabReference, onlineLabIds} from '../src/data/onlineLab.js';
const json=(obj,status)=>Response.json(obj,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
export async function referenceResponse(request,lookup=getOnlineLabReference) {
  if (request.method !== 'GET') return json({error:'GET 요청만 가능해요.'},405);
  const url=new URL(request.url), id=url.searchParams.get('id');
  if (url.pathname!=='/api/lab-reference'||!onlineLabIds.includes(id)||[...url.searchParams].length!==1) return json({error:'지원하지 않는 참고범위예요.'},400);
  try { return json(await lookup(id),200); }
  catch { return json({error:'기관 원문에서 현재 참고범위를 확인할 수 없어요. 결과지 또는 저장된 출처를 확인해 주세요.'},503); }
}
