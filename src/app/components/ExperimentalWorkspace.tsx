import {useMemo,useState} from 'react';
import {useExperimentalSessions} from '../hooks/useExperimentalSessions';
import {experimentRegistry} from '../experiment/registry';
import {importExperiment,exportExperiment,downloadExperimentBlob} from '../experiment/archive';
import {evaluateExperimentalSession,independentSource,mappingCurrent} from '../experiment/evaluation';
import type {ExperimentPipeline,StoredExperiment} from '../experiment/types';
import type {EvaluationConfig} from '../evaluation/types';
import {ExperimentalVisualPlayback} from './ExperimentalVisualPlayback';
import {OfflineEvaluationDashboard} from './OfflineEvaluationDashboard';
export function OpenExperimentalComparison({pipeline}:{pipeline:ExperimentPipeline}){return <button className="bg-indigo-900 rounded p-2" onClick={()=>experimentRegistry.navigate(pipeline)}>Comparison</button>;}
const pipelines=['P1','P2','P3','P4'] as const;
export function experimentalMetricCsv(report:unknown){
  const rows:string[][]=[['metric_path','value']];const walk=(v:unknown,path:string)=>{if(v===null||typeof v!=='object'){rows.push([path,String(v??'')]);return;}for(const [k,item]of Object.entries(v))walk(item,path?path+'.'+k:k);};walk(report,'');
  return rows.map(r=>r.map(s=>'"'+s.replaceAll('"','""')+'"').join(',')).join('\r\n');
}
export function ExperimentalWorkspace(){
  const snapshot=useExperimentalSessions();const [selected,setSelected]=useState(''),[pipeline,setPipeline]=useState<ExperimentPipeline>(snapshot.navigation?.pipeline??'P4'),[error,setError]=useState('');
  const [nav,setNav]=useState(snapshot.navigation?.serial??0);
  if(nav!==(snapshot.navigation?.serial??0)){setNav(snapshot.navigation?.serial??0);setPipeline(snapshot.navigation?.pipeline??'P4');}
  const entry=snapshot.sessions.find(s=>s.manifest.sessionId===selected)??snapshot.sessions.at(-1),m=entry?.manifest;
  const busy=!!m&&['recording','finalizing'].includes(m.status);
  const update=(fn:(entry:StoredExperiment)=>void)=>{if(!entry||busy)return;fn(entry);experimentRegistry.put(entry);};
  const source=useMemo(()=>m&&(pipeline==='P4'||m.offline[pipeline])?independentSource(m,pipeline):undefined,[m,pipeline,snapshot]);
  let report:ReturnType<typeof evaluateExperimentalSession>|null=null,reportError='';try{if(m&&!busy)report=evaluateExperimentalSession(m);}catch(e){reportError=String(e);}
  const saveConfig=(config:EvaluationConfig)=>update(entry=>{entry.manifest.evaluationConfigurations[pipeline]=config;if(pipeline==='P4')entry.manifest.annotations=config.annotations.filter(a=>a.coordinate==='time_ms');});
  const [offsetA,setOffsetA]=useState(''),[offsetB,setOffsetB]=useState('');
  return <main className="min-h-screen bg-gray-950 text-gray-200 p-6 space-y-5">
    <h1 className="text-2xl">Experimental sessions ? live P4 / offline P1?P3</h1>
    <p>Record one movement in P4 Comparison, then run P1?P3 on its camera videos. No offline P4 recomputation. Export the ZIP before refresh; sessions are held in memory.</p>
    <label>Import experiment ZIP <input aria-label="Import experiment ZIP" type="file" accept=".zip" onChange={e=>{const file=e.target.files?.[0];if(file)void importExperiment(file).then(imported=>{const existing=experimentRegistry.get(imported.manifest.sessionId);if(existing)throw Error('This session ID is already loaded. Remove it before importing; existing results were preserved.');experimentRegistry.put(imported);setSelected(imported.manifest.sessionId);setError('');}).catch(e=>setError(String(e)));e.target.value='';}}/></label>
    <label>Session <select aria-label="Experimental session" className="bg-gray-800 p-2" value={m?.sessionId??''} onChange={e=>setSelected(e.target.value)}>{snapshot.sessions.map(s=><option key={s.manifest.sessionId} value={s.manifest.sessionId}>{s.manifest.sessionId} ? {s.manifest.status}</option>)}</select></label>
    {!entry&&<p>No P4 experiment is loaded. Open the P4 lab ? Comparison ? Start Analysis.</p>}
    {(error||reportError)&&<p role="alert">{error||reportError}</p>}
    {m&&entry&&<>
      <section className="border border-gray-700 p-4 space-y-2"><h2>Capture status: {m.status}</h2><p>{m.sessionId} | {m.durationMs==null?'open':(m.durationMs/1000).toFixed(2)+' s'} | live P4 {m.liveP4.length} cycles | Camera A: {m.cameras.cameraAStatus}, {entry.assets.cameraA?.size??0} bytes | Camera B: {m.cameras.cameraBStatus}, {entry.assets.cameraB?.size??0} bytes</p>
        <p>{pipelines.map(id=>id+': '+(id==='P4'?(m.liveP4.length?'retained live':'missing'):m.offline[id]?m.offline[id]!.status+(mappingCurrent(m,m.offline[id]!)?'':' (mapping changed; rerun)'):'not processed')).join(' | ')}</p>
        <p>{m.status==='ready'&&['P1','P2','P3'].every(id=>m.offline[id as 'P1']?.status==='complete'&&mappingCurrent(m,m.offline[id as 'P1']!))?'All pipeline outputs available; inspect alignment coverage separately.':'Four-pipeline experiment incomplete or partial.'}</p>
        <button disabled={busy} onClick={()=>{void exportExperiment(entry).then(blob=>downloadExperimentBlob(blob,'experiment_'+m.sessionId+'.zip')).catch(e=>setError(String(e)));}}>Export experiment ZIP (videos stored once)</button> <button disabled={busy} onClick={()=>{experimentRegistry.remove(m.sessionId);setSelected('');}}>Remove session from memory</button>
        {!!m.errors.length&&<p role="alert">{m.errors.join('; ')}</p>}
        <details><summary>Capture timing, startup and synchronization diagnostics</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(m.cameras,null,2)}</pre></details>
      </section>
      {!busy&&<section className="border border-gray-700 p-4 space-y-2"><h2>Video clock mapping and paired comparison policy</h2>
        <p>Experiment time (ms) = file media time ? 1000 + declared offset. No exact encoded-frame-to-capture mapping is available. A live P4 timestamp is processing start, not exposure. Camera B is selected by declared file-time mapping; actual decoded B PTS is unverified.</p>
        <p>Current A/B mapping: {JSON.stringify(m.cameraMapping)}</p>
        <label>A offset ms <input aria-label="Camera A offset ms" className="bg-gray-800" type="number" value={offsetA} onChange={e=>setOffsetA(e.target.value)}/></label> <label>B offset ms <input aria-label="Camera B offset ms" className="bg-gray-800" type="number" value={offsetB} onChange={e=>setOffsetB(e.target.value)}/></label>
        <button disabled={!offsetA.trim()||!offsetB.trim()||![Number(offsetA),Number(offsetB)].every(Number.isFinite)} onClick={()=>update(e=>{e.manifest.cameraMapping={cameraA:{offsetMs:Number(offsetA),provenance:'user_supplied',uncertaintyMs:null,description:'User-declared video-to-experiment offset; exposure precision unverified.'},cameraB:{offsetMs:Number(offsetB),provenance:'user_supplied',uncertaintyMs:null,description:'User-declared video-to-experiment offset; exposure precision unverified.'}};})}>Apply declared offsets</button>
        <button onClick={()=>{const timing=m.cameras.startupInstrumentation??m.cameras.diagnostics?.startupInstrumentation;const a=timing?.cameraA.startCallExperimentTimeMs,b=timing?.cameraB.startCallExperimentTimeMs;if(a==null||b==null){setError('Recorder-start anchors unavailable. Supply measured offsets.');return;}update(e=>{e.manifest.cameraMapping={cameraA:{offsetMs:a,provenance:'estimated_recorder_start',uncertaintyMs:null,description:'Explicitly accepted estimate: encoded file time zero anchored to recorder.start call; first exposure unknown.'},cameraB:{offsetMs:b,provenance:'estimated_recorder_start',uncertaintyMs:null,description:'Explicitly accepted estimate: encoded file time zero anchored to recorder.start call; first exposure unknown.'}};});}}>Accept estimated recorder-start anchors</button>
        <label>Matching tolerance ms <input aria-label="Matching tolerance ms" className="bg-gray-800 w-20" type="number" min="0" value={m.alignment.toleranceMs} onChange={e=>{const value=Number(e.target.value);if(Number.isFinite(value)&&value>=0)update(e=>{e.manifest.alignment.toleranceMs=value;});}}/></label>
        <label><input type="checkbox" checked={m.alignment.allowEstimated} onChange={e=>update(x=>{x.manifest.alignment.allowEstimated=e.target.checked;})}/> Allow explicitly estimated alignment in paired metrics (uncertainty unmeasured)</label>
        <p>Mapping changes require rerunning stereo processing. Independent metrics remain available on their native timeline. No interpolation over gaps or fabricated matches.</p>
      </section>}
      <div className="flex gap-3">{pipelines.map(id=><button className="rounded bg-indigo-900 p-2" key={id} onClick={()=>setPipeline(id)}>{id==='P4'?'Live P4 results':id+' playback / results'}</button>)}</div>
      {!busy&&pipeline!=='P4'&&<ExperimentalVisualPlayback key={m.sessionId+pipeline} entry={entry} pipeline={pipeline}/>}
      {report&&<section className="border border-gray-700 p-4 space-y-2"><h2>Independent pipeline availability (native observations)</h2>
        <table className="text-sm w-full text-left"><thead><tr><th>Pipeline / origin</th><th>Scope samples</th><th>Elbow availability</th><th>Wrist availability</th><th>Units</th></tr></thead><tbody>{pipelines.map(id=>{const scope=report!.independent[id]?.scopes[0];return <tr key={id}><td>{id} {id==='P4'?'original live':'offline'}</td><td>{scope?.frameCount??'not processed'}</td><td>{scope?.availability.rightElbow.availabilityPercent??'unavailable'}%</td><td>{scope?.availability.rightWrist.availabilityPercent??'unavailable'}%</td><td>{id==='P1'?'normalized image XY':'calibration mm'}</td></tr>;})}</tbody></table>
        <h2>Aligned P3 offline versus original live P4</h2>
        <p>{report.alignedP3P4.reason} Matched {report.alignedP3P4.matchedSamples}; unmatched P3 {report.alignedP3P4.unmatchedOffline}, P4 {report.alignedP3P4.unmatchedLive}; coverage P3/P4 {report.alignedP3P4.offlineCoveragePercent??'unavailable'}% / {report.alignedP3P4.liveCoveragePercent??'unavailable'}%.</p>
        <details><summary>Matched availability, recovery, segment and continuity differences</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify({measurement:report.alignedP3P4,phases:report.alignedPhases,definition:report.pairedScopeDefinition},null,2)}</pre></details>
        <button onClick={()=>downloadExperimentBlob(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),'experimental_evaluation_'+m.sessionId+'.json')}>Export evaluation JSON</button> <button onClick={()=>downloadExperimentBlob(new Blob([experimentalMetricCsv(report)],{type:'text/csv'}),'experimental_evaluation_'+m.sessionId+'.csv')}>Export evaluation CSV</button>
      </section>}
      {!busy&&source&&<OfflineEvaluationDashboard key={m.sessionId+pipeline+(pipeline==='P4'?'':m.offline[pipeline]?.runId)} providedSource={source} onlyPipeline={pipeline} initialConfig={m.evaluationConfigurations[pipeline]??{annotations:pipeline==='P4'||m.offline[pipeline]?.cameraMapping.cameraA?m.annotations:[]}} onConfigChange={saveConfig}/>}
      <details><summary>Interpretation and limitations</summary>{m.limitations.map(x=><p key={x}>{x}</p>)}<p>Independent availability is not positional accuracy. P1 image coordinates cannot be directly compared with metric 3D distances.</p></details>
    </>}
  </main>;
}
