import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseStore } from '../cloud/store.mjs';
import { createCloudHandler } from '../cloud/api.mjs';
const key='sb_secret_exclusivo-dos-testes-sem-valor-real';
const url='https://example-project.supabase.co';

test('aceita URL de projeto ou Data API copiada do Supabase e remove espaços sem alterar a segurança do destino',()=>{
 for(const value of [url,url+'/',url+'/rest/v1/',url+'/rest/v1','  '+url+' \n']){
  const store=new SupabaseStore({env:{SUPABASE_URL:value,SUPABASE_SECRET_KEY:' '+key+'\n'}});
  assert.equal(store.configured,true,value);assert.equal(store.url,url);assert.equal(store.key,key);
 }
 for(const value of ['http://example-project.supabase.co',url+'/rest/v2/',url+'?x=1','https://user:password@example-project.supabase.co',url+':8443','https://example-project.supabase.co.evil.example']){
  assert.equal(new SupabaseStore({env:{SUPABASE_URL:value,SUPABASE_SECRET_KEY:key}}).configured,false,value);
 }
});
test('diagnóstico diferencia variáveis ausentes e formatos incorretos sem fazer chamada externa nem revelar valores',async()=>{
 for(const [env,expected] of [
  [{},{supabaseUrl:'missing',supabaseKey:'missing'}],
  [{SUPABASE_URL:url},{supabaseUrl:'ok',supabaseKey:'missing'}],
  [{SUPABASE_URL:'valor errado',SUPABASE_SECRET_KEY:key},{supabaseUrl:'invalid',supabaseKey:'ok'}],
  [{SUPABASE_URL:url,SUPABASE_SECRET_KEY:'sb_publishable_public_test'},{supabaseUrl:'ok',supabaseKey:'invalid'}],
 ]){
  let calls=0;const store=new SupabaseStore({env,fetchImpl:async()=>{calls++;throw new Error('Não deve conectar');}});
  const response=await createCloudHandler({env,store})(new Request('https://example.test/api/health'));
  assert.equal(response.status,503);const data=await response.json();assert.deepEqual(data.configuration,expected);assert.equal(calls,0);
  const text=JSON.stringify(data);assert.equal(text.includes(key),false);assert.equal(text.includes('sb_publishable_public_test'),false);assert.equal(text.includes(url),false);
 }
});
test('chave legada continua aceita e saúde depende do esquema remoto, não apenas do formato',async()=>{
 const store=new SupabaseStore({env:{SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:'  eyJfake-test-only  '},fetchImpl:async()=>new Response(JSON.stringify({status:'ok',tableAvailable:true,schemaVersion:4}))});
 assert.equal(store.configured,true);
 const response=await createCloudHandler({env:{},store})(new Request('https://example.test/api/health'));
 assert.equal(response.status,200);assert.equal((await response.json()).status,'ok');
 const badSchema=new SupabaseStore({env:{SUPABASE_URL:url,SUPABASE_SECRET_KEY:key},fetchImpl:async()=>new Response(JSON.stringify({status:'ok',tableAvailable:false}))});
 const bad=await createCloudHandler({env:{},store:badSchema})(new Request('https://example.test/api/health'));assert.equal(bad.status,503);
});

test('saúde exige migração da agenda: esquema antigo não sinaliza instalação completa',async()=>{
 const store=new SupabaseStore({env:{SUPABASE_URL:url,SUPABASE_SECRET_KEY:key},fetchImpl:async()=>new Response(JSON.stringify({status:'ok',tableAvailable:true,schemaVersion:2}))});
 const response=await createCloudHandler({env:{},store})(new Request('https://example.test/api/health'));
 assert.equal(response.status,503);assert.match((await response.json()).message,/004-reservar-pedido-pendente/);
});
