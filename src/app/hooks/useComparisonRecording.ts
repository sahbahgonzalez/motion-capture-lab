import {liveComparisonResults} from '../evaluation/liveSessions';
import { useEffect, useRef, useState } from 'react';
import { createComparisonRecorder } from '../utils/pipelineComparison';
import type { ComparisonFrame } from '../type/pipelineComparison';

export function useComparisonRecording(options:{onActiveChange?:(active:boolean)=>void;omitIMUSamples?:boolean}={}) {
  const optionsRef=useRef(options);optionsRef.current=options;
  const store = useRef<ReturnType<typeof createComparisonRecorder> | null>(null);
  if (!store.current) store.current = createComparisonRecorder();
  const [latest, setLatest] = useState<ComparisonFrame | null>(null);
  const latestRef = useRef<ComparisonFrame | null>(null);
  const [revision, refresh] = useState(0);
  const lastUI = useRef(0);
  const processing = useRef({first: 0, last: 0, count: 0,recent:[] as number[]});
  const finalize=(reason='user_stop')=>{
    const current=store.current!.getSession();if(current?.status!=='recording')return;
    const stopped=store.current!.stop(performance.now(),Date.now(),reason);
    if(stopped)liveComparisonResults.retain(stopped);
    optionsRef.current.onActiveChange?.(false);
  };
  const finalizeRef=useRef(finalize);finalizeRef.current=finalize;
  useEffect(()=>()=>finalizeRef.current('component_unmount'),[]);
  return {
    latest, session: store.current.getSession(), revision,
    processingRateHz: processing.current.recent.length>1&&processing.current.recent.at(-1)!>processing.current.recent[0]
      ?(processing.current.recent.length-1)*1000/(processing.current.recent.at(-1)!-processing.current.recent[0]):null,
    accept(frame: ComparisonFrame, configuration: unknown) {
      const display = store.current!.append(optionsRef.current.omitIMUSamples?{...frame,imuSamples:null}:frame, configuration);
      if (!processing.current.count) processing.current.first = frame.timing.processingStartedPerformanceNowMs;
      processing.current.last = frame.timing.processingStartedPerformanceNowMs;
      processing.current.count++;
      processing.current.recent=processing.current.recent.filter(time=>time>=frame.timing.processingStartedPerformanceNowMs-1000);processing.current.recent.push(frame.timing.processingStartedPerformanceNowMs);
      latestRef.current = display;
      // All cycles are archived; UI sampling never controls acquisition.
      if (frame.processingCompletedPerformanceNowMs - lastUI.current >= 100) {
        lastUI.current = frame.processingCompletedPerformanceNowMs; setLatest(display);
      }
    },
    start(warmupMs: number, metadata: unknown) {
      if (store.current!.getSession()) return;
      store.current!.start(crypto.randomUUID(), performance.now(), Date.now(), warmupMs, metadata, latestRef.current);
      optionsRef.current.onActiveChange?.(true);refresh(v => v + 1);
    },
    stop() { finalize(); refresh(v => v + 1); },
    clear() { store.current!.clear(); refresh(v => v + 1); },
    exportSession() {
      const raw=JSON.parse(store.current!.exportJson());
      const config=liveComparisonResults.getSnapshot().sessions.find(s=>s.source.sessionId===raw.sessionId)?.config;
      const json=JSON.stringify(config?{...raw,evaluationMetadata:{schemaVersion:'1.0.0-comparative-annotations',annotations:config.annotations??[],config}}:raw,null,2);
      const url = URL.createObjectURL(new Blob([json], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url;
      link.download = `pipeline_comparison_${store.current!.getSession()!.sessionId}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}
