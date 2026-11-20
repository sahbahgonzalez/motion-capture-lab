import type {StoredExperiment,VisualPipeline,ExperimentalSession,OfflineSample} from './types';
import type {PoseLandmarks} from '../hooks/useMediaPipePose';
import type {FailureCorrectionConfig,JointFailureStatus} from '../hooks/usePoseFailureCorrection';
import {triangulateAllLandmarks,type TriangulatedPose} from '../hooks/useTriangulation';
import {comparisonOutput,emptyComparisonPose} from '../utils/pipelineComparison';
import type {StereoCalibration} from '../type/calibration';
import {validateStereoCalibration} from '../utils/stereoGeometry';
export function visualConfiguration(session:ExperimentalSession,pipeline:VisualPipeline){
  const config=session.configuration as {stereoCalibration?:StereoCalibration;correction?:FailureCorrectionConfig;mediaPipe?:{configuration?:{wasmUrl?:string;options?:any}}};
  const runtime=config.mediaPipe?.configuration;
  if(!runtime?.wasmUrl||!runtime.options?.baseOptions?.modelAssetPath||runtime.options.runningMode!=='VIDEO')throw Error('Recorded MediaPipe VIDEO configuration is unavailable. No silent configuration substitution.');
  if(pipeline!=='P1'){
    const validation=validateStereoCalibration(config.stereoCalibration);if(!validation.valid)throw Error(validation.errors.join(' '));
    if(!session.cameraMapping.cameraA||!session.cameraMapping.cameraB)throw Error('Declare both video clock mappings or explicitly accept estimated recorder-start anchors before stereo playback.');
  }
  if(pipeline==='P3'&&(!config.correction||Object.values(config.correction).some(v=>typeof v!=='number'||!Number.isFinite(v))))throw Error('Recorded correction configuration is unavailable.');
  for(const change of session.configurationChanges??[]){
    const changed=change.configuration as typeof config;
    const keys=pipeline==='P1'?['mediaPipe']:pipeline==='P2'?['mediaPipe','stereoCalibration']:['mediaPipe','stereoCalibration','correction'];
    for(const key of keys){const initial=key==='mediaPipe'?runtime:(config as any)[key],next=key==='mediaPipe'?changed.mediaPipe?.configuration:(changed as any)[key];
      if(JSON.stringify(initial)!==JSON.stringify(next))throw Error('Recorded '+key+' changed during capture. Multi-configuration offline replay is unsupported; use a session with stable reconstruction settings.');
    }
  }
  return {runtime,calibration:config.stereoCalibration,correction:config.correction};
}
/** The same triangulation and stateful correction used by the live labs. No fusion/IMU input. */
export function processVisualObservation(pipeline:VisualPipeline,a:PoseLandmarks|null,b:PoseLandmarks|null,calibration:StereoCalibration|undefined,dimensions:[number,number,number,number],correct:(pose:TriangulatedPose)=>{correctedPose:TriangulatedPose;jointStatuses:JointFailureStatus[]}){
  if(pipeline==='P1')return comparisonOutput(a,()=> 'missing_camera_a_pose');
  const raw=a&&b&&calibration?triangulateAllLandmarks(calibration,a,b,...dimensions):emptyComparisonPose() as TriangulatedPose;
  return comparisonOutput(pipeline==='P3'?correct(raw).correctedPose:raw,()=>!a?'missing_camera_a_pose':!b?'missing_or_unmatched_camera_b_pose':'triangulation_unavailable');
}
export function stereoTargetTime(aSeconds:number,session:ExperimentalSession){const a=session.cameraMapping.cameraA,b=session.cameraMapping.cameraB;return a&&b?aSeconds+(a.offsetMs-b.offsetMs)/1000:null;}
export function saveOfflineSample(sample:OfflineSample,previous:OfflineSample|undefined){if(previous&&sample.cameraAMediaTimeSeconds<=previous.cameraAMediaTimeSeconds)throw Error('Offline state must advance strictly chronologically. Restart to process a new sequence.');return sample;}

// An unmounted older run may finish model initialization after a replacement run.
// Only the current owner may publish results for this session/pipeline.
const runOwners=new WeakMap<StoredExperiment,Partial<Record<VisualPipeline,string>>>();
export function claimOfflineRun(entry:StoredExperiment,pipeline:VisualPipeline,runId:string){const owners=runOwners.get(entry)??{};owners[pipeline]=runId;runOwners.set(entry,owners);}
export function ownsOfflineRun(entry:StoredExperiment,pipeline:VisualPipeline,runId:string){return runOwners.get(entry)?.[pipeline]===runId;}
