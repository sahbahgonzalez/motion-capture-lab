/** One shared browser loader. Script load and WASM readiness are separate events. */
export const CHECKERBOARD_FUNCTIONS=['Mat','matFromImageData','cvtColor','Size','TermCriteria','findChessboardCorners','cornerSubPix'] as const;
export const CALIBRATION_FUNCTIONS=['Mat','MatVector','Size','calibrateCamera','stereoCalibrate','stereoRectify'] as const;
export const CALIBRATION_CONSTANTS=['CV_32FC3','CV_32FC2','CALIB_FIX_INTRINSIC','CALIB_ZERO_DISPARITY'] as const;
export function calibrationCapabilities(cv:any){const missing=[...CALIBRATION_FUNCTIONS.filter(k=>typeof cv?.[k]!=='function'),...CALIBRATION_CONSTANTS.filter(k=>!Number.isFinite(cv?.[k]))];return {ready:missing.length===0,missing};}
interface State {isLoaded:boolean;isLoading:boolean;error:string|null;}
let state:State={isLoaded:false,isLoading:false,error:null};
const listeners=new Set<()=>void>();
let cancelAttempt:(()=>void)|null=null;
const publish=(next:State)=>{state=next;listeners.forEach(listener=>listener());};
const object=(value:any)=>value!==null&&(typeof value==='object'||typeof value==='function');
const missing=(cv:any)=>CHECKERBOARD_FUNCTIONS.filter(name=>typeof cv?.[name]!=='function');
const message=(reason:string)=>'Failed to load OpenCV.js: '+reason;
export function retryOpenCVRuntime(){
 cancelAttempt?.();cancelAttempt=null;
 publish({isLoaded:false,isLoading:true,error:null});
 let stopped=false,script:HTMLScriptElement|null=null,lastRuntime:any=null,pending=0,capabilityError:string|null=null,initializationError:string|null=null;
 const watched=new WeakSet<object>(),factories=new WeakMap<object,any>();
 let interval:ReturnType<typeof setInterval>|null=null,timeout:ReturnType<typeof setTimeout>|null=null;
 const cleanup=()=>{stopped=true;if(interval!==null)clearInterval(interval);if(timeout!==null)clearTimeout(timeout);script?.removeEventListener('load',loaded);script?.removeEventListener('error',failed);cancelAttempt=null;};
 cancelAttempt=cleanup;
 const fail=(reason:string)=>{if(stopped)return;cleanup();publish({isLoaded:false,isLoading:false,error:message(reason)});};
 const accept=(cv:any)=>{if(stopped)return;window.cv=cv;cleanup();publish({isLoaded:true,isLoading:false,error:null});};
 const observe=(candidate:any,initialized=false):void=>{
  if(stopped||!object(candidate))return;
  if(typeof candidate.Mat==='function'){
   lastRuntime=candidate;
   if(!missing(candidate).length&&candidate.calledRun!==false){accept(candidate);return;}
   if(initialized||candidate.calledRun===true)capabilityError='Runtime initialized, but this OpenCV build does not expose required checkerboard functions: '+missing(candidate).join(', ')+'. Use a compatible OpenCV.js build with these bindings; waiting or reloading cannot add missing functions. Saved Calibration Ready describes stored calibration data, not runtime capabilities.';
  }
  if(watched.has(candidate))return;watched.add(candidate);
  // Do not await/Promise.resolve an old Emscripten self-resolving thenable.
  // Its callback receives the same module, which still has a .then method.
  if(typeof candidate.then==='function'){
   pending++;try{candidate.then((module:any)=>{pending--;observe(module??candidate,true);check();},(error:unknown)=>{pending--;initializationError='Runtime initialization rejected: '+String(error);check();});}catch(error){pending--;initializationError='Runtime initialization failed: '+String(error);}
   return;
  }
  if(object(candidate.default))observe(candidate.default,initialized);
  if(object(candidate.ready))observe(candidate.ready);
  if(typeof candidate==='function'&&typeof candidate.Mat!=='function'){
   try{if(!factories.has(candidate))factories.set(candidate,candidate());observe(factories.get(candidate));}catch(error){fail('Module factory failed: '+String(error));}
  }
 };
 function check(){
  observe(window.cv);
  const module=(window as any).Module;
  // A bare Emscripten configuration object is not a second runtime.
  if(object(module)&&(module.Mat||module.then||module.ready||module.default))observe(module);
  if(!stopped&&pending===0&&(capabilityError||initializationError))fail(capabilityError??initializationError!);
 }
 function loaded(){check();} // Keep polling if the global/runtime is not ready yet.
 function failed(){if(script)script.dataset.openCvLoadFailed='true';fail('Could not fetch /opencv.js. Existing images and calibration have not been changed.');}
 interval=setInterval(check,50);
 timeout=setTimeout(()=>{fail(lastRuntime?'Initialization timed out; unavailable checkerboard bindings: '+missing(lastRuntime).join(', '):'Initialization timed out waiting for an OpenCV module/global and WASM runtime.');},30000);
 check();if(stopped)return;
 const candidates=Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).filter(s=>{try{return new URL(s.src,document.baseURI).pathname==='/opencv.js';}catch{return false;}});
 script=candidates.find(s=>s.dataset.openCvLoadFailed!=='true')??null;
 const module=(window as any).Module;
 const existingRuntime=object(window.cv)||object(module)&&(module.Mat||module.then||module.ready||module.default);
 if(!script&&!existingRuntime){script=document.createElement('script');script.src='/opencv.js';script.async=true;script.dataset.motionCaptureOpenCv='true';script.addEventListener('load',loaded);script.addEventListener('error',failed);document.head.appendChild(script);}
 else if(script){script.addEventListener('load',loaded);script.addEventListener('error',failed);}
}
export const getOpenCVRuntimeState=()=>state;
export function subscribeOpenCVRuntime(listener:()=>void){
 listeners.add(listener);
 if(!cancelAttempt&&!state.isLoaded)retryOpenCVRuntime();
 return ()=>{listeners.delete(listener);if(listeners.size===0&&cancelAttempt){cancelAttempt();publish({isLoaded:false,isLoading:false,error:null});}};
}
