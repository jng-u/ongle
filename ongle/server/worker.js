import assets from 'virtual:ongyeol-assets';
import {referenceResponse} from './reference.js';

// Only public application assets and a fixed laboratory reference ID reach this Worker.
export default {async fetch(request) {
  const {pathname}=new URL(request.url);
  if (pathname==='/api/lab-reference') return referenceResponse(request);
  if (request.method!=='GET' && request.method!=='HEAD') return new Response(null,{status:405,headers:{allow:'GET, HEAD'}});
  const path=pathname==='/'?'/index.html':pathname;
  if (!Object.hasOwn(assets,path)) return new Response('Not found',{status:404});
  const [type,base64,tag]=assets[path];
  const headers=new Headers({'content-type':type,'cache-control':path==='/sw.js'||path==='/index.html'?'no-cache':path.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache',
    'etag':tag,'referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
  if (path==='/sw.js') headers.set('service-worker-allowed','/');
  // Preserve the compressed wire size of the offline Korean catalog on phones.
  const gzip=(request.headers.get('accept-encoding')||'').split(',').some(item=>{
    const [encoding,...params]=item.toLowerCase().trim().split(';');
    return encoding==='gzip' && !params.some(v=>/^\s*q=0(?:\.0*)?\s*$/.test(v));
  });
  headers.set('vary','accept-encoding');
  if(gzip) headers.set('content-encoding','gzip');
  if (request.headers.get('if-none-match')===tag) return new Response(null,{status:304,headers});
  if (request.method==='HEAD') return new Response(null,{headers});
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  if(gzip) return new Response(bytes,{headers,encodeBody:'manual'});
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream,{headers});
}};
