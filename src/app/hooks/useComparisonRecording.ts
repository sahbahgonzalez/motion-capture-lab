import { useEffect, useRef, useState } from 'react';
import { createComparisonRecorder } from '../utils/pipelineComparison';
import type { ComparisonFrame } from '../type/pipelineComparison';

export function useComparisonRecording() {
  const store = useRef<ReturnType<typeof createComparisonRecorder> | null>(null);
  if (!store.current) store.current = createComparisonRecorder();
  const [latest, setLatest] = useState<ComparisonFrame | null>(null);
  const latestRef = useRef<ComparisonFrame | null>(null);
  const [revision, refresh] = useState(0);
  const lastUI = useRef(0);
  const processing = useRef({first: 0, last: 0, count: 0});
  useEffect(() => () => { store.current!.stop(performance.now(), Date.now(), 'component_unmount'); }, []);
  return {
    latest, session: store.current.getSession(), revision,
    processingRateHz: processing.current.count > 1 && processing.current.last > processing.current.first
      ? (processing.current.count - 1) * 1000 / (processing.current.last - processing.current.first) : null,
    accept(frame: ComparisonFrame, configuration: unknown) {
      const display = store.current!.append(frame, configuration);
      if (!processing.current.count) processing.current.first = frame.timing.processingStartedPerformanceNowMs;
      processing.current.last = frame.timing.processingStartedPerformanceNowMs;
      processing.current.count++;
      latestRef.current = display;
      // All cycles are archived; UI sampling never controls acquisition.
      if (frame.processingCompletedPerformanceNowMs - lastUI.current >= 100) {
        lastUI.current = frame.processingCompletedPerformanceNowMs; setLatest(display);
      }
    },
    start(warmupMs: number, metadata: unknown) {
      if (store.current!.getSession()) return;
      store.current!.start(crypto.randomUUID(), performance.now(), Date.now(), warmupMs, metadata, latestRef.current);
      refresh(v => v + 1);
    },
    stop() { store.current!.stop(performance.now(), Date.now()); refresh(v => v + 1); },
    clear() { store.current!.clear(); refresh(v => v + 1); },
    exportSession() {
      const json = store.current!.exportJson();
      const url = URL.createObjectURL(new Blob([json], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url;
      link.download = `pipeline_comparison_${store.current!.getSession()!.sessionId}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}
