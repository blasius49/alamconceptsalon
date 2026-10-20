import { mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const target=path.join(root,'netlify-package');
const files=['netlify.toml','package.json','package-lock.json','.gitignore','.env.example','README.md','DEPLOY-NETLIFY.md','ATUALIZAR-SITUACAO.md','ATUALIZAR-AGENDA.md','CORRIGIR-RESERVA.md','index.html','style.css','script.js','admin.html','admin.css','admin.js','server.mjs','build.mjs'];
const dirs=['cloud','netlify','supabase','lib','scripts','tests','demo','public'];
async function copy(source,relative){
 const info=await stat(source);
 if(info.isDirectory()){await mkdir(path.join(target,relative),{recursive:true});for(const entry of await readdir(source))await copy(path.join(source,entry),path.join(relative,entry));}
 else {await mkdir(path.dirname(path.join(target,relative)),{recursive:true});await copyFile(source,path.join(target,relative));}
}
await mkdir(target,{recursive:true});
for(const file of files)await copy(path.join(root,file),file);
for(const dir of dirs)await copy(path.join(root,dir),dir);
console.log('Pacote fonte Netlify preparado em netlify-package/. Importe pelo Git; upload estático sozinho não inclui Functions.');
