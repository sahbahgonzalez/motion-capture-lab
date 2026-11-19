import { useCallback, useEffect, useRef, useState } from 'react';
import { useStereoVideoRecorder, type StereoVideoRecording } from './useStereoVideoRecorder';
import type { MasterActiveSession, MasterControllerOptions, MasterPhase, MasterSession } from '../type/masterSession';
import { createMasterSessionZip, evaluationReadiness, finalizeMasterSession, immutableJson, missingReadiness } from '../utils/masterSession';

// Recover completed/partially finalized sessions after lab navigation within the same page.
// This deliberately is not disk persistence or Stage 3 playback state.
const retainedSessions = new Map<string, MasterSession>();
const retainedListeners = new Set<() => void>();
const notifyRetainedSessions = () => retainedListeners.forEach(listener => listener());
const exporting = new Map<string, {promise:Promise<Blob>;owner:object;downloaded:boolean}>();
export function listRetainedMasterSessions() { return [...retainedSessions.values()].reverse(); }

export function useMasterExperimentRecorder(streamA: MediaStream | null, streamB: MediaStream | null, options: MasterControllerOptions) {
  const latest = useRef(options); latest.current = options;
  const mounted = useRef(true);
  const active = useRef<MasterActiveSession | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPromise = useRef<Promise<MasterSession | null> | null>(null);
  const [phase,setPhase] = useState<MasterPhase>('idle');
  const [missing,setMissing] = useState<string[]>([]);
  const [evaluationStartMs,setEvaluationStartMs] = useState<number | null>(null);
  const [sessions,setSessions] = useState(listRetainedMasterSessions);
  const [error,setError] = useState<string | null>(null);
  const [exportingId,setExportingId] = useState<string | null>(null);
  const clearTimer = () => { if (timer.current !== null) clearInterval(timer.current); timer.current = null; };
  const publish = (context: MasterActiveSession) => {
    if (!mounted.current || active.current !== context) return;
    setPhase(context.phase); setMissing([...context.missing]); setEvaluationStartMs(context.timeline.evaluationWindowStartMs);
  };
  const complete = useCallback((context: MasterActiveSession, recording: StereoVideoRecording | null) => {
    const prior = retainedSessions.get(context.sessionId);
    if (prior) return prior;
    const result = finalizeMasterSession(context,recording);
    retainedSessions.set(context.sessionId,result);
    notifyRetainedSessions();
    if (active.current === context) {
      clearTimer(); active.current = null; stopPromise.current = null;
      if (mounted.current) { setPhase('idle');setMissing([]);setSessions(listRetainedMasterSessions()); }
    }
    return result;
  }, []);
  const onRecordingFinalized = useCallback((recording: StereoVideoRecording) => {
    const context = active.current;
    if (context?.sessionId === recording.id) complete(context,recording);
  }, [complete]);
  const camera = useStereoVideoRecorder(streamA,streamB,{...options,onRecordingFinalized});
  const cameraRef = useRef(camera); cameraRef.current = camera;

  const observeReadiness = (context: MasterActiveSession, issues: string[], now: number) => {
    context.missing = issues;
    const key = context.phase + ':' + issues.join('|');
    if (key !== context.lastReadinessKey) {
      context.lastReadinessKey = key;
      context.readinessEvents.push({performanceNowMs: now,experimentTimeMs: null,phase:context.phase,missing:[...issues]});
    }
  };
  const notifyConfigurationChange = useCallback(() => {
    const context = active.current;
    if (!context || context.timeline.recordingOriginPerformanceNowMs === null
      || (context.phase !== 'initializing' && context.phase !== 'ready')) return;
    const snapshot = immutableJson(latest.current.getRuntimeSnapshot());
    const previous = context.configuration.changes.at(-1)?.snapshot ?? context.configuration.initial;
    if (JSON.stringify(previous) !== JSON.stringify(snapshot)) context.configuration.changes.push({
      experimentTimeMs: performance.now() - context.timeline.recordingOriginPerformanceNowMs, snapshot,
    });
  }, []);
  const startRecording = useCallback(() => {
    if (!mounted.current || active.current) return;
    const warmupMs = latest.current.warmupMs ?? 3000;
    if (!Number.isFinite(warmupMs) || warmupMs < 0) { setError('Warmup duration must be a finite non-negative number.'); return; }
    const now = performance.now();
    const context: MasterActiveSession = {
      sessionId: crypto.randomUUID(), createdAt: new Date().toISOString(), phase:'warming_up',
      timeline: {requestedPerformanceNowMs:now,warmupDurationRequiredMs:warmupMs,warmupStableStartPerformanceNowMs:null,
        warmupEndPerformanceNowMs:null,recordingOriginPerformanceNowMs:null,evaluationWindowStartMs:null,evaluationWindowEndMs:null,stopPerformanceNowMs:null},
      configuration:{schemaVersion:'1.0.0-runtime-configuration',initial:null,changes:[]},readinessEvents:[],missing:[],errors:[],warnings:[],
      interruptedStreams:new Set(),lastReadinessKey:'',lastProgress:null,
    };
    active.current = context; stopPromise.current = null; setError(null); setEvaluationStartMs(null);
    const tick = () => {
      if (active.current !== context || context.phase === 'stopping') return;
      const time = performance.now();
      try {
        const readiness = latest.current.getReadiness();
        const liveMissing = missingReadiness(readiness);
        if (context.phase === 'warming_up') {
          if (liveMissing.length) context.timeline.warmupStableStartPerformanceNowMs = null;
          else context.timeline.warmupStableStartPerformanceNowMs ??= time;
          observeReadiness(context,liveMissing,time);
          const stableStart = context.timeline.warmupStableStartPerformanceNowMs;
          if (stableStart !== null) {
            context.configuration.initial = immutableJson(latest.current.getRuntimeSnapshot());
            context.phase = 'initializing';
            const started = cameraRef.current.startRecordingWithIdentity({recordingId:context.sessionId,experimentSessionId:context.sessionId});
            if (active.current !== context) return; // Startup may have synchronously failed/finalized.
            if (!started) {
              context.errors.push('Camera capture could not start after warmup.');context.timeline.stopPerformanceNowMs=time;
              complete(context,null); return;
            }
            context.timeline.recordingOriginPerformanceNowMs = started.originPerformanceNowMs;
          }
        }
        if (context.phase !== 'warming_up') {
          const progress = cameraRef.current.getRecordingProgress(); context.lastProgress = progress;
          for (const [stream,check] of Object.entries(readiness.streams)) {
            if (!check.ready) context.interruptedStreams.add(stream);
          }
          if (progress?.phase === 'stopping') context.phase = 'stopping';
          if (context.timeline.evaluationWindowStartMs === null) {
            if (liveMissing.length) { context.timeline.warmupStableStartPerformanceNowMs=null;context.timeline.warmupEndPerformanceNowMs=null; }
            else {
              context.timeline.warmupStableStartPerformanceNowMs ??= time;
              if (time-context.timeline.warmupStableStartPerformanceNowMs >= warmupMs) context.timeline.warmupEndPerformanceNowMs ??= time;
            }
          }
          const issues = evaluationReadiness(progress,readiness);
          if (context.timeline.warmupEndPerformanceNowMs === null) issues.push('stabilization: configured ready-stream interval has not elapsed');
          if (!issues.length && context.timeline.evaluationWindowStartMs === null) {
            context.timeline.evaluationWindowStartMs = time - context.timeline.recordingOriginPerformanceNowMs!;
            context.phase = 'ready';
          }
          observeReadiness(context,issues,time);
        }
        publish(context);
      } catch (cause) {
        context.errors.push('Session initialization/readiness failed: ' + (cause as Error).message);
        if (context.timeline.recordingOriginPerformanceNowMs === null) { context.timeline.stopPerformanceNowMs=time;complete(context,null); }
        else { context.phase='stopping';void cameraRef.current.stopRecording();publish(context); }
      }
    };
    timer.current = setInterval(tick,100); tick(); publish(context);
  }, [complete]);

  const stop = useCallback((reason: string): Promise<MasterSession | null> => {
    const context = active.current;
    if (!context) return Promise.resolve(null);
    if (stopPromise.current) return stopPromise.current;
    clearTimer(); context.phase='stopping';context.timeline.stopPerformanceNowMs=performance.now();
    if (reason === 'unmount') context.errors.push('Master session interrupted by component unmount.');
    if (context.timeline.recordingOriginPerformanceNowMs === null) {
      context.errors.push('Stopped while waiting for live-stream readiness; experimental recording never started.');
      return Promise.resolve(complete(context,null));
    }
    publish(context);
    const promise = cameraRef.current.stopRecording().then(recording => complete(context,recording));
    stopPromise.current=promise;return promise;
  }, [complete]);
  const stopRecording = useCallback(() => stop('user_stop'), [stop]);
  useEffect(() => {
    mounted.current=true;
    const refresh = () => setSessions(listRetainedMasterSessions());
    retainedListeners.add(refresh);refresh();
    return () => { mounted.current=false;retainedListeners.delete(refresh);clearTimer();void stop('unmount'); };
  }, [stop]);

  const downloadSession = useCallback((session: MasterSession): Promise<Blob> => {
    const id = session.manifest.sessionId;
    const deliver = (entry: {downloaded:boolean}, blob: Blob) => {
      if (mounted.current && !entry.downloaded) {
        const url=URL.createObjectURL(blob), anchor=document.createElement('a');
        anchor.href=url;anchor.download='experiment_session_'+id+'.zip';
        document.body.appendChild(anchor);anchor.click();document.body.removeChild(anchor);URL.revokeObjectURL(url);
        entry.downloaded=true;
      }
      return blob;
    };
    const pending = exporting.get(id);
    if (pending) return pending.owner === mounted ? pending.promise : pending.promise.then(blob => deliver(pending,blob));
    if (mounted.current) { setExportingId(id);setError(null); }
    const createZip = latest.current.createZip ?? createMasterSessionZip;
    // Promise boundary also catches synchronous ZIP-factory errors, preserving the source session.
    const entry = {promise: null as unknown as Promise<Blob>,owner:mounted,downloaded:false};
    const promise = Promise.resolve().then(() => createZip(session)).then(blob => {
      return deliver(entry,blob);
    }).catch(cause => {
      if (mounted.current) setError('ZIP export failed; session retained for retry: '+(cause as Error).message);
      throw cause;
    }).finally(() => {
      exporting.delete(id);if (mounted.current) setExportingId(current => current === id ? null : current);
    });
    entry.promise=promise;exporting.set(id,entry);return promise;
  }, []);
  const deleteSession = useCallback((id:string) => {
    if (exporting.has(id)) return;
    retainedSessions.delete(id);notifyRetainedSessions();
  }, []);
  return {...camera,startRecording,stopRecording,isRecording:phase!=='idle',error:error??camera.error,
    phase,missing,evaluationStartMs,sessions,downloadSession,deleteSession,exportingId,notifyConfigurationChange};
}
