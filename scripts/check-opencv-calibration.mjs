import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,access,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const executable=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
await access(executable);
const candidate=path.resolve(process.argv[2]??'tmp/opencv-build/build/bin/opencv.js');
const capturesInput=process.argv[3]??process.env.MCL_CALIBRATION_CAPTURES;
if(!capturesInput)throw Error('Usage: node scripts/check-opencv-calibration.mjs <trusted candidate opencv.js> <captures.json>');
const captures=path.resolve(capturesInput);
const reportPath=path.resolve('tmp/opencv-build/browser-validation.json');
await access(candidate);await access(captures);
const recordingPlugin={name:'opencv-candidate-check',configureServer(server){
 server.middlewares.use('/opencv.js',async(_req,res)=>{res.setHeader('Content-Type','application/javascript');res.end(await readFile(candidate));});
 server.middlewares.use('/__opencv_captures',async(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(await readFile(captures));});
 server.middlewares.use('/__opencv_report',(req,res)=>{let body='';req.on('data',data=>{body+=data;});req.on('end',async()=>{await writeFile(reportPath,JSON.stringify(JSON.parse(body),null,2));res.end('saved');});});
}};
const server=await createServer({plugins:[recordingPlugin],optimizeDeps:{entries:['scripts/opencv-calibration-check.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/tmp/**','**/temp/**']}},logLevel:'error'});
const profile=await mkdtemp(path.join(tmpdir(),'mcl-opencv-'));
try{
 await server.listen();const address=server.httpServer.address(),url=`http://127.0.0.1:${address.port}/scripts/opencv-calibration-check.html`;
 const child=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--disable-extensions','--no-sandbox','--disable-dev-shm-usage',`--user-data-dir=${profile}`,'--window-size=1440,2400','--remote-debugging-port=0','about:blank'],{windowsHide:true});
 let socket;
 try{
  // Use real browser time: virtual-time dumping can outrun Blob.text() for large archives.
  let port;for(let n=0;n<60&&!port;n++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
  if(!port)throw Error('Chrome debugging endpoint did not start.');
  const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map();socket.addEventListener('message',event=>{const message=JSON.parse(event.data),request=pending.get(message.id);if(request){pending.delete(message.id);message.error?request.reject(Error(JSON.stringify(message.error))):request.resolve(message.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});socket.send(JSON.stringify({id:requestId,method,params}));});
  await send('Page.enable');await send('Page.navigate',{url});
  let result='No chart result was emitted.';
  for(let n=0;n<1200;n++){
   const response=await send('Runtime.evaluate',{expression:`document.getElementById('opencv-verification')?.outerHTML`,returnByValue:true});
   result=response.result.value??result;if(/data-result="(passed|failed)"/.test(result))break;
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  console.log(result);if(!/data-result="passed"/.test(result))process.exitCode=1;
 }finally{socket?.close();child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});}

}finally{
 await server.close();
 // Validate the exact temporary profile before recursive cleanup on Windows.
 const target=path.resolve(profile),prefix=path.resolve(tmpdir())+path.sep+'mcl-opencv-';
 if(!target.startsWith(prefix)||target.length<=prefix.length)throw Error('Refusing cleanup outside the chart-check temporary profile.');
 await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
