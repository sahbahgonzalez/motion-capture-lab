import {useEffect,useState} from 'react';
import type {useLiveP4Experiment} from '../hooks/useLiveP4Experiment';
import type {ComparisonFrame} from '../type/pipelineComparison';
import {SkeletonView} from './PoseSkeletonView';
import {emptyComparisonPose} from '../utils/pipelineComparison';
import {experimentRegistry} from '../experiment/registry';
import {downloadExperimentBlob,exportExperiment} from '../experiment/archive';
export function LiveP4ExperimentPanel({experiment,frame,getConfiguration,camerasActive,processing,imuConnected,calibrated,error}:{experiment:ReturnType<typeof useLiveP4Experiment>;frame:ComparisonFrame|null;getConfiguration:()=>unknown;camerasActive:boolean;processing:boolean;imuConnected:boolean;calibrated:boolean;error:string|null}){
  const [warmup,setWarmup]=useState(3),[exportError,setExportError]=useState('');
  const session=experiment.session?.manifest,active=session?.status==='recording',busy=active||session?.status==='finalizing',diag=frame?.fusion;
  const [now,setNow]=useState(()=>performance.now());
  useEffect(()=>{if(!active)return;setNow(performance.now());const timer=setInterval(()=>setNow(performance.now()),200);return()=>clearInterval(timer);},[active,session?.sessionId]);
  const elapsed=active&&session?Math.max(0,now-session.originPerformanceNowMs):session?.durationMs??0;
  const fresh=diag?.imu01AgeMs!=null&&diag?.imu02AgeMs!=null&&diag.imu01AgeMs<=500&&diag.imu02AgeMs<=500;
  const ready=camerasActive&&processing&&imuConnected&&calibrated&&fresh;
  return <section aria-label="P4 live experimental comparison" className="space-y-3 text-gray-200">
    <h2 className="text-xl">P4 Comparison ? live experiment</h2>
    <p>Cameras: {camerasActive?'ready':'inactive'} | Processing: {processing?'running':'stopped'} | IMU socket: {imuConnected?'connected':'disconnected'} | Both IMUs: {fresh?'recent packets':'stale/unavailable'} | Stereo + arm calibration: {calibrated?'loaded':'required'}</p>
    <label>Warmup seconds <input aria-label="Analysis warmup seconds" className="bg-gray-800 w-20" type="number" min="0" disabled={busy} value={warmup} onChange={e=>setWarmup(Number(e.target.value))}/></label>
    <button className="rounded bg-green-800 p-2 disabled:opacity-40" disabled={busy||!ready||!Number.isFinite(warmup)||warmup<0} onClick={()=>experiment.start(warmup*1000,getConfiguration())}>Start Analysis</button> <button className="rounded bg-red-800 p-2 disabled:opacity-40" disabled={!active} onClick={()=>void experiment.stop()}>Stop Analysis</button>
    <p>{session?.status??'Ready for setup'} | {session?.liveP4.length??0} live P4 cycles | {(elapsed/1000).toFixed(2)} s</p>
    <p>Camera A: {experiment.cameraDiagnostics?.cameraAStatus??session?.cameras.cameraAStatus??'inactive'} | Camera B: {experiment.cameraDiagnostics?.cameraBStatus??session?.cameras.cameraBStatus??'inactive'}</p>
    <p>Upper arm: {diag?.uaState??'UNAVAILABLE'} ({diag?.uaFailureReason??'no failure reason'}) | Forearm: {diag?.faState??'UNAVAILABLE'} ({diag?.faFailureReason??'no failure reason'})</p>
    <p>Recovery blend UA/FA: {diag?.blendAlphaUA??'-'} / {diag?.blendAlphaFA??'-'}. Segment-length deviations are diagnostics only.</p>
    <details><summary>Live controller, length and processing diagnostics</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify({fusion:diag,processingMs:frame?.processingDurationMs,errors:frame?.errors},null,2)}</pre></details>
    <SkeletonView pose3D={frame?.pipelines.P4.pose??emptyComparisonPose()} view="front" width={600} height={320}/>
    {(error||experiment.error||exportError)&&<p role="alert">{error??experiment.error??exportError}</p>}
    {session&&!busy&&<><p>Session {session.sessionId}: {session.cameras.status} camera capture; videos A/B {experiment.session?.assets.cameraA?.size??0}/{experiment.session?.assets.cameraB?.size??0} bytes. {session.status==='ready'?'Capture finalized; visual pipelines still require offline processing.':'Partial/failed capture ? inspect errors before comparison.'}</p>
      <button className="bg-blue-800 p-2 rounded" onClick={()=>{void exportExperiment(experiment.session!).then(blob=>downloadExperimentBlob(blob,'experiment_'+session.sessionId+'.zip')).catch(e=>setExportError(String(e)));}}>Export experiment ZIP</button>
      {(['P1','P2','P3','P4'] as const).map(p=><button className="bg-gray-800 p-2 rounded m-1" key={p} onClick={()=>experimentRegistry.navigate(p)}>{p==='P4'?'Session results / evaluation':p+' playback'}</button>)}
      {!!session.errors.length&&<p role="alert">{session.errors.join('; ')}</p>}
    </>}
    <p className="text-xs text-amber-300">P4 outputs and both camera videos share one session and experiment origin. No raw IMU replay is recorded. Browser timestamps do not establish hardware synchronization. Sessions remain in memory until exported; export before refresh.</p>
  </section>;
}
