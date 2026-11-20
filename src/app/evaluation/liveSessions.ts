import {useSyncExternalStore} from 'react';
import type {ComparisonSession} from '../type/pipelineComparison';
import type {EvaluationConfig} from './types';
import {comparisonSnapshot} from '../utils/pipelineComparison';
/** Completed pose sessions only: no camera encoders, IMU packet streams, or replay. */
export function createLiveComparisonResults(){
  const listeners=new Set<()=>void>();
  let snapshot:{sessions:Array<{source:ComparisonSession;config:Partial<EvaluationConfig>}>;selectedId:string|null}={sessions:[],selectedId:null};
  const publish=()=>listeners.forEach(fn=>fn());
  return {
    subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},getSnapshot:()=>snapshot,
    retain(source:ComparisonSession){
      if(source.status!=='stopped'||snapshot.sessions.some(s=>s.source.sessionId===source.sessionId))return;
      snapshot={sessions:[...snapshot.sessions,{source:comparisonSnapshot(source),config:{}}],selectedId:source.sessionId};publish();
    },
    configure(id:string,config:EvaluationConfig){
      const found=snapshot.sessions.find(s=>s.source.sessionId===id);if(!found||JSON.stringify(found.config)===JSON.stringify(config))return;
      snapshot={...snapshot,sessions:snapshot.sessions.map(s=>s===found?{...s,config:comparisonSnapshot(config)}:s)};publish();
    },
    clear(){snapshot={sessions:[],selectedId:null};publish();},
  };
}
export const liveComparisonResults=createLiveComparisonResults();
export const useLiveComparisonResults=()=>useSyncExternalStore(liveComparisonResults.subscribe,liveComparisonResults.getSnapshot);
