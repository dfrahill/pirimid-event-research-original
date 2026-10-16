import {createHash,randomUUID} from 'node:crypto';
import {Client} from 'eve/client';
import {CloudStore} from './cloud-store.mjs';
import {authorized,validPublicUrl} from './access.mjs';
import {input,prospect,report} from './schema.mjs';
import {csv} from './store.mjs';
import {research} from './research.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"};
const reply=(data,status=200,extra={})=>Response.json(data,{status,headers:{...headers,...extra}});
const fail=(message,status)=>Object.assign(Error(message),{status});
const expire=state=>{for(const j of state.jobs)if(j.status==='running'&&Date.now()-Date.parse(j.createdAt)>240000){j.status='interrupted';j.error='Research timed out. Start a new run.';}};
export function cloudApp({assets={},store=new CloudStore(),run=research,env=process.env}={}){
 return async function handle(req,ctx){try{
 const u=new URL(req.url),p=u.pathname,password=env.APP_PASSWORD||'';
 if(p==='/healthz')return reply({ok:true});
 if(password.length<20)return reply({error:'Workspace access is not configured.'},503);
 if(!authorized(req.headers.get('authorization'),env.APP_USERNAME||'dan',password))return reply({error:'Sign in to the Pirimid workspace.'},401,{'WWW-Authenticate':'Basic realm="Pirimid workspace", charset="UTF-8"'});
 if(['POST','DELETE'].includes(req.method)&&req.headers.get('origin')!==u.origin)return reply({error:'Request origin rejected.'},403);
 const body=async()=>{const text=await req.text();if(text.length>64000)throw fail('Request too large.',413);try{return JSON.parse(text);}catch{throw fail('Invalid request.',400);}};
 const enabled=env.APP_RESEARCH_ENABLED==='true';
 if(p==='/api/status')return reply({enabled,mode:'private-workspace',dailyLimit:Number(env.APP_DAILY_RUN_LIMIT||3)});
 if(p==='/api/research'&&req.method==='POST'){
 const parsed=input.safeParse(await body());if(!parsed.success)throw fail('Check the URL, market and geography fields.',400);
 if(parsed.data.mode==='speakers'&&!validPublicUrl(parsed.data.url))throw fail('Enter a public HTTPS event URL.',400);
 if(!enabled)throw fail('Add your API credentials to activate live research.',409);
 const limit=Number(env.APP_DAILY_RUN_LIMIT||3);if(!Number.isInteger(limit)||limit<1||limit>100)throw fail('Daily limit is misconfigured.',503);
 if(!env.EVE_SERVICE_PASSWORD||env.EVE_SERVICE_PASSWORD.length<20)throw fail('Research service is not configured.',503);
 const day=new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'});
 const job={id:randomUUID(),day,createdAt:new Date().toISOString(),status:'running',input:parsed.data};
 await store.mutate(s=>{expire(s);if(s.jobs.some(j=>j.status==='running'))throw fail('A research run is already in progress.',429);if(s.jobs.filter(j=>j.day===day).length>=limit)throw fail('Daily research limit reached.',429);s.jobs.unshift(job);});
 const update=change=>store.mutate(s=>{const j=s.jobs.find(j=>j.id===job.id);if(j?.status==='running'){Object.assign(j,change);return true;}return false;});
 const work=run(job.input,{host:u.origin,onSession:id=>update({sessionId:id})}).then(result=>update({status:'completed',result:report.parse(result),finishedAt:new Date().toISOString()})).catch(()=>update({status:'failed',error:'Research could not finish. Check API access and budget, then retry.',finishedAt:new Date().toISOString()}));
 ctx.waitUntil(work);return reply(job,202);
 }
 if(p==='/api/shortlist'&&req.method==='POST'){const raw=await body();if(raw.demo)throw fail('Demo records cannot be saved here.',400);const parsed=prospect.safeParse(raw);if(!parsed.success)throw fail('Invalid prospect.',400);const record=parsed.data;const id=createHash('sha256').update([record.name,record.company||record.location,record.sourceUrl].join('|')).digest('hex');return reply(await store.mutate(s=>{const previous=s.shortlist.find(r=>r.id===id);const item={...record,id,savedAt:previous?.savedAt||new Date().toISOString(),updatedAt:new Date().toISOString()};s.shortlist=s.shortlist.filter(r=>r.id!==id);s.shortlist.unshift(item);return item;}));}
 if(/^\/api\/shortlist\/[a-f0-9]{64}$/.test(p)&&req.method==='DELETE'){await store.mutate(s=>{s.shortlist=s.shortlist.filter(r=>r.id!==p.split('/').pop());});return reply({ok:true});}
 if(/^\/api\/jobs\/[^/]+\/cancel$/.test(p)&&req.method==='POST'){const {state}=await store.read();const j=state.jobs.find(j=>j.id===p.split('/')[3]);if(!j||j.status!=='running')throw fail('Run is no longer active.',409);if(j.sessionId){const client=new Client({host:u.origin,auth:{basic:{username:'app',password:env.EVE_SERVICE_PASSWORD}},redirect:'error'});await client.sessions.attach(j.sessionId).cancel();}await store.mutate(s=>{const row=s.jobs.find(r=>r.id===j.id);if(row?.status==='running'){row.status='cancelled';row.finishedAt=new Date().toISOString();}});return reply({ok:true});}
 if(req.method!=='GET')return reply({error:'Method not allowed.'},405);
 if(p.startsWith('/api/')){const {state}=await store.read();expire(state);if(p==='/api/jobs')return reply(state.jobs.map(({sessionId,...j})=>j));if(p==='/api/shortlist')return reply(state.shortlist);const j=state.jobs.find(j=>j.id===p.split('/')[3]);if(!j)return reply({error:'Run not found.'},404);if(p.endsWith('/export')){if(!j.result)return reply({error:'No results.'},404);return new Response(csv(j.result.speakers.length?j.result.speakers:j.result.events),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="aisc-research.csv"'}});}const {sessionId,...visible}=j;return reply(visible);}
 const asset=assets[p==='/'?'/index.html':p.replace(/^\/static\//,'/') ];if(!asset)return reply({error:'Not found.'},404);const ext=p.split('.').pop();const type=p==='/'||ext==='html'?'text/html; charset=utf-8':({js:'text/javascript',css:'text/css',json:'application/json',ttf:'font/ttf',png:'image/png'})[ext]||'application/octet-stream';return new Response(Buffer.from(asset,'base64'),{headers:{...headers,'Content-Type':type}});
 }catch(e){return reply({error:e.status?e.message:'Workspace temporarily unavailable. Please retry.'},e.status||503);}};
}
