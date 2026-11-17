import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {open} from 'node:fs/promises';
import app from '../dist/server/index.js';
const port=Number(process.env.PORT||4173), host=process.env.HOST||'127.0.0.1';
const server=createServer(async(req,res)=>{
  try{
    // Expose only the verified release artifact, never arbitrary workspace files.
    if (new URL(req.url,'http://localhost').pathname === '/android.apk' && ['GET','HEAD'].includes(req.method)) {
      const apk=await open(new URL('../../releases/ongyeol-android.apk',import.meta.url),'r').catch(()=>null);
      if (!apk) {res.writeHead(404);res.end();return;}
      const {size}=await apk.stat();
      res.writeHead(200,{'content-type':'application/vnd.android.package-archive','content-disposition':'attachment; filename="ongyeol-android.apk"','content-length':size,'cache-control':'no-store','x-content-type-options':'nosniff'});
      if(req.method==='HEAD'){await apk.close();res.end();}else{const file=apk.createReadStream();res.on('close',()=>file.destroy());file.on('error',()=>res.destroy()).pipe(res);}
      return;
    }
    const request=new Request(new URL(req.url,'http://localhost'),{method:req.method,headers:req.headers});
    const response=await app.fetch(request);res.writeHead(response.status,Object.fromEntries(response.headers));
    if(response.body)Readable.fromWeb(response.body).on('error',()=>res.destroy()).pipe(res);else res.end();
  }catch{res.writeHead(500);res.end('Internal server error');}
});
server.listen(port,host,()=>console.log('온결: http://'+host+':'+port));
