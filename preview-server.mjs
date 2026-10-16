import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Store,csv} from './lib/store.mjs';
import {authorized,validPublicUrl} from './lib/access.mjs';
import {input,prospect,report} from './lib/schema.mjs';
import {research} from './lib/research.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
export function createApp({store=new Store(process.env.APP_DATA_DIR||path.join(root,'.local')),run=research,enabled=process.env.APP_RESEARCH_ENABLED==='true',dailyLimit=Number(process.env.APP_DAILY_RUN_LIMIT||3),publicOrigin=process.env.APP_ORIGIN||'',username=process.env.APP_USERNAME||'dan',password=process.env.APP_PASSWORD||''}={}){
 if(publicOrigin&&(!publicOrigin.startsWith('https://')||password.length<20))throw Error('Hosted mode requires HTTPS APP_ORIGIN and an APP_PASSWORD of at least 20 characters.');
 if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100)throw Error('Invalid daily run limit');
 const controllers=new Map();
 const send=(res,status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'});res.end(type==='application/json'?(Buffer.isBuffer(data)?data:JSON.stringify(data)):data);};
 return http.createServer(async(req,res)=>{try{
  const host=req.headers.host||'';const expectedHost=publicOrigin?new URL(publicOrigin).host:null;
  if(expectedHost?host!==expectedHost:!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))return send(res,403,{error:'Host rejected.'});
  const origin=publicOrigin||`http://${host}`;const u=new URL(req.url,origin);
  if(req.method==='GET'&&u.pathname==='/healthz')return send(res,200,{ok:true});
  if((publicOrigin||password)&&!authorized(req.headers.authorization,username,password)){res.setHeader('WWW-Authenticate','Basic realm="Pirimid workspace", charset="UTF-8"');return send(res,401,{error:'Sign in to the Pirimid workspace.'});}
  if(['POST','PUT','DELETE','PATCH'].includes(req.method)&&((req.headers.origin&&req.headers.origin!==origin)||(publicOrigin&&!req.headers.origin)))return send(res,403,{error:'Request origin rejected.'});
  const body=async()=>{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>64000)throw Error('Request too large');}return JSON.parse(raw);};
  if(req.method==='GET'&&u.pathname==='/api/shortlist')return send(res,200,store.shortlist);
  if(req.method==='POST'&&u.pathname==='/api/shortlist'){let data;try{data=await body();if(data.demo)throw Error();data=prospect.parse(data);}catch{return send(res,400,{error:'Invalid prospect. Demo data cannot be saved to the live workspace.'});}return send(res,200,store.saveProspect(data));}
  if(req.method==='DELETE'&&/^\/api\/shortlist\/[a-f0-9]{64}$/.test(u.pathname)){store.removeProspect(u.pathname.split('/').pop());return send(res,200,{ok:true});}
  if(req.method==='POST'&&/^\/api\/jobs\/[^/]+\/cancel$/.test(u.pathname)){const id=u.pathname.split('/')[3];const controller=controllers.get(id);if(!controller)return send(res,409,{error:'This run is no longer active.'});controller.abort();return send(res,202,{ok:true});}
  if(req.method==='GET'&&u.pathname==='/api/status')return send(res,200,{enabled,mode:publicOrigin?'private-workspace':'local-preview',dailyLimit});
  if(req.method==='GET'&&u.pathname==='/api/jobs')return send(res,200,store.jobs);
  if(req.method==='GET'&&/^\/api\/jobs\/[^/]+$/.test(u.pathname)){const j=store.jobs.find(x=>x.id===u.pathname.split('/').pop());return send(res,j?200:404,j||{error:'Run not found.'});}
  if(req.method==='GET'&&/^\/api\/jobs\/[^/]+\/export$/.test(u.pathname)){const j=store.jobs.find(x=>x.id===u.pathname.split('/')[3]);if(!j?.result)return send(res,404,{error:'No results to export.'});res.setHeader('Content-Disposition','attachment; filename="aisc-research.csv"');return send(res,200,csv(j.result.speakers.length?j.result.speakers:j.result.events),'text/csv; charset=utf-8');}
  if(req.method==='POST'&&u.pathname==='/api/research'){
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>12000)return send(res,413,{error:'Request is too large.'});}
   let parsed;try{parsed=input.parse(JSON.parse(raw));}catch{return send(res,400,{error:'Check the URL, market and geography fields.'});}
   if(parsed.mode==='speakers'&&!validPublicUrl(parsed.url))return send(res,400,{error:'Enter a public HTTPS event URL.'});
   if(!enabled)return send(res,409,{error:'Live research is not activated yet.',code:'NOT_ACTIVATED'});
   if(store.jobs.some(j=>j.status==='running'))return send(res,429,{error:'A research run is already in progress.'});
   const day=new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'});if(store.jobs.filter(j=>j.day===day).length>=dailyLimit)return send(res,429,{error:'The configured daily research-run limit has been reached.'});
   const j=store.add({id:randomUUID(),day,createdAt:new Date().toISOString(),status:'running',input:parsed});send(res,202,j);
   const controller=new AbortController();controllers.set(j.id,controller);
   Promise.resolve().then(()=>run(parsed,{signal:controller.signal})).then(result=>store.update(j.id,{status:controller.signal.aborted?'cancelled':'completed',...(controller.signal.aborted?{}:{result:report.parse(result)}),finishedAt:new Date().toISOString()})).catch(error=>store.update(j.id,{status:controller.signal.aborted?'cancelled':'failed',error:({RESEARCH_TIMEOUT:'Research timed out. Partial output was not saved.',BILLING_REQUIRED:'AI Gateway requires a payment method on file. The owner must complete Vercel billing setup before research can run.',BUDGET_EXHAUSTED:'The research budget or provider credit balance has been exhausted. Contact the workspace owner.'})[error?.code]||'Research did not finish. Review provider configuration before retrying.',finishedAt:new Date().toISOString()})).finally(()=>controllers.delete(j.id));return;
  }
  if(req.method!=='GET')return send(res,405,{error:'Method not allowed.'});
  const pathname=u.pathname==='/'?'/index.html':u.pathname.replace(/^\/static\//,'/');const target=path.resolve(root,'ui','.'+pathname);if(!target.startsWith(path.join(root,'ui')+path.sep))return send(res,403,{error:'Invalid path.'});
  const ext=path.extname(target);const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.ttf':'font/ttf','.svg':'image/svg+xml'};
  try{const data=await readFile(target);send(res,200,data,types[ext]||'application/octet-stream');}catch{send(res,404,{error:'Not found.'});}
 }catch{if(!res.headersSent)send(res,500,{error:'The local service could not handle this request.'});else res.end();}});
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT||4317);createApp().listen(port,process.env.APP_ORIGIN?'0.0.0.0':'127.0.0.1',()=>console.log(`AISC Event Desk: http://127.0.0.1:${port}`));}
