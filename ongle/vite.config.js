import {defineConfig} from 'vite';
import {referenceResponse} from './server/reference.js';
export default defineConfig({
  build:{outDir:'dist/client',emptyOutDir:true,reportCompressedSize:false},
  plugins:[{
    name:'ongyeol-reference',
    configureServer(server){
      server.middlewares.use(async (req,res,next)=>{
        const url=new URL(req.url,'http://localhost');
        if (url.pathname !== '/api/lab-reference') return next();
        const ref=await referenceResponse(new Request(url,{method:req.method}));
        res.writeHead(ref.status,Object.fromEntries(ref.headers));res.end(await ref.text());
      });
    }
  }]
});
