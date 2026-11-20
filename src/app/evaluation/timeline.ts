import type {Annotation,Controller,ControllerEvent,EvaluatedFrame,EvaluationConfig,ImportedSession,Run} from './types';
import {annotationWindow,inAnnotation} from './configuration';

export interface Selection {id:string;label:string;annotation:Annotation|null;indices:number[];windows:Array<[number,number]>;windowMs:number|null;}
function subtract(windows:Array<[number,number]>,cut:[number,number]):Array<[number,number]> {
  return windows.flatMap(([start,end])=>cut[1]<=start||cut[0]>=end?[[start,end] as [number,number]]:[...(cut[0]>start?[[start,Math.min(end,cut[0])] as [number,number]]:[]),...(cut[1]<end?[[Math.max(start,cut[1]),end] as [number,number]]:[])]);
}
export function selections(s:ImportedSession,c:EvaluationConfig):Selection[] {
  const baseStart=c.includeWarmup?0:s.warmupEndMs;
  const baseWindow=baseStart!==null&&s.durationMs!==null&&s.durationMs>=baseStart?[[baseStart,s.durationMs] as [number,number]]:[];
  const eligible=(f:EvaluatedFrame)=> (c.includeWarmup||f.phase!=='warmup')&&(c.includeUnclassified||f.phase!=='unclassified')&&(!c.controllerFilter||f.controllers[c.controllerFilter.controller].state===c.controllerFilter.state);
  const candidates:Array<{id:string;label:string;annotation:Annotation|null;test:(f:EvaluatedFrame)=>boolean;windows:Array<[number,number]>;known:boolean}>=[
    {id:'whole',label:c.includeWarmup?'Whole session':'Measurement (warmup excluded)',annotation:null,test:()=>true,windows:baseWindow,known:baseWindow.length>0},
  ];
  for(const a of c.annotations){const w=annotationWindow(a,s);const windows=w?(baseWindow.length?baseWindow.map(([x,y])=>[Math.max(x,w[0]),Math.min(y,w[1])] as [number,number]).filter(([x,y])=>y>=x):[w]):[];
    candidates.push({id:a.id,label:a.label,annotation:a,test:f=>inAnnotation(f,a),windows,known:!!w&&(c.includeWarmup||s.warmupEndMs!==null)});}
  let unlabeled=baseWindow;let known=baseWindow.length>0;
  for(const a of c.annotations){const w=annotationWindow(a,s);if(w)unlabeled=subtract(unlabeled,w);else known=false;}
  candidates.push({id:'unlabeled',label:'Unlabeled',annotation:null,test:f=>!c.annotations.some(a=>inAnnotation(f,a)),windows:unlabeled,known});
  return candidates.map(x=>({id:x.id,label:x.label,annotation:x.annotation,indices:s.frames.filter(f=>eligible(f)&&x.test(f)).map(f=>f.index),windows:x.windows,
    windowMs:x.known&&!c.controllerFilter?x.windows.reduce((sum,[a,b])=>sum+b-a,0):null}));
}
export function intervalWeight(s:ImportedSession,index:number,selection:Selection,c:EvaluationConfig):number {
  const start=s.frames[index].timeMs,next=s.frames[index+1]?.timeMs??(index===s.frames.length-1?s.durationMs:null);
  if(start===null||next===null||next<=start||next-start>c.maxObservationGapMs)return 0;
  if(!selection.windows.length)return next-start;
  return selection.windows.reduce((sum,[a,b])=>sum+Math.max(0,Math.min(next,b)-Math.max(start,a)),0);
}
export function runs(s:ImportedSession,selection:Selection,c:EvaluationConfig,predicate:(f:EvaluatedFrame)=>boolean):Run[] {
  const out:Run[]=[],indices=selection.indices;
  for(let position=0;position<indices.length;position++){
    const startPosition=position,index=indices[position];if(!predicate(s.frames[index]))continue;
    while(position+1<indices.length&&indices[position+1]===indices[position]+1&&predicate(s.frames[indices[position+1]]))position++;
    const lastIndex=indices[position],last=s.frames[lastIndex],first=s.frames[index],nextIndex=indices[position+1];
    const closes=nextIndex===lastIndex+1&&!predicate(s.frames[nextIndex]);
    let endMs=closes?s.frames[nextIndex].timeMs:null;
    if(!closes&&last.timeMs!==null){const boundary=selection.windows.find(([a,b])=>last.timeMs!>=a&&last.timeMs!<b)?.[1];
      if(boundary!==undefined)endMs=boundary;else if(lastIndex===s.frames.length-1)endMs=s.durationMs;}
    let timingUnknown=first.timeMs===null||endMs===null;
    for(let i=index;i<=lastIndex;i++){
      const a=s.frames[i].timeMs,b=i===lastIndex?endMs:s.frames[i+1].timeMs;
      if(a===null||b===null||b<=a||b-a>c.maxObservationGapMs)timingUnknown=true;
    }
    const prior=s.frames[index-1];
    out.push({startIndex:index,endIndexExclusive:lastIndex+1,frames:position-startPosition+1,startMs:first.timeMs,endMs,
      durationMs:!timingUnknown&&first.timeMs!==null&&endMs!==null&&endMs>=first.timeMs?endMs-first.timeMs:null,
      leftCensored:!prior||predicate(prior)||indices[startPosition-1]!==index-1,rightCensored:!closes,timingUnknown});
  }
  return out;
}
export function controllerEvents(s:ImportedSession,c:EvaluationConfig):ControllerEvent[] {
  const events:ControllerEvent[]=[];
  for(const controller of ['upperArm','forearm'] as Controller[])for(let i=1;i<s.frames.length;i++){
    const previous=s.frames[i-1],frame=s.frames[i],from=previous.controllers[controller].state,to=frame.controllers[controller].state;
    if(from===to)continue;
    const activation=to==='IMU_CORRECTION'&&from!=='UNKNOWN';
    const kind=activation?'correction_activation':to==='RECOVERY'&&from!=='UNKNOWN'?'recovery_entry':'state_change';
    let onset:number|null=null,coarse:number|null=null,latency:number|null=null;
    if(activation&&frame.controllers[controller].failureEvidence===true){
      let first=i;while(first>0&&s.frames[first-1].controllers[controller].failureEvidence===true)first--;
      if(first>0&&s.frames[first-1].controllers[controller].failureEvidence===false){
        onset=first;const t=s.frames[first].timeMs;
        const priorTime=s.frames[first-1].timeMs;
        let valid=t!==null&&frame.timeMs!==null&&priorTime!==null&&t>priorTime&&t-priorTime<=c.maxObservationGapMs;
        for(let n=first+1;n<=i;n++){const a=s.frames[n-1].timeMs,b=s.frames[n].timeMs;if(a===null||b===null||b<=a||b-a>c.maxObservationGapMs)valid=false;}
        if(valid){coarse=frame.timeMs!-t!;if(coarse>0)latency=coarse;}
      }
    }
    events.push({controller,index:i,timeMs:frame.timeMs,from,to,kind,reason:frame.controllers[controller].reason,
      failureObservedIndex:onset,recordedCycleSeparationMs:coarse,failureToActivationMs:latency,
      latencyInterpretation:latency!==null?'Sampled delay between recorded failure evidence and a later correction-state entry; not sensor-to-output latency.':coarse===0?'Failure evidence and correction first appear in the same cycle; sub-cycle latency is unobservable, not measured as zero.':'Failure onset or reliable timing unavailable; latency not identifiable.',
      annotatedHealthy:c.annotations.some(a=>a.healthyVisibility&&inAnnotation(frame,a))});
  }
  return events.sort((a,b)=>a.index-b.index||a.controller.localeCompare(b.controller));
}
