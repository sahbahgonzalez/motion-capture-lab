import {LANDMARK_KEYS} from '../hooks/useTriangulation';
import type {Annotation,EvaluationConfig,EvaluatedFrame,ImportedSession} from './types';
import {finite,object} from './statistics';

export const DEFAULT_EVALUATION_CONFIG:EvaluationConfig={schemaVersion:'1.0.0-evaluation-config',includeWarmup:false,includeUnclassified:true,
  maxObservationGapMs:250,transitionWindowMs:100,jumpDistanceMm:100,jumpSpeedMmPerSecond:3000,
  jumpDistanceNormalizedXY:.1,jumpSpeedNormalizedXYPerSecond:2,lengthDeviationThresholdFraction:.25,annotations:[],controllerFilter:null};
export function inAnnotation(f:EvaluatedFrame,a:Annotation):boolean {
  const v=a.coordinate==='frame_index'?f.index:f.timeMs;
  return v!==null&&v>=a.start&&v<a.end;
}
export function annotationWindow(a:Annotation,s:ImportedSession):[number,number]|null {
  if(a.coordinate==='time_ms')return[a.start,a.end];
  const start=s.frames[a.start]?.timeMs,end=a.end===s.frames.length?s.durationMs:s.frames[a.end]?.timeMs;
  return start!=null&&end!=null&&end>=start?[start,end]:null;
}
export function annotationLayer(a:Annotation){return ['stationary','moving'].includes(a.kind??'')?'motion':['visible','occluded'].includes(a.kind??'')?'visibility':a.kind==='recovery'?'recovery':'custom';}
export function evaluationConfiguration(overrides:Partial<EvaluationConfig>,session:ImportedSession):EvaluationConfig {
  if(overrides.schemaVersion&&overrides.schemaVersion!=='1.0.0-evaluation-config')throw new Error('Unsupported evaluation configuration version.');
  const c={...DEFAULT_EVALUATION_CONFIG,...overrides,annotations:overrides.annotations??[]};
  for(const key of ['maxObservationGapMs','transitionWindowMs','jumpDistanceMm','jumpSpeedMmPerSecond','jumpDistanceNormalizedXY','jumpSpeedNormalizedXYPerSecond','lengthDeviationThresholdFraction'] as const)
    if(!finite(c[key])||c[key]<0||(key==='maxObservationGapMs'&&c[key]===0))throw new Error('Invalid evaluation threshold: '+key);
  if(typeof c.includeWarmup!=='boolean'||typeof c.includeUnclassified!=='boolean')throw new Error('Warmup/unclassified inclusion must be boolean.');
  if(!Array.isArray(c.annotations))throw new Error('annotations must be an array.');
  const ids=new Set<string>();
  for(const raw of c.annotations){const a=object(raw);
    if(typeof a.id!=='string'||!a.id||['whole','unlabeled'].includes(a.id)||ids.has(a.id)||typeof a.label!=='string'||!a.label)throw new Error('Annotation IDs must be nonempty and unique (whole/unlabeled are reserved); labels are required.');
    ids.add(a.id);
    if(a.kind!==undefined&&!['stationary','moving','visible','occluded','recovery','custom'].includes(a.kind as string))throw Error('Unknown annotation kind.');
    if(a.coordinate!=='time_ms'&&a.coordinate!=='frame_index')throw new Error('Annotation coordinates must be time_ms or frame_index.');
    if(!finite(a.start)||!finite(a.end)||a.start<0||a.end<=a.start)throw new Error('Annotation intervals must have finite 0 <= start < end.');
    if(a.coordinate==='frame_index'&&(!Number.isInteger(a.start)||!Number.isInteger(a.end)||a.end>session.frames.length))throw new Error('Frame annotations use absolute zero-based indices and an exclusive end within the recording.');
    if(typeof a.healthyVisibility!=='boolean')throw new Error('healthyVisibility must be explicitly boolean.');
  }
  for(let i=0;i<c.annotations.length;i++)for(let j=0;j<i;j++){
    const a=c.annotations[i],b=c.annotations[j],wa=annotationWindow(a,session),wb=annotationWindow(b,session);
    if(annotationLayer(a)===annotationLayer(b)&&((wa&&wb&&wa[0]<wb[1]&&wb[0]<wa[1])||session.frames.some(f=>inAnnotation(f,a)&&inAnnotation(f,b))))throw new Error('Overlapping phase annotations within the same layer are ambiguous; motion, visibility and recovery layers may overlap.');
  }
  if(c.controllerFilter&&(!['upperArm','forearm'].includes(c.controllerFilter.controller)||!['STEREO','IMU_CORRECTION','RECOVERY','UNAVAILABLE','UNKNOWN'].includes(c.controllerFilter.state)))throw new Error('Invalid controller-state filter.');
  if(c.comparative){if(typeof c.comparative!=='object'||Array.isArray(c.comparative))throw Error('Comparative settings must be an object.');const v=c.comparative;
    if(v.joint!==undefined&&!LANDMARK_KEYS.includes(v.joint))throw Error('Invalid comparative joint.');
    if(v.visibility!==undefined&&!['all','visible','occluded','recovery'].includes(v.visibility))throw Error('Invalid visibility filter.');
    for(const key of ['lagMaxMs','lagStepMs','lagToleranceMs','freezeSpeedBodyWidthsPerSecond','observedMovementBodyWidthsPerSecond','jumpBodyWidths','jumpBodyWidthsPerSecond'] as const)
      if(v[key]!==undefined&&(!finite(v[key])||v[key]!<0||(key==='lagStepMs'&&v[key]===0)))throw Error('Invalid comparative setting: '+key);
    if((v.lagMaxMs??500)>5000||(v.lagMaxMs??500)/(v.lagStepMs??20)>250)throw Error('Lag search exceeds the bounded 501-candidate grid.');
    for(const [key,kind] of [['stationaryIds','stationary'],['movingIds','moving']] as const)if(v[key]!==undefined&&(!Array.isArray(v[key])||v[key]!.some(id=>!c.annotations.some(a=>a.id===id&&a.kind===kind))))throw Error('Selected '+kind+' annotation IDs are invalid.');
  }
  return JSON.parse(JSON.stringify(c));
}
