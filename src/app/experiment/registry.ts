import type {ExperimentPipeline,StoredExperiment} from './types';
export function createExperimentRegistry(){
  const entries=new Map<string,StoredExperiment>(),listeners=new Set<()=>void>();
  let snapshot:{sessions:StoredExperiment[];navigation:{pipeline:ExperimentPipeline;serial:number}|null}={sessions:[],navigation:null};
  const notify=()=>{snapshot={...snapshot,sessions:[...entries.values()]};listeners.forEach(fn=>fn());};
  return {subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},getSnapshot:()=>snapshot,
    get:(id:string)=>entries.get(id),put(entry:StoredExperiment){entries.set(entry.manifest.sessionId,entry);notify();},
    remove(id:string){const status=entries.get(id)?.manifest.status;if(status==='recording'||status==='finalizing')return false;entries.delete(id);notify();return true;},
    navigate(pipeline:ExperimentPipeline){snapshot={...snapshot,navigation:{pipeline,serial:(snapshot.navigation?.serial??0)+1}};notify();},
  };
}
export const experimentRegistry=createExperimentRegistry();
