import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(tmpdir(),'thais-netlify-bundle-'));
try {
 for(const name of ['api','notifications']) {
  const outfile=path.join(dir,name+'.mjs');
  await build({entryPoints:[`netlify/functions/${name}.mjs`],outfile,bundle:true,platform:'node',target:'node22',format:'esm'});
  const code=await readFile(outfile,'utf8');assert.ok(!code.includes('node:sqlite'),'Funções não podem carregar SQLite local');
  const module=await import(pathToFileURL(outfile));assert.equal(typeof module.default,'function');
  if(name==='api') {
   const date=new Date();date.setUTCDate(date.getUTCDate()+7);const query=date.toISOString().slice(0,10);
   const response=await module.default(new Request('https://salon.example/api/horarios?date='+query),{ip:'127.0.0.1'});
   assert.equal(response.status,200);assert.ok((await response.json()).slots.length>0);
  } else assert.equal(module.config.schedule,'* * * * *');
 }
 console.log('Bundles Netlify executáveis, sem SQLite e com API de horários verificada. Nenhum deploy foi realizado.');
} finally {await rm(dir,{recursive:true,force:true});}
