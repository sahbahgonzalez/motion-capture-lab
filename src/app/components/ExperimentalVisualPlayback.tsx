import {useEffect,useRef,useState} from 'react';
import {PoseLandmarker,FilesetResolver} from '@mediapipe/tasks-vision';
import {usePoseFailureCorrection,DEFAULT_CONFIG} from '../hooks/usePoseFailureCorrection';
import {poseLandmarkerResultToLandmarks} from '../utils/poseLandmarks';
import {comparisonSnapshot} from '../utils/pipelineComparison';
import {processVisualObservation,visualConfiguration,stereoTargetTime,saveOfflineSample,claimOfflineRun,ownsOfflineRun} from '../experiment/visualProcessing';
import type {StoredExperiment,VisualPipeline,OfflineResult} from '../experiment/types';
import {experimentRegistry} from '../experiment/registry';
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function check(signal:AbortSignal){if(signal.aborted)throw Error('Playback cancelled; retained samples are partial.');}
async function ready(video:HTMLVideoElement,signal:AbortSignal){const limit=performance.now()+15000;while(video.readyState<2){check(signal);if(video.error)throw Error(video.error.message);if(performance.now()>limit)throw Error('Video decode timed out.');await wait(25);}}
/** seeked reports requested file time, not a verified decoded exposure. Retain this weaker evidence explicitly. */
async function seek(video:HTMLVideoElement,time:number,signal:AbortSignal){check(signal);if(Math.abs(video.currentTime-time)>0.00001){video.currentTime=time;const limit=performance.now()+10000;while(video.seeking){check(signal);if(performance.now()>limit)throw Error('Video seek timed out.');await wait(10);}}await ready(video,signal);return video.currentTime;}
async function nextPresented(video:HTMLVideoElement,signal:AbortSignal):Promise<{mediaTime:number;frameId:number|null}|null>{
  check(signal);if(video.ended)return null;
  return new Promise((resolve,reject)=>{
    let handle:number|null=null,timer:ReturnType<typeof setTimeout>,done=false;const previous=video.currentTime;
    const finish=(value:{mediaTime:number;frameId:number|null}|null,error?:unknown)=>{if(done)return;done=true;clearTimeout(timer);if(handle!==null)video.cancelVideoFrameCallback(handle);video.removeEventListener('ended',ended);signal.removeEventListener('abort',abort);video.pause();error?reject(error):resolve(value);};
    const ended=()=>finish(null),abort=()=>finish(null,Error('Playback cancelled; retained samples are partial.'));
    video.addEventListener('ended',ended,{once:true});signal.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(null,Error('No new browser video presentation within 15 seconds.')),15000);
    if(typeof video.requestVideoFrameCallback==='function'){
      const observe=()=>{handle=video.requestVideoFrameCallback((_now,raw)=>{const meta=raw as {mediaTime:number;presentedFrames?:number};if(meta.mediaTime<=previous){observe();return;}finish({mediaTime:meta.mediaTime,frameId:meta.presentedFrames??null});});};observe();
    }else{const poll=()=>{if(done)return;if(video.currentTime>previous)finish({mediaTime:video.currentTime,frameId:null});else setTimeout(poll,16);};poll();}
    void video.play().catch(e=>finish(null,e));
  });
}
function freeze(video:HTMLVideoElement){const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;const ctx=c.getContext('2d');if(!ctx)throw Error('Canvas capture unavailable.');ctx.drawImage(video,0,0);return c;}
export function ExperimentalVisualPlayback({entry,pipeline}:{entry:StoredExperiment;pipeline:VisualPipeline}){
  const a=useRef<HTMLVideoElement>(null),b=useRef<HTMLVideoElement>(null),abort=useRef<AbortController|null>(null),paused=useRef(false),mounted=useRef(true);
  const [urls,setUrls]=useState({a:'',b:''}),[running,setRunning]=useState(false),[isPaused,setPaused]=useState(false),[count,setCount]=useState(0),[error,setError]=useState('');
  const correctionConfig=(entry.manifest.configuration as any)?.correction??DEFAULT_CONFIG;
  const {correct,reset}=usePoseFailureCorrection(correctionConfig);
  useEffect(()=>{mounted.current=true;const urls={a:entry.assets.cameraA?URL.createObjectURL(entry.assets.cameraA):'',b:entry.assets.cameraB?URL.createObjectURL(entry.assets.cameraB):''};setUrls(urls);return()=>{mounted.current=false;abort.current?.abort();a.current?.pause();b.current?.pause();Object.values(urls).forEach(u=>{if(u)URL.revokeObjectURL(u);});};},[entry.manifest.sessionId,entry.assets.cameraA,entry.assets.cameraB]);
  async function run(){
    if(abort.current)return;
    const control=new AbortController();abort.current=control;paused.current=false;setPaused(false);setRunning(true);setError('');setCount(0);reset();
    const manifest=comparisonSnapshot(entry.manifest),result:OfflineResult={sessionId:manifest.sessionId,pipeline,runId:crypto.randomUUID(),status:'partial',samples:[],configuration:null,errors:[],cameraMapping:manifest.cameraMapping,samplingPolicy:'Chronological browser-presented Camera A observations; Camera B seek/currentTime approximation after declared clock mapping. Not guaranteed encoded-frame exhaustive or hardware synchronized.',skippedPresentationObservations:0};
    claimOfflineRun(entry,pipeline,result.runId);
    let modelA:PoseLandmarker|null=null,modelB:PoseLandmarker|null=null;
    try{
      if(!entry.assets.cameraA||!a.current)throw Error('Camera A recording is missing.');
      if(pipeline!=='P1'&&(!entry.assets.cameraB||!b.current))throw Error('Camera B recording is missing.');
      const config=visualConfiguration(manifest,pipeline);result.configuration={...config,performance:'offline_playback_processing; excludes model initialization and seeking',software:'existing normalized DLT and existing correction; no IMU/fusion replay'};
      const files=await FilesetResolver.forVisionTasks(config.runtime.wasmUrl!);check(control.signal);
      modelA=await PoseLandmarker.createFromOptions(files,config.runtime.options);check(control.signal);
      if(pipeline!=='P1'){modelB=await PoseLandmarker.createFromOptions(files,config.runtime.options);check(control.signal);}
      const va=a.current!,vb=b.current;va.pause();vb?.pause();await ready(va,control.signal);await seek(va,0,control.signal);
      let observation:{mediaTime:number;frameId:number|null}|null={mediaTime:va.currentTime,frameId:null},lastFrame:number|null=null;
      while(observation){
        check(control.signal);while(paused.current){await wait(50);check(control.signal);}
        const time=observation.mediaTime,canvasA=freeze(va),errors:string[]=[];
        let bTime:number|null=null,residual:number|null=null,canvasB:HTMLCanvasElement|null=null;
        if(pipeline!=='P1'&&vb){await ready(vb,control.signal);const target=stereoTargetTime(time,manifest)!;
          if(target>=0&&target<=vb.duration){bTime=await seek(vb,target,control.signal);residual=(bTime-target)*1000;if(Math.abs(residual)<=manifest.alignment.toleranceMs)canvasB=freeze(vb);else errors.push('Camera B outside declared file-time tolerance.');}
          else errors.push('Camera B target outside recorded footage.');
        }
        check(control.signal);const started=performance.now();let lmA=null,lmB=null;
        // Monotonic inference timestamps derive from this run's native A media clock, never live performance time.
        try{lmA=poseLandmarkerResultToLandmarks(modelA.detectForVideo(canvasA,time*1000));}catch(e){errors.push('Camera A inference: '+String(e));}
        if(modelB&&canvasB)try{lmB=poseLandmarkerResultToLandmarks(modelB.detectForVideo(canvasB,time*1000));}catch(e){errors.push('Camera B inference: '+String(e));}
        const output=processVisualObservation(pipeline,lmA,lmB,config.calibration,[va.videoWidth,va.videoHeight,vb?.videoWidth??0,vb?.videoHeight??0],correct);
        if(lastFrame!==null&&observation.frameId!==null)result.skippedPresentationObservations+=Math.max(0,observation.frameId-lastFrame-1);lastFrame=observation.frameId;
        result.samples.push(saveOfflineSample({sampleId:result.runId+':'+result.samples.length,index:result.samples.length,cameraAMediaTimeSeconds:time,cameraBMediaTimeSeconds:bTime,cameraAFrameId:observation.frameId,cameraBFrameId:null,experimentTimeMs:manifest.cameraMapping.cameraA?time*1000+manifest.cameraMapping.cameraA.offsetMs:null,output,playbackProcessingDurationMs:performance.now()-started,timingEvidence:observation.frameId===null?'A currentTime fallback; B seek/currentTime; decoded frame identity unavailable':'A rVFC mediaTime/presentation counter (not capture frame ID); B seek/currentTime, decoded B PTS unverified',stereoPairResidualMs:residual,errors},result.samples.at(-1)));
        if(result.samples.length%5===0&&mounted.current)setCount(result.samples.length);
        observation=await nextPresented(va,control.signal);
      }
      result.status=result.samples.length&&!result.samples.some(s=>s.errors.length)?'complete':result.samples.length?'partial':'failed';
    }catch(e){result.errors.push(String(e));result.status=result.samples.length?'partial':'failed';if(mounted.current)setError(String(e));}
    finally{for(const model of [modelA,modelB])try{model?.close();}catch(e){result.errors.push('Model cleanup: '+String(e));result.status=result.samples.length?'partial':'failed';}a.current?.pause();b.current?.pause();const current=experimentRegistry.get(manifest.sessionId);if(current===entry&&ownsOfflineRun(entry,pipeline,result.runId)){current.manifest.offline[pipeline]=result;experimentRegistry.put(current);}abort.current=null;if(mounted.current){setRunning(false);setCount(result.samples.length);}}
  }
  return <section className="border border-gray-700 rounded p-4 space-y-3"><h2>{pipeline} offline playback ? same P4 session videos</h2>
    <p>P1 uses A. P2/P3 use A+B. No live cameras or IMUs required. Restart resets correction and runs chronologically from the beginning. Native video controls are disabled during processing.</p>
    <div className="flex gap-3"><video aria-label="Recorded Camera A" ref={a} src={urls.a||undefined} controls={!running} muted playsInline className="w-1/2" />{pipeline!=='P1'&&<video aria-label="Recorded Camera B" ref={b} src={urls.b||undefined} controls={!running} muted playsInline className="w-1/2" />}</div>
    <button disabled={running} onClick={()=>void run()}>Run / restart {pipeline}</button> <button disabled={!running} onClick={()=>{paused.current=!paused.current;setPaused(paused.current);}}>{isPaused?'Resume':'Pause'}</button> <button disabled={!running} onClick={()=>abort.current?.abort()}>Cancel and retain partial result</button>
    <p>{running?'Processing':'Stopped'}: {count} observations retained. {pipeline==='P1'?'P1 has normalized image coordinates; no metric 3D accuracy claim.':'B seek/currentTime pairing is approximate, not measured decoded exposure correspondence.'}</p>{error&&<p role="alert">{error}</p>}
  </section>;
}
