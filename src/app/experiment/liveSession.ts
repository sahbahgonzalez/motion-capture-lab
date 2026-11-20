import type {ComparisonFrame} from '../type/pipelineComparison';
import type {StereoRecordingProgress,StereoVideoRecording} from '../hooks/useStereoVideoRecorder';
import type {StoredExperiment} from './types';
import {comparisonSnapshot} from '../utils/pipelineComparison';

export const EXPERIMENT_LIMITATIONS=[
  'P4 is measured live. Only camera videos are replayed; there is no IMU archive or offline P4 recomputation in this workflow.',
  'Camera callbacks and analysis cycles are not exposure timestamps or encoded frame identifiers. Hardware camera synchronization is unverified.',
  'Encoded video PTS-to-experiment offsets are unresolved unless explicitly supplied or accepted as estimates. Recorder start is not proof of first exposure.',
  'Offline visual processing retains chronological browser-presented observations, not a guaranteed complete demuxed encoded-frame traversal.',
  'Offline processing restores the initial recorded reconstruction settings. Changes to MediaPipe, calibration, or relevant correction settings during capture require a stable-settings session; multi-configuration visual replay is not implemented.',
  'Independent pipeline metrics use their native observations. Paired comparisons require declared timestamp mappings and tolerance-limited one-to-one matches.',
  'Live shared processing spans and offline playback processing spans are different quantities; neither establishes exposure-to-output latency.',
];
export function createLiveSessionController(publish:(entry:StoredExperiment)=>void){
  let active:StoredExperiment|null=null,lastPublish=0,lastConfiguration='';
  return {
    get:()=>active,
    start(id:string,progress:{originPerformanceNowMs:number;diagnostics:StereoRecordingProgress['diagnostics']|null},wall:number,warmupMs:number,configuration:unknown){
      if(active&&['recording','finalizing'].includes(active.manifest.status))return null;
      if(!Number.isFinite(warmupMs)||warmupMs<0)throw Error('Warmup must be finite and non-negative.');
      active={assets:{cameraA:null,cameraB:null},manifest:{schemaVersion:'1.0.0-live-p4-visual-offline',sessionId:id,status:'recording',originPerformanceNowMs:progress.originPerformanceNowMs,startWallClockMs:wall,stopWallClockMs:null,durationMs:null,warmupEndExperimentTimeMs:warmupMs,configuration:comparisonSnapshot({...configuration as object,limitations:EXPERIMENT_LIMITATIONS}),
        clockDefinitions:{experiment:'milliseconds from the exact Stage 2A performance.now() origin; same browser page only',wall:'Date.now() Unix milliseconds, correlation only; never used for intervals',video:'encoded file media seconds; independent A/B origins; mapping requires a declaration or explicitly accepted estimate',liveSample:'original P4 processing-start performance.now() minus experiment origin; not exposure time',offlineProcessing:'performance.now() spans within playback; excludes model loading and seeking; not live performance'},
        liveP4:[],configurationChanges:[],cameras:{status:'recording',cameraAStatus:progress.diagnostics?.cameraAStatus??'error',cameraBStatus:progress.diagnostics?.cameraBStatus??'error',cameraAAsset:null,cameraBAsset:null,cameraATiming:null,cameraBTiming:null,synchronization:null,diagnostics:progress.diagnostics},
        offline:{},cameraMapping:{cameraA:null,cameraB:null},alignment:{toleranceMs:50,allowEstimated:false},annotations:[],evaluationConfigurations:{},errors:[],limitations:EXPERIMENT_LIMITATIONS}};
      lastConfiguration=JSON.stringify(comparisonSnapshot(configuration));lastPublish=progress.originPerformanceNowMs;publish(active);return active;
    },
    accept(frame:ComparisonFrame,configuration?:unknown){
      if(active?.manifest.status!=='recording')return;
      const m=active.manifest,time=frame.timing.processingStartedPerformanceNowMs-m.originPerformanceNowMs;
      if(time<0||(m.liveP4.length>0&&m.liveP4.at(-1)!.cycleId>=frame.cycleId))return;
      if(configuration!==undefined){const snapshot=comparisonSnapshot(configuration),encoded=JSON.stringify(snapshot);if(encoded!==lastConfiguration){m.configurationChanges.push({experimentTimeMs:time,configuration:snapshot});lastConfiguration=encoded;}}
      m.liveP4.push(comparisonSnapshot({cycleId:frame.cycleId,experimentTimeMs:time,phase:time<m.warmupEndExperimentTimeMs?'warmup':'measurement',output:frame.pipelines.P4,
        visualReliability:frame.pipelines.P3.joints,cameraObservationTiming:frame.timing,fusion:frame.fusion,correction:frame.correction,liveSharedProcessingDurationMs:frame.processingDurationMs,errors:frame.errors}));
      if(frame.processingCompletedPerformanceNowMs-lastPublish>=200){lastPublish=frame.processingCompletedPerformanceNowMs;publish(active);}
    },
    stop(now:number,wall:number,reason='user_stop'){
      if(active?.manifest.status!=='recording')return active;
      active.manifest.status='finalizing';active.manifest.durationMs=Math.max(0,now-active.manifest.originPerformanceNowMs);active.manifest.stopWallClockMs=wall;
      if(reason!=='user_stop')active.manifest.errors.push(reason);publish(active);return active;
    },
    finalize(recording:StereoVideoRecording){
      if(!active||recording.id!==active.manifest.sessionId)return null;
      if(active.manifest.status==='recording')this.stop(active.manifest.originPerformanceNowMs+recording.duration,Date.now(),'Camera recording stopped before explicit Stop Analysis.');
      const m=active.manifest;
      active.assets={cameraA:recording.cam1Blob.size?recording.cam1Blob:null,cameraB:recording.cam2Blob.size?recording.cam2Blob:null};
      m.cameras={status:recording.status,cameraAStatus:recording.cameraAEncodingStatus,cameraBStatus:recording.cameraBEncodingStatus,
        cameraAMimeType:recording.cam1Blob.type,cameraBMimeType:recording.cam2Blob.type,
        cameraAAsset:active.assets.cameraA?'cameras/camera_a':null,cameraBAsset:active.assets.cameraB?'cameras/camera_b':null,
        cameraATiming:recording.cameraATiming,cameraBTiming:recording.cameraBTiming,synchronization:recording.synchronizationDiagnostics,diagnostics:m.cameras.diagnostics,startupInstrumentation:recording.startupInstrumentation};
      m.errors.push(...recording.errors);
      m.status=recording.status==='complete'&&m.liveP4.length>0&&!m.errors.length?'ready':m.liveP4.length||active.assets.cameraA||active.assets.cameraB?'partial':'failed';
      if(!m.liveP4.length)m.errors.push('No live P4 cycles were retained.');publish(active);return active;
    },
  };
}
