// Executa localmente o mesmo handler das Functions, usando o Supabase configurado.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCloudHandler } from '../cloud/api.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=new Map([['/','index.html'],['/admin','admin.html'],['/admin/','admin.html'],...['index.html','style.css','script.js','admin.html','admin.css','admin.js'].map(name=>['/'+name,name])]);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const handler=createCloudHandler();
http.createServer(async(req,res)=>{
 try {
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname.startsWith('/api/')) {
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12000){res.writeHead(413);return res.end();}chunks.push(chunk);}
   const method=req.method;const init={method,headers:req.headers};if(!['GET','HEAD'].includes(method))init.body=Buffer.concat(chunks);
   const result=await handler(new Request(`http://${req.headers.host}${req.url}`,init),{ip:req.socket.remoteAddress});
   res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
  }
  const file=files.get(pathname);if(!file||!['GET','HEAD'].includes(req.method)){res.writeHead(404);return res.end('Página não encontrada');}
  res.writeHead(200,{'Content-Type':types[file.slice(file.lastIndexOf('.'))],'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:await readFile(root+file));
 }catch{res.writeHead(500);res.end('Não foi possível processar a solicitação.');}
}).listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log(`Prévia da API Netlify na porta ${process.env.PORT||3000}; requer Supabase configurado.`));
