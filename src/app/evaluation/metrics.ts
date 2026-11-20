import {comparativeEvaluation} from './comparative';
import {LANDMARK_KEYS} from '../hooks/useTriangulation';
import type {PipelineId} from '../type/pipelineComparison';
import type {Availability,Controller,ControllerEvent,ControllerMetrics,EvaluationConfig,EvaluationReport,ImportedSession,MotionGroup,MotionMetrics,MotionSample,ScopeMetrics,Segment,SegmentMetrics} from './types';
import {importComparisonSession,PIPELINE_IDS,SEGMENTS,STATES} from './importSession';
import {evaluationConfiguration,inAnnotation} from './configuration';
import {controllerEvents,intervalWeight,runs,selections,type Selection} from './timeline';
import {percent,statistics,at,finite,object} from './statistics';

export const METRIC_DEFINITIONS:Record<string,string>={
  availability:'100 * valid archived cycles / selected archived cycles. Explicit validity=false overrides coordinates; invalid/nonfinite coordinates and low visibility cannot be valid.',
  missingIntervals:'Consecutive selected source indices with invalid joint samples. Half-open sample-and-hold intervals end at next valid sample or phase/recording boundary. Gaps > maxObservationGapMs or invalid timing make duration unavailable; boundary runs are censored. Mean duration uses only complete uncensored runs.',
  controllerTime:'Sample-and-hold [t_i,t_(i+1)), clipped to phase/measurement bounds. No hold across nonpositive, missing or over-limit intervals. Final hold requires declared recording end. Unobserved duration is reported separately.',
  events:'Actual recorded controller transitions; initial active state is not a new activation. Events across missing controller states are not classified as observed correction entries. Phases are user annotations, never inferred from states.',
  activationLatency:'Positive sampled lag is reported only after an observable failure onset with contiguous valid timing. Same-cycle failure and correction has unknown sub-cycle latency, not measured zero. This is not exposure-to-output latency.',
  anatomical:'Euclidean native 3D lengths for both arms in P2-P4, in calibration mm. Calibrated reference uses recorded per-frame calibratedMm or active imuCalibration, never learned FK length as ground truth. State groups condition on the recorded P4 controller, including for P2/P3.',
  dispersion:'Population SD sqrt(sum((x-mean)^2)/N); MAD median(abs(x-median)); IQR Q75-Q25. Quantiles use linear interpolation at p*(N-1). Empty results are null.',
  continuity:'Only consecutive valid source samples with 0 < dt <= maxObservationGapMs. Displacement is Euclidean XYZ for P2-P4, normalized XY only for P1. Speed=displacement/(dt/1000). No interpolation or bridging missing cycles.',
  transitions:'Activation/recovery neighborhoods are +/- transitionWindowMs around recorded state transitions affecting that joint. Recovery neighborhoods include entry and exit. Ordinary motion excludes both neighborhoods. Large jumps are screening thresholds, not proven errors.',
  performance:'Effective FPS=number of positive consecutive selected intervals / sum(interval seconds). Cadence and computational processing duration are separate. Per-pipeline duration remains null unless explicitly recorded. ID/presentation gaps are indicators, not confirmed dropped encoded frames.',
  phases:'Annotations use [start,end) experiment milliseconds or absolute zero-based source frame indices. Motion, visibility, recovery and custom layers may overlap each other; intervals within each layer are disjoint. Warmup excluded by default; unclassified inclusion is explicit. Whole and all per-phase reports use identical formulas/configuration.',
  limitations:'No independent ground truth: availability, continuity, anatomical consistency and processing behavior do not establish absolute positional accuracy. P1 normalized XY is not directly comparable to metric 3D displacements or lengths.',
};

function availability(s:ImportedSession,selection:Selection,c:EvaluationConfig,id:PipelineId,joint:typeof LANDMARK_KEYS[number]):Availability {
  const valid=selection.indices.filter(i=>s.frames[i].pipelines[id][joint].valid).length;
  const missingIntervals=runs(s,selection,c,f=>!f.pipelines[id][joint].valid);
  return {validFrames:valid,missingFrames:selection.indices.length-valid,availabilityPercent:percent(valid,selection.indices.length),missingIntervals,
    longestMissingIntervalMs:statistics(missingIntervals.map(r=>r.durationMs)).max,
    meanCompleteMissingIntervalMs:statistics(missingIntervals.filter(r=>!r.leftCensored&&!r.rightCensored).map(r=>r.durationMs)).mean};
}
function controllerMetrics(s:ImportedSession,selection:Selection,c:EvaluationConfig,controller:Controller,events:ControllerEvent[]):ControllerMetrics {
  const selected=new Set(selection.indices),stateFrames=Object.fromEntries(STATES.map(state=>[state,0])) as ControllerMetrics['stateFrames'],stateTimeMs={...stateFrames};
  for(const i of selection.indices){const state=s.frames[i].controllers[controller].state;stateFrames[state]++;stateTimeMs[state]+=intervalWeight(s,i,selection,c);}
  const own=events.filter(e=>e.controller===controller&&selected.has(e.index)),activations=own.filter(e=>e.kind==='correction_activation');
  const correctionEpisodes=runs(s,selection,c,f=>f.controllers[controller].state==='IMU_CORRECTION'),recoveryEpisodes=runs(s,selection,c,f=>f.controllers[controller].state==='RECOVERY');
  const reasons:Record<string,number>={};for(const e of activations)reasons[e.reason??'reason_unavailable']=(reasons[e.reason??'reason_unavailable']??0)+1;
  const healthy=selection.indices.filter(i=>c.annotations.some(a=>a.healthyVisibility&&inAnnotation(s.frames[i],a)));
  const coveredTimeMs=Object.values(stateTimeMs).reduce((sum,v)=>sum+v,0);
  const completed=(episodes:typeof correctionEpisodes)=>episodes.filter(r=>!r.leftCensored&&!r.rightCensored).map(r=>r.durationMs);
  const failedRecoveries=recoveryEpisodes.filter(r=>!r.rightCensored&&['IMU_CORRECTION','UNAVAILABLE'].includes(s.frames[r.endIndexExclusive]?.controllers[controller].state));
  return {stateFrames,stateTimeMs:coveredTimeMs>0?stateTimeMs:Object.fromEntries(STATES.map(state=>[state,null])) as ControllerMetrics['stateTimeMs'],coveredTimeMs:coveredTimeMs>0?coveredTimeMs:null,unobservedTimeMs:selection.windowMs!==null?Math.max(0,selection.windowMs-coveredTimeMs):null,
    correctionActivations:activations.length,activationReasons:reasons,activationLatenciesMs:statistics(activations.map(e=>e.failureToActivationMs)),
    correctionFramePercent:percent(stateFrames.IMU_CORRECTION,selection.indices.length),imuInfluenceFramePercent:percent(stateFrames.IMU_CORRECTION+stateFrames.RECOVERY,selection.indices.length),
    activationsDuringAnnotatedHealthy:healthy.length?activations.filter(e=>e.annotatedHealthy).length:null,healthyAnnotatedFrames:healthy.length,
    correctionEpisodes,recoveryEpisodes,correctionDurationMs:statistics(completed(correctionEpisodes)),recoveryDurationMs:statistics(completed(recoveryEpisodes)),
    interruptedRecoveries:failedRecoveries.filter(r=>s.frames[r.endIndexExclusive].controllers[controller].state==='IMU_CORRECTION').length,
    unsuccessfulRecoveries:failedRecoveries.length,censoredRecoveries:recoveryEpisodes.filter(r=>r.leftCensored||r.rightCensored).length};
}
function anatomical(s:ImportedSession,selection:Selection,c:EvaluationConfig,id:PipelineId,segment:Segment):SegmentMetrics {
  const definition=SEGMENTS[segment],values:Array<{length:number;ref:number|null;deviation:number|null;fraction:number|null;state:typeof STATES[number]|null}>=[];
  for(const i of selection.indices){const f=s.frames[i],a=f.pipelines[id][definition.joints[0]],b=f.pipelines[id][definition.joints[1]];
    if(!a.valid||!b.valid)continue;
    const length=Math.hypot(a.point!.x-b.point!.x,a.point!.y-b.point!.y,a.point!.z-b.point!.z);
    if(!finite(length))continue;
    const ref=f.calibratedLengths[segment]??null;
    values.push({length,ref,deviation:ref!==null?length-ref:null,fraction:ref!==null?Math.abs(length-ref)/ref:null,state:definition.controller?f.controllers[definition.controller].state:null});
  }
  const withReference=values.filter(v=>v.ref!==null),exceeds=withReference.filter(v=>v.fraction!>c.lengthDeviationThresholdFraction).length;
  return {eligibleFrames:selection.indices.length,validLengthFrames:values.length,missingLengthFrames:selection.indices.length-values.length,
    lengthMm:statistics(values.map(v=>v.length)),calibratedReferenceMm:statistics(values.map(v=>v.ref)),deviationMm:statistics(values.map(v=>v.deviation)),absoluteDeviationFraction:statistics(values.map(v=>v.fraction)),
    framesWithReference:withReference.length,exceedingThresholdFrames:exceeds,exceedingThresholdPercent:percent(exceeds,withReference.length),
    byControllerState:definition.controller?Object.fromEntries(STATES.map(state=>{const group=values.filter(v=>v.state===state);return[state,{count:group.length,lengthMm:statistics(group.map(v=>v.length)),deviationMm:statistics(group.map(v=>v.deviation))}];})):{} };
}
function motion(s:ImportedSession,selection:Selection,c:EvaluationConfig,id:PipelineId,joint:typeof LANDMARK_KEYS[number],events:ControllerEvent[]):MotionMetrics {
  const samples:MotionSample[]=[];let excludedNonAdjacentOrInvalid=0,excludedTimingGaps=0;
  const affects=events.filter(e=>(e.controller==='upperArm'&&['rightShoulder','rightElbow','rightWrist'].includes(joint))||(e.controller==='forearm'&&joint==='rightWrist'));
  const near=(time:number,kind:'activation'|'recovery')=>affects.some(e=>e.timeMs!==null&&Math.abs(e.timeMs-time)<=c.transitionWindowMs&&(kind==='activation'?e.kind==='correction_activation':e.kind==='recovery_entry'||e.from==='RECOVERY'));
  for(let n=1;n<selection.indices.length;n++){
    const i=selection.indices[n],previous=selection.indices[n-1],a=s.frames[previous],b=s.frames[i],pa=a.pipelines[id][joint],pb=b.pipelines[id][joint];
    if(i!==previous+1||!pa.valid||!pb.valid){excludedNonAdjacentOrInvalid++;continue;}
    const dt=a.timeMs!==null&&b.timeMs!==null?b.timeMs-a.timeMs:null;
    if(dt===null||dt<=0||dt>c.maxObservationGapMs){excludedTimingGaps++;continue;}
    const displacement=Math.hypot(pb.point!.x-pa.point!.x,pb.point!.y-pa.point!.y,...(id==='P1'?[]:[pb.point!.z-pa.point!.z]));
    if(!finite(displacement)){excludedNonAdjacentOrInvalid++;continue;}
    samples.push({index:i,timeMs:b.timeMs,elapsedMs:dt,displacement,speed:displacement/(dt/1000),nearActivation:near(b.timeMs!,'activation'),nearRecovery:near(b.timeMs!,'recovery')});
  }
  const distance=id==='P1'?c.jumpDistanceNormalizedXY:c.jumpDistanceMm,speed=id==='P1'?c.jumpSpeedNormalizedXYPerSecond:c.jumpSpeedMmPerSecond;
  const group=(data:MotionSample[]):MotionGroup=>({intervals:data.length,displacement:statistics(data.map(d=>d.displacement)),speed:statistics(data.map(d=>d.speed)),largeDisplacementCount:data.filter(d=>d.displacement>distance).length,largeSpeedCount:data.filter(d=>d.speed!==null&&d.speed>speed).length});
  return {units:id==='P1'?'normalized_image_xy':'mm',speedUnits:id==='P1'?'normalized_image_xy/s':'mm/s',overall:group(samples),ordinary:group(samples.filter(d=>!d.nearActivation&&!d.nearRecovery)),nearActivation:group(samples.filter(d=>d.nearActivation)),nearRecovery:group(samples.filter(d=>d.nearRecovery)),samples,excludedNonAdjacentOrInvalid,excludedTimingGaps};
}
function evaluateScope(s:ImportedSession,selection:Selection,c:EvaluationConfig,events:ControllerEvent[]):ScopeMetrics {
  const selected=selection.indices.map(i=>s.frames[i]);
  const availabilityByPipeline=Object.fromEntries(PIPELINE_IDS.map(id=>[id,Object.fromEntries(LANDMARK_KEYS.map(j=>[j,availability(s,selection,c,id,j)]))])) as ScopeMetrics['availability'];
  const comparison=Object.fromEntries(LANDMARK_KEYS.map(j=>{
    let bothValid=0,bothInvalid=0,recoveredByP4=0,lostByP4=0;
    for(const f of selected){const a=f.pipelines.P3[j].valid,b=f.pipelines.P4[j].valid;if(a&&b)bothValid++;else if(!a&&!b)bothInvalid++;else if(b)recoveredByP4++;else lostByP4++;}
    return[j,{bothValid,bothInvalid,recoveredByP4,lostByP4,improvementPercentagePoints:percent(recoveredByP4-lostByP4,selected.length)}];
  })) as ScopeMetrics['p3VersusP4'];
  const times=selected.map(f=>f.timeMs).filter(finite),intervals:number[]=[];let skippedCycleIdIndicators=0,skippedCameraAPresentationIndicators=0,largeObservationGaps=0;
  for(let n=1;n<selected.length;n++){const a=selected[n-1],b=selected[n];if(b.index!==a.index+1)continue;
    if(a.timeMs!==null&&b.timeMs!==null&&b.timeMs>a.timeMs){const dt=b.timeMs-a.timeMs;intervals.push(dt);if(dt>c.maxObservationGapMs)largeObservationGaps++;}
    if(a.cycleId!==null&&b.cycleId!==null&&b.cycleId>a.cycleId+1)skippedCycleIdIndicators+=b.cycleId-a.cycleId-1;
    if(a.cameraAPresentedFrames!==null&&b.cameraAPresentedFrames!==null&&b.cameraAPresentedFrames>a.cameraAPresentedFrames+1)skippedCameraAPresentationIndicators+=Math.floor(b.cameraAPresentedFrames-a.cameraAPresentedFrames-1);
  }
  const span=intervals.reduce((sum,v)=>sum+v,0),active=selected.filter(f=>f.imuActive===true).length,known=selected.filter(f=>f.imuActive!==null).length;
  return {id:selection.id,label:selection.label,annotation:selection.annotation,frameCount:selected.length,frameIndices:selection.indices,selectedWindowMs:selection.windowMs,firstTimestampMs:times[0]??null,lastTimestampMs:times.at(-1)??null,
    dataQuality:{missingTimestampCycles:selected.filter(f=>f.timeMs===null).length,unknownControllerCycles:selected.filter(f=>f.controllers.upperArm.state==='UNKNOWN'||f.controllers.forearm.state==='UNKNOWN').length,recordedErrorCycles:selected.filter(f=>f.recordedErrors.length>0).length,invalidGeometryCycles:selected.filter(f=>f.geometryStatus==='invalid_calibration_or_capture').length},
    availability:availabilityByPipeline,p3VersusP4:comparison,controllers:{upperArm:controllerMetrics(s,selection,c,'upperArm',events),forearm:controllerMetrics(s,selection,c,'forearm',events)},imuActiveFrames:active,imuActiveKnownFrames:known,imuActivePercent:percent(active,known),
    anatomical:Object.fromEntries((['P2','P3','P4'] as const).map(id=>[id,Object.fromEntries((Object.keys(SEGMENTS) as Segment[]).map(segment=>[segment,anatomical(s,selection,c,id,segment)]))])) as ScopeMetrics['anatomical'],
    motion:Object.fromEntries(PIPELINE_IDS.map(id=>[id,Object.fromEntries(LANDMARK_KEYS.map(j=>[j,motion(s,selection,c,id,j,events)]))])) as ScopeMetrics['motion'],
    performance:{effectiveFps:intervals.length&&span>0?intervals.length*1000/span:null,observationSpanMs:times.length>=2&&times.at(-1)!>times[0]?times.at(-1)!-times[0]:null,
      frameIntervalsMs:statistics(intervals),processingDurationMs:statistics(selected.map(f=>f.processingMs)),inferenceSpanMs:statistics(selected.map(f=>f.inferenceMs)),postInferenceSpanMs:statistics(selected.map(f=>f.reconstructionMs)),
      perPipelineDurationMs:Object.fromEntries(PIPELINE_IDS.map(id=>[id,statistics(selected.map(f=>f.pipelineProcessingMs[id]))])) as ScopeMetrics['performance']['perPipelineDurationMs'],
      skippedCycleIdIndicators,skippedCameraAPresentationIndicators,largeObservationGaps}};
}

/** Pure, deterministic and hardware-free. Does not rerun reconstruction or fusion. */
export function evaluateSession(input:unknown,overrides:Partial<EvaluationConfig>={}):EvaluationReport {
  const session=importComparisonSession(input),embedded=at(input,'evaluationMetadata','schemaVersion')==='1.0.0-comparative-annotations'?object(at(input,'evaluationMetadata','config')) as Partial<EvaluationConfig>:{},config=evaluationConfiguration({...embedded,...overrides},session),events=controllerEvents(session,config);
  const scopes=selections(session,config).map(selection=>evaluateScope(session,selection,config,events));
  const warnings=[...session.warnings,
    'Controller durations use bounded sample-and-hold estimates; observation gaps and censoring limit event-duration claims.',
    'Healthy-visibility activation counts require explicit user annotations; controller STEREO does not establish healthy visibility.',
    'Joint displacement, speed and length inconsistency can reflect real movement or observation errors; thresholds do not establish algorithmic error.',
    'No absolute 3D positional accuracy claim is supported without independent ground truth.'];
  if(session.frames.some(f=>f.controllers.upperArm.state==='UNKNOWN'||f.controllers.forearm.state==='UNKNOWN'))warnings.push('Missing/unknown controller states limit activation and recovery analysis; no controller states were reconstructed.');
  if(session.status!=='stopped')warnings.push('Recording is open or its completion status is unavailable; recorded cycles are evaluated without assuming complete capture.');
  const versions=session.configurations.map(c=>at(c,'stereoGeometry','method')).filter(x=>typeof x==='string');
  if(!versions.length)warnings.push('Geometry version was not recorded. Older recordings may use the earlier raw/rectified geometry mismatch; no current version was substituted.');
  if(session.frames.length&&!session.frames.some(f=>Object.keys(f.calibratedLengths).length))warnings.push('Recorded calibrated arm lengths are unavailable; deviation-from-calibration metrics remain null.');
  const report:EvaluationReport={schemaVersion:'1.0.0-offline-evaluation',engineVersion:'1.1.0',config,
    source:{sessionId:session.sessionId,schema:session.sourceSchema,fingerprint:session.sourceFingerprint},
    summary:{durationMs:session.durationMs,startWallClockMs:session.startWallClockMs,endWallClockMs:session.endWallClockMs,stopReason:session.stopReason,totalCycles:session.frames.length,warmupCycles:session.frames.filter(f=>f.phase==='warmup').length,measurementCycles:session.frames.filter(f=>f.phase==='measurement').length,unclassifiedCycles:session.frames.filter(f=>f.phase==='unclassified').length,status:session.status,
      completeness:!session.frames.length?'empty':session.status!=='stopped'?'completion_unverified':session.quality.malformedFrames?'stopped_with_malformed_cycles':session.quality.missingPipelineRecords?'stopped_with_missing_pipeline_records':'stopped_archived_cycles_only'},
    configurations:session.configurations,configurationChanges:session.configurationChanges,quality:session.quality,warnings:[...new Set(warnings)],definitions:METRIC_DEFINITIONS,scopes,events,frames:session.frames,comparative:comparativeEvaluation(session,config)};
  // No NaN/Infinity literals escape into machine-readable exports.
  return JSON.parse(JSON.stringify(report,(_key,value)=>typeof value==='number'&&!Number.isFinite(value)?null:value));
}
