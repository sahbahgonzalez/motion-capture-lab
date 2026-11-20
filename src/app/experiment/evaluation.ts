import type {ExperimentalSession,ExperimentPipeline,OfflineResult,OfflineSample,LiveP4Sample} from './types';
import type {EvaluationReport,EvaluationConfig} from '../evaluation/types';
import {evaluateSession} from '../evaluation/metrics';
import {statistics,percent,finite} from '../evaluation/statistics';
import {SEGMENTS} from '../evaluation/importSession';
import {LANDMARK_KEYS} from '../hooks/useTriangulation';

export function mappingCurrent(session:ExperimentalSession,result:OfflineResult){return JSON.stringify(session.cameraMapping)===JSON.stringify(result.cameraMapping);}
/** Internal adapter only. Absent pipelines are not persisted or presented as failures. */
export function independentSource(session:ExperimentalSession,id:ExperimentPipeline){
  const result=id==='P4'?null:session.offline[id];
  if(id!=='P4'&&!result)throw Error(id+' has not been processed.');
  const samples=id==='P4'?session.liveP4:result!.samples.filter(s=>!result!.cameraMapping.cameraA||s.experimentTimeMs===null||s.experimentTimeMs>=0&&(session.durationMs===null||s.experimentTimeMs<=session.durationMs));
  const experimentClock=id==='P4'||!!result!.cameraMapping.cameraA;
  return {schemaVersion:'1.0.0-live-pipeline-comparison',sessionId:session.sessionId,status:session.status==='recording'?'recording':'stopped',durationMs:experimentClock?session.durationMs:(result!.samples.length?result!.samples.at(-1)!.cameraAMediaTimeSeconds*1000:null),
    startWallClockMs:session.startWallClockMs,endWallClockMs:session.stopWallClockMs,warmupEndExperimentTimeMs:experimentClock?session.warmupEndExperimentTimeMs:null,
    metadata:{...(session.configuration as object),evaluationProvenance:{pipeline:id,origin:id==='P4'?'original_live_P4':'offline_visual_from_same_P4_session',clock:experimentClock?'experiment_clock_with_declared_mapping':'camera_A_file_media_clock; experiment alignment unresolved',availablePipelines:[id],performance:id==='P4'?'live shared camera/reconstruction/fusion span; not exclusive P4 compute':'offline playback processing duration; never live performance'}},
    configurationChanges:id==='P4'?session.configurationChanges:[],
    frames:samples.map((raw,index)=>{
      const live=id==='P4'?raw as LiveP4Sample:null,offline=id!=='P4'?raw as OfflineSample:null;
      const time=live?live.experimentTimeMs:experimentClock?offline!.experimentTimeMs:offline!.cameraAMediaTimeSeconds*1000;
      return {cycleId:live?.cycleId??index,experimentTimeMs:time,phase:experimentClock&&time!==null?(time<session.warmupEndExperimentTimeMs?'warmup':'measurement'):'unclassified',
        pipelines:{[id]:live?.output??offline!.output},fusion:live?.fusion??null,correction:live?.correction??[],visualReliability:live?.visualReliability,
        ...(live?{timing:live.cameraObservationTiming}:{}),
        ...(live?.fusion?{imuCorrectionActive:['IMU_CORRECTION','RECOVERY'].includes(live.fusion?.uaState??'')||['IMU_CORRECTION','RECOVERY'].includes(live.fusion?.faState??'')}:{}),
        pipelineProcessingDurationMs:offline?{[id]:offline.playbackProcessingDurationMs}:undefined,
        processingDurationMs:live?live.liveSharedProcessingDurationMs:offline!.playbackProcessingDurationMs,errors:live?.errors??offline!.errors};
    })};
}
export function independentProjection(report:EvaluationReport,id:ExperimentPipeline){
  return {schemaVersion:'1.0.0-independent-experimental-evaluation',sessionId:report.source.sessionId,pipeline:id,origin:id==='P4'?'live':'offline',source:report.source,config:report.config,summary:{...report.summary,completeness:report.summary.totalCycles?'native_pipeline_observations_only; inspect experimental capture and run status':'empty'},
    warnings:[...report.warnings.filter(w=>!w.includes('pipeline records absent')),'Only '+id+' is evaluated in this independent report. Other pipelines are absent, not failed observations.'],definitions:report.definitions,
    scopes:report.scopes.map(s=>({id:s.id,label:s.label,annotation:s.annotation,frameCount:s.frameCount,frameIndices:s.frameIndices,dataQuality:s.dataQuality,
      availability:s.availability[id],motion:s.motion[id],anatomical:id==='P1'?null:s.anatomical[id],
      controllers:id==='P4'?s.controllers:null,imuActiveFrames:id==='P4'?s.imuActiveFrames:null,performance:{...s.performance,provenance:id==='P4'?'live_shared_processing':'offline_playback_processing',perPipelineDurationMs:{[id]:s.performance.perPipelineDurationMs[id]}}})),
    events:id==='P4'?report.events:[],configurations:report.configurations,configurationChanges:report.configurationChanges};
}
export interface TimestampMatch {offlineIndex:number;liveIndex:number;offlineTimeMs:number;liveTimeMs:number;offsetMs:number;}
/** Monotonic one-to-one nearest matching. No interpolation and no validity filtering. */
export function matchTimestamps(offline:Array<number|null>,live:Array<number|null>,toleranceMs:number){
  if(!finite(toleranceMs)||toleranceMs<0)throw Error('Alignment tolerance must be finite and non-negative.');
  const monotonic=(times:Array<number|null>)=>{let previous=-Infinity;for(const time of times){if(time===null)continue;if(!finite(time)||time<previous)return false;previous=time;}return true;};
  if(!monotonic(offline)||!monotonic(live))throw Error('Non-monotonic alignment timestamps; source order is not silently sorted.');
  const available=offline.map((time,index)=>({time,index})).filter(x=>x.time!==null&&finite(x.time));
  let cursor=0;const matches:TimestampMatch[]=[];
  for(let i=0;i<live.length;i++){const time=live[i];if(time===null||!finite(time))continue;
    while(cursor<available.length&&available[cursor].time!<time-toleranceMs)cursor++;
    let candidate=cursor;
    while(candidate+1<available.length&&Math.abs(available[candidate+1].time!-time)<Math.abs(available[candidate].time!-time))candidate++;
    if(candidate<available.length&&Math.abs(available[candidate].time!-time)<=toleranceMs){const a=available[candidate];matches.push({offlineIndex:a.index,liveIndex:i,offlineTimeMs:a.time!,liveTimeMs:time,offsetMs:a.time!-time});cursor=candidate+1;}
  }
  return {matches,unmatchedOffline:offline.length-matches.length,unmatchedLive:live.length-matches.length,liveCoveragePercent:percent(matches.length,live.length),offlineCoveragePercent:percent(matches.length,offline.length),offsetMs:statistics(matches.map(m=>m.offsetMs))};
}
function pairedSummary(session:ExperimentalSession,annotation:ExperimentalSession['annotations'][number]|null=null){
  const result=session.offline.P3;
  const unavailable=(reason:string)=>({available:false,reason,matches:[] as TimestampMatch[],matchedSamples:0,unmatchedLive:session.liveP4.length,unmatchedOffline:result?.samples.length??0,liveCoveragePercent:null,offlineCoveragePercent:null,joints:null,segmentDifferences:null,continuityDifferences:null});
  if(!result)return unavailable('P3 offline processing is missing. Independent live P4 metrics remain available.');
  if(!mappingCurrent(session,result))return unavailable('Video clock mapping changed after P3 processing; rerun P3.');
  if(!result.cameraMapping.cameraA||!result.cameraMapping.cameraB)return unavailable('Encoded video-to-experiment mapping unresolved. No paired comparison is claimed.');
  if(!session.alignment.allowEstimated&&[result.cameraMapping.cameraA,result.cameraMapping.cameraB].some(m=>m.provenance==='estimated_recorder_start'))return unavailable('Estimated mapping requires explicit opt-in before paired metrics.');
  const config=session.evaluationConfigurations.P4??{},gap=config.maxObservationGapMs??250;
  const eligible=(time:number|null)=>time!==null&&(config.includeWarmup||time>=session.warmupEndExperimentTimeMs)&&(session.durationMs===null||time<=session.durationMs)&&time>=0&&(!annotation||annotation.coordinate==='time_ms'&&time>=annotation.start&&time<annotation.end);
  let full:ReturnType<typeof matchTimestamps>;
  try{full=matchTimestamps(result.samples.map(s=>s.experimentTimeMs),session.liveP4.map(s=>s.experimentTimeMs),session.alignment.toleranceMs);}catch(e){return unavailable(String(e));}
  const matches=full.matches.filter(m=>eligible(m.offlineTimeMs)&&eligible(m.liveTimeMs));
  const offlineCount=result.samples.filter(s=>eligible(s.experimentTimeMs)).length,liveCount=session.liveP4.filter(s=>eligible(s.experimentTimeMs)).length;
  const matched={matches,unmatchedOffline:offlineCount-matches.length,unmatchedLive:liveCount-matches.length,liveCoveragePercent:percent(matches.length,liveCount),offlineCoveragePercent:percent(matches.length,offlineCount),offsetMs:statistics(matches.map(m=>m.offsetMs))};
  const validJoint=(output:OfflineSample['output'],joint:typeof LANDMARK_KEYS[number])=>{const p=output.pose[joint];return output.joints[joint]?.valid===true&&!!p&&[p.x,p.y,p.z].every(finite)&&(p.visibility===undefined||finite(p.visibility)&&p.visibility>=.5);};
  const joints=Object.fromEntries(LANDMARK_KEYS.map(j=>{
    let bothValid=0,bothInvalid=0,recoveredByP4=0,lostByP4=0;
    for(const m of matched.matches){const a=validJoint(result.samples[m.offlineIndex].output,j),b=validJoint(session.liveP4[m.liveIndex].output,j);if(a&&b)bothValid++;else if(!a&&!b)bothInvalid++;else if(b)recoveredByP4++;else lostByP4++;}
    return [j,{bothValid,bothInvalid,recoveredByP4,lostByP4,improvementPercentagePoints:percent(recoveredByP4-lostByP4,matched.matches.length)}];
  }));
  const length=(output:OfflineSample['output'],segment:keyof typeof SEGMENTS)=>{const [a,b]=SEGMENTS[segment].joints;const p=output.pose[a],q=output.pose[b];return validJoint(output,a)&&validJoint(output,b)&&p&&q?Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z):null;};
  const segmentDifferences=Object.fromEntries((Object.keys(SEGMENTS) as Array<keyof typeof SEGMENTS>).map(segment=>[segment,statistics(matched.matches.map(m=>{const a=length(result.samples[m.offlineIndex].output,segment),b=length(session.liveP4[m.liveIndex].output,segment);return a!==null&&b!==null?b-a:null;}))]));
  const continuityDifferences=Object.fromEntries(LANDMARK_KEYS.map(j=>{
    const displacementDifferences:number[]=[],speedDifferences:number[]=[];
    for(let n=1;n<matched.matches.length;n++){const a=matched.matches[n-1],b=matched.matches[n];if(b.offlineIndex!==a.offlineIndex+1||b.liveIndex!==a.liveIndex+1)continue;
      const outputs=[result.samples[a.offlineIndex].output,result.samples[b.offlineIndex].output,session.liveP4[a.liveIndex].output,session.liveP4[b.liveIndex].output];if(outputs.some(o=>!validJoint(o,j)))continue;
      const p=outputs.map(o=>o.pose[j]!);const dist=(a:typeof p[number],b:typeof p[number])=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
      const offlineDt=b.offlineTimeMs-a.offlineTimeMs,liveDt=b.liveTimeMs-a.liveTimeMs;
      if(offlineDt<=0||liveDt<=0||offlineDt>gap||liveDt>gap)continue;
      const da=dist(p[0],p[1]),db=dist(p[2],p[3]);displacementDifferences.push(db-da);speedDifferences.push(db/(liveDt/1000)-da/(offlineDt/1000));
    }
    return [j,{displacementDifferenceMm:statistics(displacementDifferences),speedDifferenceMmPerSecond:statistics(speedDifferences),definition:'P4 minus P3, only adjacent native observations on both timelines; each speed uses its own elapsed time. Not positional accuracy.'}];
  }));
  return {available:true,reason:'Matched P3 offline / P4 live observations; mappings are declared/estimated, not hardware verified.',...matched,matchedSamples:matched.matches.length,joints,segmentDifferences,continuityDifferences};
}
export function evaluateExperimentalSession(session:ExperimentalSession){
  const independent:Partial<Record<ExperimentPipeline,ReturnType<typeof independentProjection>>>={};
  for(const id of ['P1','P2','P3','P4'] as const){if(id!=='P4'&&!session.offline[id])continue;
    const configuration:Partial<EvaluationConfig>={...session.evaluationConfigurations[id]};
    if(!configuration.annotations&&(id==='P4'||session.offline[id]?.cameraMapping.cameraA))configuration.annotations=session.annotations;
    independent[id]=independentProjection(evaluateSession(independentSource(session,id),configuration),id);
  }
  return {schemaVersion:'1.0.0-experimental-evaluation',sessionId:session.sessionId,workflow:'P4 live; P1-P3 offline camera recordings from the same movement',captureStatus:session.status,pairedScopeDefinition:'Measurement by default; warmup inclusion follows P4 evaluation configuration. Shared phase intervals use experiment milliseconds on both timelines. Native frame-index annotations are never transferred between pipelines.',
    pipelineStatus:Object.fromEntries((['P1','P2','P3','P4'] as const).map(id=>[id,id==='P4'?session.liveP4.length?'live outputs retained':'missing':session.offline[id]?.status??'not_processed'])),
    independent,alignedP3P4:pairedSummary(session),alignedPhases:session.annotations.filter(a=>a.coordinate==='time_ms').map(annotation=>({annotation,...pairedSummary(session,annotation)})),alignmentPolicy:session.alignment,annotations:session.annotations,limitations:session.limitations};
}
