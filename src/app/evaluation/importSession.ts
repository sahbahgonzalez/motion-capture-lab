import { LANDMARK_KEYS } from '../hooks/useTriangulation';
import type { PipelineId } from '../type/pipelineComparison';
import type { EvaluatedFrame, ImportedSession, Sample, State, Segment } from './types';
import {at,object,finite,positive,fingerprint} from './statistics';

export const PIPELINE_IDS:PipelineId[]=['P1','P2','P3','P4'];
export const STATES:State[]=['STEREO','IMU_CORRECTION','RECOVERY','UNAVAILABLE','UNKNOWN'];
export const SEGMENTS:Record<Segment,{joints:[typeof LANDMARK_KEYS[number],typeof LANDMARK_KEYS[number]];controller:'upperArm'|'forearm'|null}>={
  rightUpperArm:{joints:['rightShoulder','rightElbow'],controller:'upperArm'},rightForearm:{joints:['rightElbow','rightWrist'],controller:'forearm'},
  leftUpperArm:{joints:['leftShoulder','leftElbow'],controller:null},leftForearm:{joints:['leftElbow','leftWrist'],controller:null},
};
const nonnegative=(v:unknown)=>finite(v)&&v>=0?v:null;
const text=(v:unknown)=>typeof v==='string'?v:null;
const state=(v:unknown):State=>STATES.includes(v as State)?v as State:'UNKNOWN';

/** Read-only normalization. Source order is retained; malformed cycles are not dropped. */
export function importComparisonSession(input:unknown):ImportedSession {
  const source=object(input);
  if(!Array.isArray(source.frames))throw new Error('Expected a comparison-session JSON object with a frames array. Stage 2C ZIPs and legacy single-pipeline MotionRecording files are not four-pipeline comparison recordings.');
  const version=text(source.schemaVersion);
  if(version && version!=='1.0.0-live-pipeline-comparison')throw new Error('Unsupported comparison schema: '+version);
  const rawFrames=source.frames;
  if(!version&&rawFrames.length && !rawFrames.some(f=>Object.keys(object(at(f,'pipelines'))).some(k=>PIPELINE_IDS.includes(k as PipelineId))))throw new Error('No P1-P4 pipeline outputs found. Use the existing Analyze tool for single-pipeline recordings.');
  const warnings:string[]=[];
  if(!version)warnings.push('Legacy comparison without schemaVersion: shape-based import; missing fields remain unavailable.');
  const quality={malformedFrames:0,missingPipelineRecords:0,invalidRecordedValidityClaims:0,inferredValiditySamples:0,missingTimestamps:0,duplicateTimestamps:0,nonMonotonicTimestamps:0,duplicateCycleIds:0,imuFlagStateDisagreements:0};
  const warmupEndMs=nonnegative(source.warmupEndExperimentTimeMs),durationMs=nonnegative(source.durationMs),origin=nonnegative(source.originPerformanceNowMs);
  const configurations:unknown[]=[source.metadata??null];
  const changes=Array.isArray(source.configurationChanges)?source.configurationChanges:[];
  const validChanges=changes.map((c,index)=>({time:nonnegative(at(c,'experimentTimeMs')),value:at(c,'configuration'),index:index+1})).filter(c=>c.time!==null&&c.value!==undefined).sort((a,b)=>a.time!-b.time!);
  for(const change of validChanges){configurations.push(change.value);change.index=configurations.length-1;}
  if(validChanges.length!==changes.length)warnings.push('Malformed configuration changes were not applied; original journal retained.');
  let previousTime:number|null=null;const seenTimes=new Set<number>(),seenCycles=new Set<number>();
  const frames:EvaluatedFrame[]=rawFrames.map((raw,index)=>{
    const f=object(raw);if(!Object.keys(f).length)quality.malformedFrames++;
    let timeMs=nonnegative(f.experimentTimeMs),timeSource:EvaluatedFrame['timeSource']=timeMs===null?'unavailable':'recorded';
    const start=nonnegative(at(f,'timing','processingStartedPerformanceNowMs'));
    if(timeMs===null&&start!==null&&origin!==null&&start>=origin){timeMs=start-origin;timeSource='performance_origin';}
    if(timeMs===null)quality.missingTimestamps++;else{if(seenTimes.has(timeMs))quality.duplicateTimestamps++;if(previousTime!==null&&timeMs<previousTime)quality.nonMonotonicTimestamps++;seenTimes.add(timeMs);previousTime=timeMs;}
    const cycleId=finite(f.cycleId)&&Number.isInteger(f.cycleId)&&f.cycleId>=0?f.cycleId:null;
    if(cycleId!==null){if(seenCycles.has(cycleId))quality.duplicateCycleIds++;seenCycles.add(cycleId);}
    let phase:EvaluatedFrame['phase']=f.phase==='warmup'||f.phase==='measurement'?f.phase:'unclassified';
    if(phase==='unclassified'&&warmupEndMs!==null&&timeMs!==null)phase=timeMs<warmupEndMs?'warmup':'measurement';
    let configurationIndex=0;
    if(timeMs!==null)for(const change of validChanges)if(change.time!<=timeMs)configurationIndex=change.index;
    const pipelines={} as EvaluatedFrame['pipelines'];
    for(const id of PIPELINE_IDS){
      if(!Object.keys(object(at(f,'pipelines',id))).length)quality.missingPipelineRecords++;
      pipelines[id]={} as EvaluatedFrame['pipelines'][PipelineId];
      for(const joint of LANDMARK_KEYS){
        const p=object(at(f,'pipelines',id,'pose',joint)),flag=at(f,'pipelines',id,'joints',joint,'valid');
        const point=finite(p.x)&&finite(p.y)&&finite(p.z)?{x:p.x,y:p.y,z:p.z}:null;
        const visibilityValid=p.visibility===undefined||(finite(p.visibility)&&p.visibility>=.5&&p.visibility<=1);
        const hasPoseField=Object.hasOwn(object(at(f,'pipelines',id,'pose')),joint);
        const validitySource:Sample['validitySource']=typeof flag==='boolean'?'recorded':hasPoseField?'inferred_legacy':'unavailable';
        if(validitySource==='inferred_legacy')quality.inferredValiditySamples++;
        const valid=!!point&&visibilityValid&&(typeof flag==='boolean'?flag:at(f,'pipelines',id,'status')!=='unavailable');
        if(flag===true&&(!point||!visibilityValid))quality.invalidRecordedValidityClaims++;
        pipelines[id][joint]={point,valid,validitySource,reason:valid?null:text(at(f,'pipelines',id,'joints',joint,'reason'))??(!point?'missing_or_nonfinite_coordinates':!visibilityValid?'low_or_invalid_visibility':'recorded_invalid')};
      }
    }
    const statuses=Array.isArray(f.correction)?f.correction:[];
    const controllers={} as EvaluatedFrame['controllers'];
    for(const [controller,prefix,joints] of [['upperArm','ua',['rightShoulder','rightElbow']],['forearm','fa',['rightElbow','rightWrist']]] as const){
      const declared=at(f,'fusion',prefix+'State'),s=state(declared);
      const simulated=joints.some(j=>at(f,'fusion','simulated',j==='rightShoulder'?'shoulder':j==='rightElbow'?'elbow':'wrist')===true);
      const correctionUnreliable=joints.some(j=>statuses.some(x=>at(x,'joint')===j&&at(x,'reliable')===false));
      // Live-only P4 archives retain visual validity evidence without storing offline P3 output.
      const visualFlag=(j:string)=>at(f,'visualReliability',j,'valid');
      const stereoKnown=joints.every(j=>typeof visualFlag(j)==='boolean'||pipelines.P3[j].validitySource!=='unavailable');
      const failed=simulated||correctionUnreliable||joints.some(j=>typeof visualFlag(j)==='boolean'?visualFlag(j)===false:pipelines.P3[j].validitySource!=='unavailable'&&!pipelines.P3[j].valid);
      controllers[controller]={state:s,reason:text(at(f,'fusion',prefix+'FailureReason')),failureEvidence:failed?true:stereoKnown?false:null};
    }
    const imuActive=typeof f.imuCorrectionActive==='boolean'?f.imuCorrectionActive:controllers.upperArm.state!=='UNKNOWN'&&controllers.forearm.state!=='UNKNOWN'?[controllers.upperArm.state,controllers.forearm.state].some(s=>s==='IMU_CORRECTION'||s==='RECOVERY'):null;
    if(typeof f.imuCorrectionActive==='boolean'&&controllers.upperArm.state!=='UNKNOWN'&&controllers.forearm.state!=='UNKNOWN'&&f.imuCorrectionActive!==[controllers.upperArm.state,controllers.forearm.state].some(s=>s==='IMU_CORRECTION'||s==='RECOVERY'))quality.imuFlagStateDisagreements++;
    const inferenceEnd=nonnegative(at(f,'timing','inferenceCompletedPerformanceNowMs')),completed=nonnegative(f.processingCompletedPerformanceNowMs);
    const span=(a:number|null,b:number|null)=>a!==null&&b!==null&&b>=a?b-a:null;
    const calibratedLengths:EvaluatedFrame['calibratedLengths']={};
    for(const [segment,controller,key] of [['rightUpperArm','upperArm','uaLengthMm'],['rightForearm','forearm','faLengthMm']] as const){
      const recorded=at(f,'fusion','segmentLengthDiagnostics',controller,'calibratedMm');
      const fromConfig=timeMs===null&&validChanges.length?null:at(configurations[configurationIndex],'imuCalibration',key);
      if(positive(recorded))calibratedLengths[segment]=recorded;else if(positive(fromConfig)&&at(configurations[configurationIndex],'imuCalibration','quality')!=='failed')calibratedLengths[segment]=fromConfig;
    }
    return {index,cycleId,timeMs,timeSource,phase,pipelines,controllers,imuActive,
      imuActiveSource:typeof f.imuCorrectionActive==='boolean'?'recorded_flag':imuActive!==null?'controller_states':'unavailable',
      processingMs:nonnegative(f.processingDurationMs)??span(start,completed),inferenceMs:span(start,inferenceEnd),reconstructionMs:span(inferenceEnd,completed),
      pipelineProcessingMs:Object.fromEntries(PIPELINE_IDS.map(id=>[id,nonnegative(at(f,'pipelineProcessingDurationMs',id))])) as EvaluatedFrame['pipelineProcessingMs'],
      cameraConfidence:Object.fromEntries(['cameraA','cameraB'].map(camera=>[camera,Object.fromEntries(LANDMARK_KEYS.map(j=>{const value=at(f,'cameras',camera,'landmarks',j,'visibility');return [j,finite(value)&&value>=0&&value<=1?value:null];}))])) as EvaluatedFrame['cameraConfidence'],
      cameraAPresentedFrames:nonnegative(at(f,'timing','cameraAPresentation','presentedFrames')),recordedErrors:Array.isArray(f.errors)?f.errors.filter((x):x is string=>typeof x==='string'):[],geometryStatus:text(at(f,'geometry','status')),calibratedLengths,configurationIndex};
  });
  if(quality.inferredValiditySamples)warnings.push(`${quality.inferredValiditySamples} joint validity values inferred from legacy finite coordinates/visibility; explicit false validity always wins.`);
  if(quality.missingPipelineRecords)warnings.push(`${quality.missingPipelineRecords} pipeline records absent; their samples remain missing in availability denominators.`);
  if(quality.invalidRecordedValidityClaims)warnings.push(`${quality.invalidRecordedValidityClaims} recorded true-validity claims contradicted missing/nonfinite coordinates or rejected visibility; treated as invalid.`);
  if(quality.imuFlagStateDisagreements)warnings.push(`${quality.imuFlagStateDisagreements} combined IMU flags disagree with correction-or-recovery states. Recorded flags are retained; per-controller state counts are separate.`);
  if(frames.some(f=>f.phase==='unclassified'))warnings.push('Some phase classifications are unavailable. Inclusion follows includeUnclassified; measurement counts do not relabel them.');
  if(quality.missingTimestamps||quality.duplicateTimestamps||quality.nonMonotonicTimestamps)warnings.push('Missing, duplicate or non-monotonic timestamps: source order retained; affected time intervals are excluded.');
  if(durationMs!==null&&frames.some(f=>f.timeMs!==null&&f.timeMs>durationMs))warnings.push('Recorded frame timestamps exceed the declared duration. No stream is shifted or stretched.');
  const declaredCount=at(source,'diagnostics','totalProcessingCycles');
  if(finite(declaredCount)&&declaredCount!==frames.length)warnings.push(`Declared diagnostic cycle count ${declaredCount} differs from ${frames.length} archived cycles; recording completeness is uncertain.`);
  if(frames.some(f=>f.recordedErrors.length))warnings.push('Processing errors were recorded; affected cycles are retained and counted per scope.');
  if(!frames.some(f=>f.processingMs!==null))warnings.push('Processing duration unavailable; cadence cannot substitute for computational latency.');
  warnings.push('No recorded per-pipeline computational timings are synthesized. P1 continuity uses normalized image XY; P2-P4 use calibration millimeters by comparison-schema contract.');
  return {sessionId:text(source.sessionId)??'unknown-session',sourceSchema:version??'legacy-comparison',status:text(source.status),startWallClockMs:nonnegative(source.startWallClockMs),endWallClockMs:nonnegative(source.endWallClockMs),stopReason:text(source.stopReason),durationMs,warmupEndMs,frames,configurations,configurationChanges:changes,warnings,quality,
    sourceFingerprint:{algorithm:'fnv1a-32',value:fingerprint(JSON.stringify(input)),purpose:'Non-cryptographic source change detection; original recording is never rewritten.'}};
}
