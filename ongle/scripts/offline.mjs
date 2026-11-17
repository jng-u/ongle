import {readdir,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {extname} from 'node:path';
import {build} from 'vite';
const dir='dist/client';
const publicBase=process.argv.find(arg=>arg.startsWith('--base='))?.slice(7)||'/';
if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(publicBase)) throw new Error('Expected an absolute base path ending in /');
async function walk(base='') {
  const files=[];
  for (const e of await readdir(dir+base,{withFileTypes:true})) {
    const p=base+'/'+e.name;if(e.isDirectory())files.push(...await walk(p));else files.push(p);
  }
  return files.sort();
}
const paths=await walk();
const digest=data=>createHash('sha256').update(data).digest('hex').slice(0,18);
const revision=digest(Buffer.concat(await Promise.all(paths.map(p=>readFile(dir+p)))));
const base=await readFile('public/sw.js','utf8');
const sw=base.replace('const shell = null;', 'const shell = '+JSON.stringify({
  current:'ongyeol-shell-'+revision, base:publicBase, files:paths.filter(p=>p!=='/sw.js').map(p=>publicBase+p.slice(1))
})+';');
await writeFile(dir+'/sw.js',sw);
if (process.argv.includes('--static')) {
  console.log('Static offline shell '+revision+' · base '+publicBase+' · '+paths.length+' public assets');
  process.exit(0);
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.png':'image/png','.woff2':'font/woff2','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const map={};
for(const p of paths){const bytes=await readFile(dir+p);map[p]=[mime[extname(p)]||'application/octet-stream',gzipSync(bytes,{level:9}).toString('base64'),'"'+digest(bytes)+'"'];}
await build({configFile:false,publicDir:false,plugins:[{name:'ongyeol-assets',resolveId(id){if(id==='virtual:ongyeol-assets') return '\0ongyeol-assets';},load(id){if(id==='\0ongyeol-assets')return 'export default '+JSON.stringify(map);}}],build:{
  ssr:'server/worker.js',target:'es2022',outDir:'dist/server',emptyOutDir:true,reportCompressedSize:false,rollupOptions:{output:{entryFileNames:'index.js',format:'es'}}
}});
const hosting=await readFile('.openai/hosting.json').catch(error=>{
  if (error.code!=='ENOENT') throw error;
  return null;
});
if (hosting) {
  await mkdir('dist/.openai',{recursive:true});
  await writeFile('dist/.openai/hosting.json',hosting);
}
console.log('Offline shell '+revision+' · '+paths.length+' public assets');
