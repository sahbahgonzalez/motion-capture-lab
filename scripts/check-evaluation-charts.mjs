import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,access,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const executable=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
await access(executable);
const profile=await mkdtemp(path.join(tmpdir(),'mcl-chart-'));
const recordingPlugin={name:'chart-check-recording',configureServer(server){if(process.env.MCL_COMPARISON_RECORDING)server.middlewares.use('/__chart_recording',async(_req,res)=>{try{res.setHeader('Content-Type','application/json');res.end(await readFile(process.env.MCL_COMPARISON_RECORDING));}catch(error){res.statusCode=500;res.end(String(error));}});}};
const server=await createServer({plugins:[recordingPlugin],server:{host:'127.0.0.1',port:0},logLevel:'error'});
try{
 await server.listen();const address=server.httpServer.address(),url=`http://127.0.0.1:${address.port}/scripts/evaluation-chart-check.html${process.env.MCL_COMPARISON_RECORDING?'?recording=1':''}`;
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
  for(let n=0;n<180;n++){
   const response=await send('Runtime.evaluate',{expression:`document.getElementById('chart-verification')?.outerHTML`,returnByValue:true});
   result=response.result.value??result;if(/data-chart-result="(passed|failed)"/.test(result))break;
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  console.log(result);if(!/data-chart-result="passed"/.test(result))process.exitCode=1;
 }finally{socket?.close();child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});}

}finally{
 await server.close();
 // Validate the exact temporary profile before recursive cleanup on Windows.
 const target=path.resolve(profile),prefix=path.resolve(tmpdir())+path.sep+'mcl-chart-';
 if(!target.startsWith(prefix)||target.length<=prefix.length)throw Error('Refusing cleanup outside the chart-check temporary profile.');
 await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
