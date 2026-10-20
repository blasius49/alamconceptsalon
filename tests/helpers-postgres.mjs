import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { SupabaseStore } from '../cloud/store.mjs';
export async function postgresFixture({ schemaText } = {}) {
 const db=new PGlite();
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
 const schema=schemaText || await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');
 await db.exec(schema);
 const env={SUPABASE_URL:'https://unit-test-project.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_not-a-real-credential',ADMIN_PASSWORD:'Senha exclusiva de teste 2026!',WHATSAPP_ENABLED:'false'};
 const calls=[];
 const fetchImpl=async(url,options)=>{
  const name=new URL(url).pathname.split('/').at(-1);const args=JSON.parse(options.body);calls.push({name,args,headers:options.headers});
  if(!/^salon_[a-z_]+$/.test(name))throw new Error('Invalid test RPC');
  const names=Object.keys(args);const params=names.map((key,i)=>`${key} => $${i+1}`).join(',');
  try {
   const values=Object.values(args).map(value=>value&&typeof value==='object'?JSON.stringify(value):value);
   const result=await db.query(`SELECT public.${name}(${params}) AS result`,values);
   return new Response(JSON.stringify(result.rows[0].result),{status:200});
  } catch(error){return new Response(JSON.stringify({code:error.code}),{status:400});}
 };
 const store=new SupabaseStore({env,fetchImpl});
 return {db,env,store,calls,fetchImpl,schema,close:()=>db.close()};
}
