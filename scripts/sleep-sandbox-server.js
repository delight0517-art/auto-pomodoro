'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),port=Number(process.env.SLEEP_SANDBOX_PORT||47831),sessionFile=path.resolve(process.env.SLEEP_WORLD_SESSION||path.join(root,'runtime/sleep-world/session.json'));
const riseSyncRoot=path.resolve(process.env.RISESYNC_ROOT||path.join(root,'..','45Auto_Alarm'));
const routes={'/':'tools/sleep-sandbox/index.html','/app.js':'tools/sleep-sandbox/app.js','/world.js':'tools/sleep-sandbox/world.js','/game.js':'tools/sleep-sandbox/gameplay.js','/engine.js':'main/userSleepState.js','/scenarios.js':'main/sleepSandbox.js','/report.json':'tools/sleep-sandbox/report.json'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),p=url.pathname;
 if(p==='/api/risesync/nap-evaluate'){
  if(req.method!=='POST'){res.writeHead(405);return res.end('POST required');}
  const chunks=[];let size=0;
  req.on('data',chunk=>{size+=chunk.length;if(size>65536){res.writeHead(413);res.end('Request too large');req.destroy();return;}chunks.push(chunk);});
  req.on('end',()=>{
   const body=Buffer.concat(chunks).toString('utf8');
   let request;
   try{request=JSON.parse(body);if(!(request.napScenario&&request.napScenario.input&&request.napScenario.gate)&&(!Array.isArray(request.napEvidence)||request.napEvidence.length!==1||!request.napGate))throw Error('expected napScenario or one napEvidence row and napGate');}
   catch(error){res.writeHead(400);return res.end(error.message);}
   const script=path.join(riseSyncRoot,'scripts/simulate-nap-lifecycle.py');
   const run=spawnSync('python3',[script,'--nap-input-json','-'],{cwd:riseSyncRoot,input:body,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
   if(run.error||run.status!==0){res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});return res.end((run.stderr||run.error?.message||'RiseSync policy adapter failed').slice(-3000));}
   try{const result=JSON.parse(run.stdout);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(result));}
   catch(error){res.writeHead(502);res.end(`Invalid RiseSync policy response: ${error.message}`);}
  });return;
 }
 if(p==='/api/risesync/dawn-phone-check'){
  if(req.method!=='GET'){res.writeHead(405);return res.end('GET required');}
  const script=path.join(root,'scripts/sleep-world-dawn-phone-test.js');
  const run=spawnSync(process.execPath,[script],{cwd:root,env:{...process.env,RISESYNC_ROOT:riseSyncRoot},encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  if(run.error||run.status!==0){res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});return res.end((run.stderr||run.error?.message||'RiseSync dawn continuation check failed').slice(-3000));}
  try{const result=JSON.parse(run.stdout);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(result));}
  catch(error){res.writeHead(502);res.end(`Invalid RiseSync dawn policy response: ${error.message}`);}
  return;
 }
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end();}
 const relative=routes[p]||(p.startsWith('/assets/')&&/^\/assets\/[a-zA-Z0-9_.-]+$/.test(p)?'tools/sleep-sandbox'+p:null);
 if(!relative&&p!=='/experiment.json'){res.writeHead(404);return res.end('Not found');}
 fs.readFile(p==='/experiment.json'?sessionFile:path.join(root,relative),(err,data)=>{
  if(err){res.writeHead(404);return res.end('Not found');}
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.json':'application/json','.txt':'text/plain; charset=utf-8'};
  const contentPath=relative||'session.json';
  res.writeHead(200,{'Content-Type':types[path.extname(contentPath)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:data);
 });
});
server.listen(port,'127.0.0.1',()=>console.log(`Wake Village http://127.0.0.1:${port} · virtual-only · pid=${process.pid}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
