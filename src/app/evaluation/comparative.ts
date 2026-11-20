import type {Annotation,EvaluationConfig,ImportedSession,EvaluatedFrame,Joint,Stats} from './types';
import type {PipelineId} from '../type/pipelineComparison';
import {PIPELINE_IDS} from './importSession';
import {annotationWindow,inAnnotation} from './configuration';
import {finite,statistics,percent,object} from './statistics';
import {resolveShoulderWidths,shoulderWidth} from '../utils/bodyScale';
import {projectRawPoint} from '../utils/stereoGeometry';
import type {IntrinsicCalibration} from '../type/calibration';
export type Representation='native'|'body3d'|'common2d';
export interface Observation {index:number;cycleId:number|null;timeMs:number|null;point:number[]|null;width:number|null;configurationIndex:number;widthSource?:'observed'|'carried'|'leading_fill'|'unavailable';}
export interface DerivativeSample {index:number;timeMs:number;displacement:number;velocity:number[];speed:number;velocityTimeMs:number;acceleration:number[]|null;accelerationMagnitude:number|null;accelerationTimeMs:number|null;jerk:number[]|null;jerkMagnitude:number|null;}
export interface TraceMetrics {
  units:string;observationUnits:string;normalizationReferenceUnits:string;dimensions:number;available:boolean;reason:string|null;selectedCycles:number;validSamples:number;availabilityPercent:number|null;durationMs:number|null;
  normalizationReference:Stats;normalizationMissingSamples:number;normalizationObservedSamples:number;normalizationCarriedSamples:number;normalizationPolicy:string;
  meanPosition:number[]|null;rms:number|null;axisStdDev:number[]|null;
  displacement:Stats;speed:Stats;acceleration:Stats;jerk:Stats;pathLength:number|null;amplitude:number|null;
  largeDisplacements:number;largeSpeeds:number;constantIntervals:number;constantDurationMs:number;
  warnings:string[];observations:Observation[];samples:DerivativeSample[];
}
export interface PairMetrics {pipelines:[PipelineId,PipelineId];available:boolean;reason:string|null;commonSamples:number;commonCoveragePercent:number|null;commonIndices:number[];coordinateDifference:Stats;exactlyIdentical:number;different:number;first:TraceMetrics;second:TraceMetrics;rmsDifference:number|null;rmsReductionPercent:number|null;amplitudeRatio:number|null;pathLengthRatio:number|null;relativeFreezeIntervals:number;delay:{lagMs:number|null;correlation:number|null;matchedSamples:number;reason:string;method:string};}
export interface ComparativePhase {annotation:Annotation;kind:'stationary'|'moving';durationMs:number|null;selectedCycles:number;representations:Record<Representation,{independent:Record<PipelineId,TraceMetrics>;pairs:PairMetrics[];common:{pipelines:PipelineId[];indices:number[];metrics:Record<PipelineId,TraceMetrics>}}>;}
export interface ComparativeReport {joint:Joint;phases:ComparativePhase[];warnings:string[];definitions:Record<string,string>;configuration:ReturnType<typeof comparativeConfiguration>;}
export function comparativeConfiguration(c:EvaluationConfig){return {joint:c.comparative?.joint??'rightWrist' as Joint,stationaryIds:c.comparative?.stationaryIds,movingIds:c.comparative?.movingIds,visibility:c.comparative?.visibility??'all',lagMaxMs:c.comparative?.lagMaxMs??500,lagStepMs:c.comparative?.lagStepMs??20,lagToleranceMs:c.comparative?.lagToleranceMs??20,freezeSpeedBodyWidthsPerSecond:c.comparative?.freezeSpeedBodyWidthsPerSecond??.001,observedMovementBodyWidthsPerSecond:c.comparative?.observedMovementBodyWidthsPerSecond??.05,jumpBodyWidths:c.comparative?.jumpBodyWidths??.25,jumpBodyWidthsPerSecond:c.comparative?.jumpBodyWidthsPerSecond??5};}
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]));
const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
export function comparisonCoordinate(f:EvaluatedFrame,id:PipelineId,joint:Joint,representation:Representation,session:ImportedSession):number[]|null{
  const sample=f.pipelines[id][joint];if(!sample.valid||!sample.point)return null;
  const p=sample.point;
  if(representation==='body3d'&&id==='P1')return null;
  if(representation!=='common2d')return id==='P1'?[p.x,p.y]:[p.x,p.y,p.z];
  const config=object(session.configurations[f.configurationIndex]),camera=object(object(config.stereoCalibration).camera1),settings=object(config.cameraA);
  const width=finite(settings.width)&&settings.width>0?settings.width:camera.imageWidth,height=finite(settings.height)&&settings.height>0?settings.height:camera.imageHeight;
  if(!finite(width)||!finite(height)||width<=0||height<=0)return null;
  // Use one pixel plane before shoulder scaling: x/W and y/H have different
  // axis scales on non-square video. P1 inferred depth is never used here.
  if(id==='P1')return [p.x*width,p.y*height];
  if(!Array.isArray(camera.K)||!Array.isArray(camera.distortion)||!finite(camera.imageWidth)||!finite(camera.imageHeight)||camera.imageWidth<=0||camera.imageHeight<=0||p.z<=0)return null;
  try{const q=projectRawPoint(p,camera as unknown as IntrinsicCalibration,width,height);return q&&[q.x,q.y].every(finite)?[q.x,q.y]:null;}catch{return null;}

}
export function comparisonObservations(frames:EvaluatedFrame[],id:PipelineId,representation:Representation,session:ImportedSession,joint:Joint):Observation[]{
  const rows=frames.map(f=>({index:f.index,cycleId:f.cycleId,timeMs:f.timeMs,configurationIndex:f.configurationIndex,point:comparisonCoordinate(f,id,joint,representation,session),width:shoulderWidth(comparisonCoordinate(f,id,'leftShoulder',representation,session),comparisonCoordinate(f,id,'rightShoulder',representation,session))}));
  const widths=resolveShoulderWidths(rows.map(r=>r.width));
  const first=rows.findIndex(row=>row.width!==null);
  return rows.map((row,i)=>({...row,width:widths[i],widthSource:row.width!==null?'observed' as const:widths[i]===null?'unavailable' as const:i<first?'leading_fill' as const:'carried' as const}));
}
export function analyzeTrace(rows:Observation[],id:PipelineId,representation:Representation,c:EvaluationConfig,durationMs:number|null,kind:'stationary'|'moving'):TraceMetrics{
  const settings=comparativeConfiguration(c),normalized=representation!=='native',dimensions=representation==='common2d'||id==='P1'?2:3;
  const units=normalized?'body_widths':id==='P1'?'normalized_image_xy':'mm';
  const eligible=rows.map(row=>({...row,point:row.point&&(!normalized||row.width!==null)?row.point:null}));
  const valid=eligible.filter(r=>r.point!==null),scale=normalized?mean(valid.map(r=>r.width!)):1;
  const center=valid.length?Array.from({length:dimensions},(_,i)=>mean(valid.map(r=>r.point![i]))!):null;
  const axisStdDev=valid.length>=2&&center&&scale?center.map((v,i)=>Math.sqrt(valid.reduce((sum,r)=>sum+(r.point![i]-v)**2,0)/valid.length)/scale):null;
  const rms=axisStdDev?Math.hypot(...axisStdDev):null;
  const samples:DerivativeSample[]=[];let previousVelocity:DerivativeSample|null=null,previousAcceleration:DerivativeSample|null=null;
  for(let n=1;n<eligible.length;n++){
    const a=eligible[n-1],b=eligible[n],dt=a.timeMs!==null&&b.timeMs!==null?b.timeMs-a.timeMs:null;
    if(!a.point||!b.point||b.index!==a.index+1||dt===null||dt<=0||dt>c.maxObservationGapMs||a.configurationIndex!==b.configurationIndex){previousVelocity=null;previousAcceleration=null;continue;}
    const intervalScale=normalized?(a.width!+b.width!)/2:1;
    const velocity=a.point.map((value,i)=>(b.point![i]-value)/intervalScale/(dt/1000));
    const sample:DerivativeSample={index:b.index,timeMs:b.timeMs!,displacement:distance(a.point,b.point)/intervalScale,velocity,speed:Math.hypot(...velocity),velocityTimeMs:(a.timeMs!+b.timeMs!)/2,acceleration:null,accelerationMagnitude:null,accelerationTimeMs:null,jerk:null,jerkMagnitude:null};
    if(previousVelocity){const elapsed=(sample.velocityTimeMs-previousVelocity.velocityTimeMs)/1000;
      if(elapsed>0){sample.acceleration=velocity.map((value,i)=>(value-previousVelocity!.velocity[i])/elapsed);sample.accelerationMagnitude=Math.hypot(...sample.acceleration);sample.accelerationTimeMs=(sample.velocityTimeMs+previousVelocity.velocityTimeMs)/2;
        if(previousAcceleration&&sample.accelerationTimeMs>previousAcceleration.accelerationTimeMs!){const da=(sample.accelerationTimeMs-previousAcceleration.accelerationTimeMs!)/1000;sample.jerk=sample.acceleration.map((value,i)=>(value-previousAcceleration!.acceleration![i])/da);sample.jerkMagnitude=Math.hypot(...sample.jerk);}
        previousAcceleration=sample;
      }
    }
    previousVelocity=sample;samples.push(sample);
  }
  const spread=valid.length&&scale?Math.hypot(...Array.from({length:dimensions},(_,i)=>Math.max(...valid.map(r=>r.point![i]))-Math.min(...valid.map(r=>r.point![i]))))/scale:null;
  const constant=samples.filter(s=>normalized?s.speed<=settings.freezeSpeedBodyWidthsPerSecond:s.displacement<=1e-9);
  const warnings:string[]=[];
  if(valid.length<2)warnings.push('At least two valid observations are required for positional dispersion; insufficient data is not zero jitter.');
  if(new Set(rows.map(row=>row.configurationIndex)).size>1)warnings.push('Configuration changed within this interval; derivative chains are split. Split annotations further if coordinate/calibration conventions changed.');
  if(kind==='moving')warnings.push('Lower speed, acceleration or jerk is not automatically better; inspect amplitude, path, availability and relative freeze/lag diagnostics.');
  if(kind==='moving'&&constant.length)warnings.push('Constant/near-constant intervals during an operator-labeled moving phase are screening indicators, not proof of a frozen tracker; image-plane motion may be unobservable.');
  if(id==='P1'&&representation==='native')warnings.push('P1 uses image XY; native displacement cannot be ranked against metric XYZ.');
  if(representation==='common2d')warnings.push('Common comparison is Camera A projected image-plane motion, not equivalent metric 3D motion. Recorded intrinsics/crop conventions must match capture.');
  const missingWidth=rows.filter(r=>r.point&&r.width===null).length;
  if(normalized&&missingWidth)warnings.push('Shoulder-width normalization unavailable for some observations; no scale=1 substitution.');
  return {units,observationUnits:representation==='common2d'?'camera_a_pixels':id==='P1'?'normalized_image_xy':'mm',normalizationReferenceUnits:representation==='common2d'?'camera_a_pixels':id==='P1'?'normalized_image_xy':'mm',dimensions,available:valid.length>0,reason:valid.length?null:representation==='body3d'&&id==='P1'?'P1 inferred depth is not metric 3D.':normalized?'No valid projected/3D observations with a shoulder-width reference; recorded calibration is required for stereo image-plane projection.':'No valid observations.',selectedCycles:rows.length,validSamples:valid.length,availabilityPercent:percent(valid.length,rows.length),durationMs,normalizationReference:statistics(valid.map(r=>r.width)),normalizationMissingSamples:missingWidth,normalizationObservedSamples:valid.filter(row=>row.widthSource==='observed').length,normalizationCarriedSamples:valid.filter(row=>row.widthSource==='carried'||row.widthSource==='leading_fill').length,normalizationPolicy:'Existing per-frame shoulder-width policy: previous valid width, leading fill from first valid width within this interval. Interval differences use adjacent mean width; positional dispersion and amplitude use one interval-mean width. No invented reference.',meanPosition:center,rms,axisStdDev,displacement:statistics(samples.map(s=>s.displacement)),speed:statistics(samples.map(s=>s.speed)),acceleration:statistics(samples.map(s=>s.accelerationMagnitude)),jerk:statistics(samples.map(s=>s.jerkMagnitude)),pathLength:samples.length?samples.reduce((sum,s)=>sum+s.displacement,0):null,amplitude:spread,largeDisplacements:samples.filter(s=>s.displacement>(normalized?settings.jumpBodyWidths:id==='P1'?c.jumpDistanceNormalizedXY:c.jumpDistanceMm)).length,largeSpeeds:samples.filter(s=>s.speed>(normalized?settings.jumpBodyWidthsPerSecond:id==='P1'?c.jumpSpeedNormalizedXYPerSecond:c.jumpSpeedMmPerSecond)).length,constantIntervals:constant.length,constantDurationMs:constant.reduce((sum,s)=>{const previous=rows.find(r=>r.index===s.index-1);return sum+(previous?.timeMs!==null&&previous?.timeMs!==undefined?s.timeMs-previous.timeMs:0);},0),warnings,observations:eligible,samples};
}
function relativeDelay(a:TraceMetrics,b:TraceMetrics,c:EvaluationConfig):PairMetrics['delay']{
  const settings=comparativeConfiguration(c),method='Exploratory centered trajectory correlation on timestamp-nearest, one-to-one pairs; no interpolation. Positive lag means second pipeline trails first. Not physical latency.';
  const unavailable=(reason:string)=>({lagMs:null,correlation:null,matchedSamples:0,reason,method});
  if(a.validSamples<8||b.validSamples<8||!a.amplitude||!b.amplitude||a.amplitude<=1e-9||b.amplitude<=1e-9)return unavailable('At least eight common observations and nonconstant motion in both pipelines are required.');
  const first=a.observations.filter(r=>r.point&&r.timeMs!==null),second=b.observations.filter(r=>r.point&&r.timeMs!==null);
  if([...first,...second].some((r,i,all)=>i>0&&i!==first.length&&r.timeMs!<=all[i-1].timeMs!))return unavailable('Non-increasing timestamps prevent lag estimation.');
  // Precompute contiguous validity/timing blocks once. Range scans inside every
  // lag candidate would make real recordings unnecessarily quadratic.
  const blocks=new Map<number,number>();let block=0,previous:Observation|null=null;
  for(const row of a.observations){
    if(!row.point||row.timeMs===null){block++;previous=null;continue;}
    if(previous&&(row.index!==previous.index+1||row.timeMs<=previous.timeMs!||row.timeMs-previous.timeMs!>c.maxObservationGapMs||row.configurationIndex!==previous.configurationIndex))block++;
    blocks.set(row.index,block);previous=row;
  }
  const candidates:Array<{lag:number;score:number;count:number}>=[];
  const gridLimit=Math.floor(settings.lagMaxMs/settings.lagStepMs);
  for(let step=-gridLimit;step<=gridLimit;step++){const lag=step*settings.lagStepMs;
    const pairs:Array<[number[],number[]]>=[];let cursor=0;
    for(const row of first){const target=row.timeMs!+lag;
      while(cursor<second.length&&second[cursor].timeMs!<target-settings.lagToleranceMs)cursor++;
      let n=cursor;while(n+1<second.length&&Math.abs(second[n+1].timeMs!-target)<Math.abs(second[n].timeMs!-target))n++;
      if(n<second.length&&Math.abs(second[n].timeMs!-target)<=settings.lagToleranceMs){const other=second[n];
        // Do not bridge a missing observation or a long temporal gap even in lag search.
        if(blocks.get(row.index)===blocks.get(other.index)&&blocks.has(row.index)){pairs.push([row.point!,other.point!]);cursor=n+1;}
      }
    }
    if(pairs.length<8||pairs.length<.8*Math.min(first.length,second.length))continue;
    const center=(axis:0|1)=>pairs[0][axis].map((_,i)=>mean(pairs.map(p=>p[axis][i]))!);const ca=center(0),cb=center(1);let covariance=0,va=0,vb=0;
    for(const [pa,pb] of pairs)for(let i=0;i<pa.length;i++){const x=pa[i]-ca[i],y=pb[i]-cb[i];covariance+=x*y;va+=x*x;vb+=y*y;}
    if(va>1e-18&&vb>1e-18)candidates.push({lag,score:covariance/Math.sqrt(va*vb),count:pairs.length});
  }
  candidates.sort((a,b)=>b.score-a.score||Math.abs(a.lag)-Math.abs(b.lag));const best=candidates[0];
  if(!best||best.score<.5)return unavailable('Insufficient timestamp matches or trajectory correlation.');
  if(gridLimit>0&&Math.abs(best.lag)===gridLimit*settings.lagStepMs)return unavailable('Correlation peak reaches the lag-search boundary; no bounded delay estimate is claimed.');
  if(candidates[1]&&Math.abs(best.score-candidates[1].score)<1e-9)return unavailable('Lag is ambiguous for this trajectory (for example constant-speed motion).');
  return {lagMs:best.lag,correlation:best.score,matchedSamples:best.count,reason:'Grid-resolution estimate only; motion, coverage and sampling constrain interpretation.',method};
}
function pair(a:TraceMetrics,b:TraceMetrics,ids:[PipelineId,PipelineId],r:Representation,c:EvaluationConfig,duration:number|null,kind:'stationary'|'moving'):PairMetrics{
  const compatible=!(r==='native'&&ids.includes('P1'))&&!(r==='body3d'&&ids.includes('P1'));
  const common=new Set(a.observations.filter((row,i)=>compatible&&row.point&&b.observations[i]?.point).map(row=>row.index));
  // Retain holes in the source indices so derivatives cannot jump over omitted samples.
  const mask=(m:TraceMetrics)=>m.observations.map(row=>({...row,point:common.has(row.index)?row.point:null}));
  const first=analyzeTrace(mask(a),ids[0],r,c,duration,kind),second=analyzeTrace(mask(b),ids[1],r,c,duration,kind);
  const scale=r==='native'?1:mean([...first.observations,...second.observations].filter(row=>row.point).map(row=>row.width!));
  const differences=first.observations.flatMap((row,i)=>row.point&&second.observations[i].point&&scale?[distance(row.point,second.observations[i].point!)/scale]:[]);
  const exact=differences.filter(d=>d===0).length;
  const settings=comparativeConfiguration(c);const byIndex=new Map(second.samples.map(sample=>[sample.index,sample]));
  const relativeFreeze=r==='native'?0:first.samples.filter(sample=>sample.speed>settings.observedMovementBodyWidthsPerSecond&&(byIndex.get(sample.index)?.speed??Infinity)<=settings.freezeSpeedBodyWidthsPerSecond).length;
  return {pipelines:ids,available:compatible&&common.size>0,reason:compatible?common.size?null:'No common-valid observations.':'P1 image XY and stereo metric XYZ are incompatible; use common projected image-plane normalization.',commonSamples:common.size,commonCoveragePercent:percent(common.size,a.selectedCycles),commonIndices:[...common],coordinateDifference:statistics(differences),exactlyIdentical:exact,different:differences.length-exact,first,second,rmsDifference:kind==='stationary'&&first.rms!==null&&second.rms!==null?second.rms-first.rms:null,rmsReductionPercent:kind==='stationary'&&first.rms!==null&&first.rms>0&&second.rms!==null?100*(first.rms-second.rms)/first.rms:null,amplitudeRatio:first.amplitude!==null&&first.amplitude>1e-12&&second.amplitude!==null?second.amplitude/first.amplitude:null,pathLengthRatio:first.pathLength!==null&&first.pathLength>1e-12&&second.pathLength!==null?second.pathLength/first.pathLength:null,relativeFreezeIntervals:relativeFreeze,delay:kind==='moving'&&compatible?relativeDelay(first,second,c):{lagMs:null,correlation:null,matchedSamples:0,reason:'Delay is only assessed for compatible moving-phase observations.',method:'No estimate'}};
}
export function comparativeEvaluation(session:ImportedSession,c:EvaluationConfig):ComparativeReport{
  const settings=comparativeConfiguration(c),phases:ComparativePhase[]=[];
  const filters=c.annotations.filter(a=>a.kind===settings.visibility);
  const eligible=(f:EvaluatedFrame)=>(c.includeWarmup||f.phase!=='warmup')&&(c.includeUnclassified||f.phase!=='unclassified')&&(!c.controllerFilter||f.controllers[c.controllerFilter.controller].state===c.controllerFilter.state)&&(settings.visibility==='all'||filters.some(a=>inAnnotation(f,a)));
  for(const annotation of c.annotations){if(annotation.kind!=='stationary'&&annotation.kind!=='moving')continue;
    const selected=annotation.kind==='stationary'?settings.stationaryIds:settings.movingIds;if(selected&&!selected.includes(annotation.id))continue;
    const window=annotationWindow(annotation,session);
    const frames=session.frames.filter(f=>eligible(f)&&inAnnotation(f,annotation)&&(f.timeMs===null||f.timeMs>=0&&(session.durationMs===null||f.timeMs<session.durationMs)));
    const start=window?Math.max(window[0],c.includeWarmup?0:session.warmupEndMs??window[0]):null,end=window?Math.min(window[1],session.durationMs??window[1]):null;
    const duration=start!==null&&end!==null&&!c.controllerFilter?(settings.visibility==='all'?Math.max(0,end-start):filters.reduce((sum,a)=>{const window=annotationWindow(a,session);return sum+(window?Math.max(0,Math.min(end,window[1])-Math.max(start,window[0])):0);},0)):null;
    const representations={} as ComparativePhase['representations'];
    for(const r of ['native','body3d','common2d'] as const){
      const independent=Object.fromEntries(PIPELINE_IDS.map(id=>[id,analyzeTrace(comparisonObservations(frames,id,r,session,settings.joint),id,r,c,duration,annotation.kind as 'stationary'|'moving')])) as Record<PipelineId,TraceMetrics>;
      const pairs:PairMetrics[]=[];for(let a=0;a<PIPELINE_IDS.length;a++)for(let b=a+1;b<PIPELINE_IDS.length;b++)pairs.push(pair(independent[PIPELINE_IDS[a]],independent[PIPELINE_IDS[b]],[PIPELINE_IDS[a],PIPELINE_IDS[b]],r,c,duration,annotation.kind));
      const participants=r==='common2d'?PIPELINE_IDS:PIPELINE_IDS.filter(id=>id!=='P1');
      const indices=frames.filter((_,i)=>participants.every(id=>independent[id].observations[i]?.point)).map(f=>f.index),mask=new Set(indices);
      const commonMetrics=Object.fromEntries(PIPELINE_IDS.map(id=>[id,analyzeTrace(independent[id].observations.map(row=>({...row,point:participants.includes(id)&&mask.has(row.index)?row.point:null})),id,r,c,duration,annotation.kind as 'stationary'|'moving')])) as Record<PipelineId,TraceMetrics>;
      representations[r]={independent,pairs,common:{pipelines:participants,indices,metrics:commonMetrics}};
    }
    phases.push({annotation,kind:annotation.kind,durationMs:duration,selectedCycles:frames.length,representations});
  }
  return {joint:settings.joint,configuration:settings,phases,warnings:[...(!phases.length?['Explicit stationary or moving annotations are required; visible or STEREO is not a motion label.']:[]),'Each stationary pose retains a separate mean. Native P1 XY is never ranked against metric XYZ. Common 2D uses recorded Camera A projection and shoulder width; it cannot measure out-of-plane 3D motion.','Normalized positional dispersion uses interval-mean shoulder width to avoid artificial jitter from a varying scale. Movement differences use mean adjacent widths, matching the existing normalization approach.','Independent statistics and common-valid pair statistics have different coverage. Missing samples, nonpositive times, long gaps, phase boundaries and configuration changes break derivative chains. No interpolation.','Freezing and amplitude/lag diagnostics are screening observations, not accuracy measurements or an automatic ranking.'],definitions:{stationary:'RMS = sqrt(mean(||p - mean(p)||^2)); axis SD uses population variance. Each annotated interval has its own mean. Normalized RMS/SD divide by interval-mean shoulder width.',movement:'v_i=(p_i-p_(i-1))/dt at interval midpoint; a is the difference of successive vector velocities divided by their midpoint-time separation; jerk similarly uses acceleration midpoint times. Norms provide speed/acceleration/jerk summaries.',amplitude:'Euclidean norm of per-axis range (bounding-box diagonal). Path length sums valid adjacent displacements only. No paths bridge holes.',paired:'Both pipelines use exactly the same source-cycle mask and unchanged timestamps. Coordinate difference = same-cycle Euclidean separation; native units or a shared mean shoulder-width scale. This is disagreement, not positional error.',normalization:'Shared existing shoulder-width fill policy within each annotated interval. Common2d projects stereo outputs into Camera A pixels using recorded intrinsics; P1 XY is multiplied by recorded image dimensions. Pixel-plane axes avoid aspect-ratio weighting, then all pipelines use the same shoulder-width policy. Body3d supports only metric P2-P4.',freeze:'Moving-phase near-constant intervals are flagged using normalized speed; native traces report only numerically constant displacement <=1e-9. Relative freeze requires the first pipeline to show motion while the second is near constant. No unqualified smoothness score.'}};
}
