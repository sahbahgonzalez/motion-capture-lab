import {useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import type {StereoVideoRecording} from './useStereoVideoRecorder';
import {useStereoVideoRecorder} from './useStereoVideoRecorder';
import {createLiveSessionController} from '../experiment/liveSession';
import {experimentRegistry} from '../experiment/registry';
import type {ComparisonFrame} from '../type/pipelineComparison';

export function useLiveP4Experiment(streamA:MediaStream|null,streamB:MediaStream|null,videoA:RefObject<HTMLVideoElement|null>,videoB:RefObject<HTMLVideoElement|null>,onActiveChange?:(active:boolean)=>void){
  const controller=useRef<ReturnType<typeof createLiveSessionController>|null>(null);
  if(!controller.current)controller.current=createLiveSessionController(entry=>experimentRegistry.put(entry));
  const [revision,refresh]=useState(0),[error,setError]=useState<string|null>(null),mounted=useRef(true),activeCallback=useRef(onActiveChange);activeCallback.current=onActiveChange;
  const pending=useRef<StereoVideoRecording|null>(null);
  const camera=useStereoVideoRecorder(streamA,streamB,{cameraA:{videoRef:videoA},cameraB:{videoRef:videoB},
    // Deliberately no imuRecordingSource: live orientations are never archived for replay.
    onRecordingFinalized:recording=>{if(!controller.current!.finalize(recording))pending.current=recording;activeCallback.current?.(false);if(mounted.current)refresh(v=>v+1);}});
  const stopCamera=useRef(camera.stopRecording);stopCamera.current=camera.stopRecording;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current!.stop(performance.now(),Date.now(),'P4 analysis interrupted by navigation/unmount.');void stopCamera.current();};},[]);
  return {revision,session:controller.current.get(),cameraDiagnostics:camera.recordingDiagnostics,error:error??camera.error,
    accept:(frame:ComparisonFrame,configuration?:unknown)=>{
      const progress=camera.getRecordingProgress();
      if(progress?.phase==='stopping'){
        const times=[progress.instrumentation.cameraA.stopCallExperimentTimeMs,progress.instrumentation.cameraB.stopCallExperimentTimeMs].filter((t):t is number=>typeof t==='number');
        controller.current!.stop(times.length?progress.originPerformanceNowMs+Math.min(...times):performance.now(),Date.now(),'Camera recording interrupted; live evaluation closed.');
        return;
      }
      controller.current!.accept(frame,configuration);
    },
    start(warmupMs:number,configuration:unknown){
      if(!Number.isFinite(warmupMs)||warmupMs<0){setError('Warmup must be finite and non-negative.');return;}
      if(controller.current!.get()&&['recording','finalizing'].includes(controller.current!.get()!.manifest.status))return;
      if(experimentRegistry.getSnapshot().sessions.some(e=>['recording','finalizing'].includes(e.manifest.status))){setError('Another experimental session is recording or finalizing.');return;}
      const id=crypto.randomUUID();const started=camera.startRecordingWithIdentity({recordingId:id,experimentSessionId:id});
      if(!started){setError('Camera recording could not start; analysis was not opened.');return;}
      const progress=camera.getRecordingProgress();
      controller.current!.start(id,progress??{originPerformanceNowMs:started.originPerformanceNowMs,diagnostics:null},Date.now(),warmupMs,configuration);
      if(pending.current?.id===id){controller.current!.finalize(pending.current);pending.current=null;}
      activeCallback.current?.(controller.current!.get()?.manifest.status==='recording');setError(null);refresh(v=>v+1);
    },
    async stop(){controller.current!.stop(performance.now(),Date.now());refresh(v=>v+1);await camera.stopRecording();if(mounted.current)refresh(v=>v+1);},
  };
}
