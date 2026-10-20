import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const target=path.join(root,'public');
await mkdir(target,{recursive:true});
// Somente esta lista é publicada. Nenhum backend, segredo ou dado de cliente entra aqui.
for(const file of ['index.html','style.css','script.js','admin.html','admin.css','admin.js'])await copyFile(path.join(root,file),path.join(target,file));
await writeFile(path.join(target,'404.html'),'<!doctype html><html lang="pt-BR"><meta charset="UTF-8"><title>Página não encontrada</title><body><h1>Página não encontrada</h1><a href="/">Voltar ao site</a></body></html>');
console.log('Frontend Netlify gerado em public/. APIs são publicadas a partir de netlify/functions/.');
