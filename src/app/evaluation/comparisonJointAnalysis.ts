import type {PipelineId} from '../type/pipelineComparison';
import type {Joint,EvaluationConfig,EvaluatedFrame,ImportedSession} from './types';
import type {MotionRecording,MotionFrame} from '../hooks/useMotionRecorder';
import type {PoseLandmarks} from '../hooks/useMediaPipePose';
import {LANDMARK_KEYS} from '../hooks/useTriangulation';
import {calculateOcclusionMetrics,detectLimbSwaps,calculateDepthAmbiguity,normalizedIntervalSpeed,summarizeVelocityGroups,positionStandardDeviation} from '../utils/motionQualityMetrics';
import {comparisonCoordinate,comparisonObservations} from './comparative';
import {evaluateSession} from './metrics';
import {importComparisonSession,PIPELINE_IDS} from './importSession';
import {at,object,finite} from './statistics';
function recording(frames:MotionFrame[]):MotionRecording{return {id:'analysis-adapter',name:'Archived output adapter',frames,startTime:0,duration:0,frameRate:0,metadata:{}};}
const point=(values:number[])=>({x:values[0],y:values[1],...(values.length>2?{z:values[2]}:{})});
function dimensions(session:ImportedSession,frame:EvaluatedFrame){const c=object(session.configurations[frame.configurationIndex]),camera=object(c.cameraA),intrinsic=object(object(c.stereoCalibration).camera1);return [camera.width??intrinsic.imageWidth,camera.height??intrinsic.imageHeight] as unknown[];}
export function analyzeComparisonJoint(source:unknown,joint:Joint='nose',overrides:Partial<EvaluationConfig>={}){
 const report=evaluateSession(source,{...overrides,comparative:{...overrides.comparative,joint}}),session=importComparisonSession(source),scope=report.scopes[0];
 const frames=scope.frameIndices.map(i=>session.frames[i]);
 const pipelines=Object.fromEntries(PIPELINE_IDS.map(id=>{
  const image=comparisonObservations(frames,id,'common2d',session,joint),native=comparisonObservations(frames,id,'native',session,joint);
  const groups:number[][]=[];let speeds:number[]=[];
  for(let n=1;n<image.length;n++){
   const a=image[n-1],b=image[n],dt=a.timeMs!==null&&b.timeMs!==null?b.timeMs-a.timeMs:null;
   if(!a.point||!b.point||a.width===null||b.width===null||b.index!==a.index+1||dt===null||dt<=0||dt>report.config.maxObservationGapMs||a.configurationIndex!==b.configurationIndex){if(speeds.length)groups.push(speeds);speeds=[];continue;}
   speeds.push(normalizedIntervalSpeed(point(a.point),point(b.point),dt/1000,(a.width+b.width)/2));
  }
  if(speeds.length)groups.push(speeds);
  const summaries=summarizeVelocityGroups(groups),positions=image.filter(row=>row.point).map(row=>point(row.point!)),sd=positions.length?positionStandardDeviation(positions):null;
  const confidence=frames.flatMap(f=>{const a=f.cameraConfidence?.cameraA?.[joint],b=f.cameraConfidence?.cameraB?.[joint];const value=id==='P1'?a:typeof a==='number'&&typeof b==='number'?Math.min(a,b):null;return typeof value==='number'?[{timestamp:f.timeMs,frameNumber:f.index,landmarks:{[joint]:{visibility:value}}}]:[];});
  const visibility=confidence.length?calculateOcclusionMetrics(recording(confidence as unknown as MotionFrame[]),joint):null;
  // Limb swap rules require image-normalized X, not millimeters or pixels.
  const swapFrames=frames.flatMap(f=>{const [w,h]=dimensions(session,f);if(!finite(w)||!finite(h)||w<=0||h<=0)return [];
   const landmarks=Object.fromEntries(LANDMARK_KEYS.flatMap(j=>{const p=comparisonCoordinate(f,id,j,'common2d',session);return p?[[j,{x:p[0]/w,y:p[1]/h}]]:[];}));
   const arm=landmarks.leftShoulder&&landmarks.rightShoulder&&(landmarks.leftWrist||landmarks.rightWrist),leg=landmarks.leftHip&&landmarks.rightHip&&(landmarks.leftAnkle||landmarks.rightAnkle),sides=landmarks.leftShoulder&&landmarks.rightShoulder||landmarks.leftHip&&landmarks.rightHip;
   return arm||leg||sides?[{timestamp:f.timeMs,frameNumber:f.index,landmarks}]:[];
  });
  const swaps=swapFrames.length?detectLimbSwaps(recording(swapFrames as unknown as MotionFrame[])):null;
  if(swaps)swaps.detectedSwaps=swaps.detectedSwaps.map(event=>({...event,frame:swapFrames[event.frame].frameNumber}));
  const depthPairs=id==='P1'?[]:([['leftWrist','rightWrist'],['leftElbow','rightElbow'],['leftKnee','rightKnee'],['leftAnkle','rightAnkle']] as const).map(([a,b])=>{
   const valid=frames.filter(f=>f.pipelines[id][a].valid&&f.pipelines[id][b].valid);
   const toFrame=(f:EvaluatedFrame)=>({timestamp:f.timeMs!,frameNumber:f.index,landmarks:{[a]:f.pipelines[id][a].point!,[b]:f.pipelines[id][b].point!} as PoseLandmarks});
   // Positional summaries may use all valid pairs; transitions only use contiguous valid runs.
   const spatial=valid.length>=2?calculateDepthAmbiguity(recording(valid.map(toFrame)),a,b):null;
   const runs:MotionFrame[][]=[];let run:MotionFrame[]=[];
   for(const f of frames){const prev=run.at(-1);if(!f.pipelines[id][a].valid||!f.pipelines[id][b].valid||f.timeMs===null){if(run.length)runs.push(run);run=[];continue;}
    if(prev&&(f.index!==prev.frameNumber+1||f.timeMs<=prev.timestamp||f.timeMs-prev.timestamp>report.config.maxObservationGapMs||f.configurationIndex!==session.frames[prev.frameNumber].configurationIndex)){runs.push(run);run=[];}run.push(toFrame(f));
   }if(run.length)runs.push(run);
   return {pair:[a,b],validSamples:valid.length,depthVariance:spatial?.depthVariance??null,averageDepthSeparation:spatial?.averageDepthSeparation??null,zOrderFlips:runs.filter(r=>r.length>=2).reduce((sum,r)=>sum+calculateDepthAmbiguity(recording(r),a,b).zOrderFlips,0),reason:spatial?null:'At least two common-valid joints are required.'};
  });
  return [id,{id,image,native,availability:scope.availability[id][joint],jitter:{...summaries,meanVelocity:groups.flat().length?summaries.meanVelocity:null,velocityVariance:groups.flat().length?summaries.velocityVariance:null,highFrequencyNoise:groups.flat().length?summaries.highFrequencyNoise:null,smoothnessScore:groups.flat().length?summaries.smoothnessScore:null,positionStdDev:sd,nativePositionStdDev:id==='P1'?null:(native.some(r=>r.point)?positionStandardDeviation(native.filter(r=>r.point).map(r=>point(r.point!))):null),validPositions:positions.length,validIntervals:groups.flat().length,normalizationObservedSamples:image.filter(r=>r.point&&r.widthSource==='observed').length,normalizationCarriedSamples:image.filter(r=>r.point&&(r.widthSource==='carried'||r.widthSource==='leading_fill')).length,normalizationMissingSamples:image.filter(r=>r.point&&r.width===null).length,shoulderWidthRef:image.some(r=>r.width!==null)?image.filter(r=>r.width!==null).reduce((sum,r)=>sum+r.width!,0)/image.filter(r=>r.width!==null).length:null,highFrequencyEligibleChanges:groups.reduce((sum,g)=>sum+Math.max(0,g.length-2),0),units:'body-widths/s; variance (body-widths/s)^2; position SD Camera A pixels',reason:positions.length?null:'Compatible Camera A projection/dimensions unavailable or no valid joint positions.'},visibility,visibilitySamples:confidence.length,swaps,swapEligibleSamples:swapFrames.length,depthPairs}];
 })) as Record<PipelineId,any>;
 const imageRows=frames.flatMap((f,n)=>{if(f.timeMs===null)return [];const values=Object.fromEntries(PIPELINE_IDS.map(id=>{const p=pipelines[id].image[n].point;return [id,p?{x:p[0],y:p[1]}:null];}));const previous=frames[n-1],gap=!!previous&&(f.index!==previous.index+1||previous.timeMs===null||f.timeMs<=previous.timeMs||f.timeMs-previous.timeMs>report.config.maxObservationGapMs||f.configurationIndex!==previous.configurationIndex);
  const row={index:f.index,cycleId:f.cycleId,t:f.timeMs/1000,...Object.fromEntries(PIPELINE_IDS.flatMap(id=>[[id+'_x',values[id]?.x??null],[id+'_y',values[id]?.y??null],[id+'_z',id==='P1'?null:f.pipelines[id][joint].valid?f.pipelines[id][joint].point!.z:null]]))};
  return gap?[{index:-1,cycleId:null,t:row.t,...Object.fromEntries(PIPELINE_IDS.flatMap(id=>['_x','_y','_z'].map(axis=>[id+axis,null])))},row]:[row];
 });
 const trackingRows=imageRows.map(row=>{const f=row.index>=0?session.frames[row.index]:null;return {...row,...Object.fromEntries(PIPELINE_IDS.flatMap(id=>{const ca=f?.cameraConfidence?.cameraA?.[joint],cb=f?.cameraConfidence?.cameraB?.[joint];return [[id+'_visibility',id==='P1'?ca??null:typeof ca==='number'&&typeof cb==='number'?Math.min(ca,cb):null]];})),upperArm:f?['STEREO','IMU_CORRECTION','RECOVERY','UNAVAILABLE','UNKNOWN'].indexOf(f.controllers.upperArm.state):null,forearm:f?['STEREO','IMU_CORRECTION','RECOVERY','UNAVAILABLE','UNKNOWN'].indexOf(f.controllers.forearm.state):null};});
 const shared=frames.filter(f=>f.pipelines.P2[joint].valid&&f.pipelines.P3[joint].valid),differences=shared.map(f=>{const a=f.pipelines.P2[joint].point!,b=f.pipelines.P3[joint].point!;return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);});
 return {schemaVersion:'1.0.0-stereo-style-comparison-analysis',joint,report,frames,pipelines,imageRows,trackingRows,pairedP2P3:{commonSamples:shared.length,exactlyIdentical:differences.filter(d=>d===0).length,different:differences.filter(d=>d!==0).length,coordinateDifferencesMm:differences},definitions:{jitter:'Original Stereo Lab formulas: mean and population variance of shoulder-normalized speeds; position population SD; fraction of within-run speed changes exceeding twice whole-window mean speed (the original heuristic, not spectral noise). No interval bridges missing samples.',coordinates:'All shared X/Y use recorded Camera A pixels; stereo points are projected with recorded intrinsics. Original shoulder-width normalization applies to speed. Missing projection/reference remains unavailable. Metric Z is P2-P4 only.',depth:'Original calculateDepthAmbiguity positional variance/separation and contiguous z-order flips are reused in mm. Image-relative depth score thresholds are not reinterpreted as mm; those scores are N/A.',limbSwap:'Original image-normalized screen-side heuristic is reused on valid available fields; it is not proof of anatomical swaps. Missing fields are omitted, never filled with zeros.',interpretation:'Whole analyzed-window variation, not stationary-only jitter. Heuristic smoothness can reward freezing; inspect availability and trajectories. No absolute positional accuracy claim.'}};
}
