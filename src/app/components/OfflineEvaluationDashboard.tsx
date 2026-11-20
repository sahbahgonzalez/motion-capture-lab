import {ComparativeAnalysisPanel} from './ComparativeAnalysisPanel';
import {independentProjection} from '../experiment/evaluation';
import {Children,isValidElement,memo,useEffect,useMemo,useRef,useState,type ReactElement} from 'react';
import {Bar,BarChart,CartesianGrid,Legend,Line,LineChart,ReferenceLine,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {LANDMARK_KEYS} from '../hooks/useTriangulation';
import type {PipelineId} from '../type/pipelineComparison';
import {evaluateSession} from '../evaluation/metrics';
import {DEFAULT_EVALUATION_CONFIG} from '../evaluation/configuration';
import {PIPELINE_IDS,SEGMENTS,STATES} from '../evaluation/importSession';
import {evaluationCsv,evaluationSidecar,evaluationSummary,metricsRows} from '../evaluation/exports';
import type {Annotation,EvaluationConfig,EvaluationReport,Joint,Segment,State} from '../evaluation/types';
import {at,object} from '../evaluation/statistics';

const colors={P1:'#a78bfa',P2:'#60a5fa',P3:'#34d399',P4:'#fb923c'};
const box='rounded border border-gray-700 bg-gray-900 p-4 space-y-3';
const control='rounded bg-gray-800 border border-gray-600 p-2 text-sm';
const button='rounded bg-blue-800 px-3 py-2 text-sm disabled:opacity-40';
const number=(v:number|null|undefined,digits=2)=>v==null?'Unavailable':v.toFixed(digits);
function download(text:string,name:string,type='text/plain'){
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Plot({title,children,hasData,emptyReason='No valid observations or timing measurements are available for this chart in the selected phase.'}:{title:string;children:ReactElement;hasData?:boolean;emptyReason?:string}){
  const props=children.props as {data?:Record<string,unknown>[];children?:unknown};
  const keys=Children.toArray(props.children as any).filter(isValidElement).filter(c=>c.type===Line||c.type===Bar).map(c=>(c.props as {dataKey:string}).dataKey);
  const available=hasData??props.data?.some(row=>keys.some(key=>typeof row[key]==='number'&&Number.isFinite(row[key])));
  return <div className={box+' min-w-0'}><h3 className="font-semibold">{title}</h3>{available?<div style={{height:260,minWidth:0}}><ResponsiveContainer width="100%" height="100%" initialDimension={{width:640,height:260}} minWidth={0} debounce={100}>{children}</ResponsiveContainer></div>:<p role="status" className="text-sm text-amber-200">{emptyReason}</p>}</div>;
}
function ControllerTooltip({active,payload}:{active?:boolean;payload?:Array<{payload:any}>}){
  if(!active||!payload?.length)return null;const row=payload[0].payload;
  return <div className="bg-gray-950 border border-gray-600 rounded p-3 text-xs"><p>{number(row.t*1000,3)} ms | cycle {row.cycleId??'unknown'}</p><p>Upper arm: {STATES[row.upperArm]??'UNKNOWN'} - {row.uaReason??'no recorded reason'}</p><p>Forearm: {STATES[row.forearm]??'UNKNOWN'} - {row.faReason??'no recorded reason'}</p><p>{row.events||'No recorded state transition at this cycle'}</p></div>;
}
const axis={stroke:'#9ca3af',fontSize:11};
const tooltipStyle={backgroundColor:'#111827',border:'1px solid #6b7280',color:'#fff'};

export const OfflineEvaluationDashboard=memo(function OfflineEvaluationDashboard({providedSource,onlyPipeline,initialConfig,onConfigChange}:{providedSource?:unknown;onlyPipeline?:PipelineId;initialConfig?:Partial<EvaluationConfig>;onConfigChange?:(config:EvaluationConfig)=>void}={}){
  const [documents,setDocuments]=useState<Array<{key:string;name:string;source:unknown}>>([]),[selected,setSelected]=useState('');
  const [config,setConfig]=useState<EvaluationConfig>(()=>({...structuredClone(DEFAULT_EVALUATION_CONFIG),...initialConfig}));
  const [scopeId,setScopeId]=useState('whole'),[pipeline,setPipeline]=useState<PipelineId|'all'>(onlyPipeline??'all'),[joint,setJoint]=useState<Joint>(initialConfig?.comparative?.joint??'rightWrist'),[segment,setSegment]=useState<Segment>('rightForearm');
  const [error,setError]=useState<string|null>(null),[label,setLabel]=useState('Visible baseline'),[coordinate,setCoordinate]=useState<Annotation['coordinate']>('time_ms'),[start,setStart]=useState('0'),[end,setEnd]=useState('1000'),[healthy,setHealthy]=useState(false),[annotationKind,setAnnotationKind]=useState<Annotation['kind']>('custom');
  const [search,setSearch]=useState(''),[page,setPage]=useState(0),[selectedEvent,setSelectedEvent]=useState<number|null>(null);
  const supplied=useMemo(()=>providedSource?{key:'provided',name:'Experimental pipeline',source:providedSource}:null,[providedSource]);
  const current=supplied??documents.find(d=>d.key===selected);
  const lastGood=useRef<EvaluationReport|null>(null);
  const evaluation=useMemo(()=>{if(!current)return {report:null,error:null};try{const report=evaluateSession(current.source,config);lastGood.current=report;return {report,error:null};}catch(e){return {report:lastGood.current,error:'Showing the last valid report until configuration is corrected: '+String(e)};}},[current,config]);
  useEffect(()=>{if(!evaluation.error)onConfigChange?.(config);},[config,evaluation.error]);
  const report=evaluation.report,scope=report?.scopes.find(s=>s.id===scopeId)??report?.scopes[0];
  const frameSet=useMemo(()=>new Set(scope?.frameIndices??[]),[scope]);
  const frames=useMemo(()=>report?.frames.filter(f=>frameSet.has(f.index))??[],[report,frameSet]);
  const motionId=pipeline==='all'?'P4':pipeline;
  const chartData=useMemo(()=>{
    const motion=scope?.motion[motionId][joint],samples=new Map(motion?.samples.map(s=>[s.index,s]));
    const timed=frames.filter(f=>f.timeMs!==null);
    return timed.flatMap((f,index)=>{
      const lengths=Object.fromEntries((['P2','P3','P4'] as const).map(id=>{
        const [a,b]=SEGMENTS[segment].joints,p=f.pipelines[id][a],q=f.pipelines[id][b];
        return[id,p.valid&&q.valid?Math.hypot(p.point!.x-q.point!.x,p.point!.y-q.point!.y,p.point!.z-q.point!.z):null];
      }));
      const previous=index>0?timed[index-1]:null;
      const dt=previous&&previous.index+1===f.index&&previous.timeMs!==null&&f.timeMs!>previous.timeMs?f.timeMs!-previous.timeMs:null;
      const row={t:f.timeMs!/1000,index:f.index,cycleId:f.cycleId,uaReason:f.controllers.upperArm.reason,faReason:f.controllers.forearm.reason,events:report?.events.filter(e=>e.index===f.index).map(e=>e.controller+': '+e.from+' -> '+e.to+' ('+(e.reason??'reason unavailable')+')').join('; '),upperArm:STATES.indexOf(f.controllers.upperArm.state),forearm:STATES.indexOf(f.controllers.forearm.state),
        ...lengths,reference:f.calibratedLengths[segment]??null,displacement:samples.get(f.index)?.displacement??null,speed:samples.get(f.index)?.speed??null,
        processing:f.processingMs,inference:f.inferenceMs,interval:dt,fps:dt!==null?1000/dt:null,
        largeDisplacement:samples.get(f.index)&&samples.get(f.index)!.displacement>(motionId==='P1'?config.jumpDistanceNormalizedXY:config.jumpDistanceMm)?samples.get(f.index)!.displacement:null,
        activationDisplacement:samples.get(f.index)?.nearActivation?samples.get(f.index)!.displacement:null,recoveryDisplacement:samples.get(f.index)?.nearRecovery?samples.get(f.index)!.displacement:null};
      // A duplicate timestamp null separator breaks chart lines without inventing
      // interpolated observation times or bridging excluded phases/timing gaps.
      const gap=!!previous&&(previous.index+1!==f.index||dt===null||dt>config.maxObservationGapMs);
      return gap?[{t:row.t,index:-1,upperArm:null,forearm:null,P2:null,P3:null,P4:null,reference:null,displacement:null,speed:null,processing:null,inference:null,interval:null,fps:null,largeDisplacement:null,activationDisplacement:null,recoveryDisplacement:null},row]:[row];
    });
  },[frames,scope,motionId,joint,segment,config,report]);
  const rows=useMemo(()=>report?metricsRows(report).filter(r=>r.scope===(scope?.id??'whole')&&(pipeline==='all'||r.pipeline===pipeline||r.pipeline==='shared'||(!onlyPipeline&&r.pipeline==='P3_vs_P4')||r.pipeline==='all')&&(`${r.metric} ${r.jointOrSegment} ${r.pipeline}`).toLowerCase().includes(search.toLowerCase())):[],[report,scope,pipeline,search]);
  const update=<K extends keyof EvaluationConfig>(key:K,value:EvaluationConfig[K])=>{setConfig(c=>({...c,[key]:value}));setPage(0);};
  const select=(key:string)=>{lastGood.current=null;setSelected(key);setConfig(structuredClone(DEFAULT_EVALUATION_CONFIG));setScopeId('whole');setPage(0);setError(null);};
  async function importFiles(files:FileList|null){
    if(!files)return;const accepted:Array<{key:string;name:string;source:unknown}>=[],errors:string[]=[];
    for(const file of Array.from(files)){try{const source=JSON.parse(await file.text());evaluateSession(source,object(at(source,'evaluationMetadata','config')) as Partial<EvaluationConfig>);accepted.push({key:file.name+':'+file.lastModified+':'+file.size,name:file.name,source});}catch(e){errors.push(file.name+': '+String(e));}}
    if(accepted.length){setDocuments(old=>[...old.filter(d=>!accepted.some(a=>a.key===d.key)),...accepted]);select(accepted[accepted.length-1].key);setConfig({...structuredClone(DEFAULT_EVALUATION_CONFIG),...object(at(accepted[accepted.length-1].source,'evaluationMetadata','config'))} as EvaluationConfig);}
    setError(errors.length?errors.join('\n'):null);
  }
  async function importSidecar(file:File|undefined){if(!file||!report)return;try{const value=object(JSON.parse(await file.text()));
    if(value.schemaVersion!=='1.0.0-evaluation-sidecar'||value.sessionId!==report.source.sessionId||at(value,'sourceFingerprint','value')!==report.source.fingerprint.value)throw new Error('Sidecar version/session/fingerprint does not match this recording.');
    const imported=object(value.config) as Partial<EvaluationConfig>;evaluateSession(current!.source,imported);setConfig({...DEFAULT_EVALUATION_CONFIG,...imported});setError(null);
  }catch(e){setError(String(e));}}
  const addAnnotation=()=>{const a:Annotation={id:'phase-'+(config.annotations.length+1)+'-'+config.annotations.map(a=>a.id).join('').length,label,coordinate,start:Number(start),end:Number(end),healthyVisibility:healthy,kind:annotationKind};
    try{const next={...config,annotations:[...config.annotations,a]};evaluateSession(current!.source,next);setConfig(next);setError(null);}catch(e){setError(String(e));}};
  const stateFilter=config.controllerFilter?config.controllerFilter.controller+':'+config.controllerFilter.state:'all';
  const shownPipelines=pipeline==='all'?(onlyPipeline?[onlyPipeline]:PIPELINE_IDS):[pipeline];
  const availabilityData=useMemo(()=>shownPipelines.map(id=>({pipeline:id,availability:scope?.availability[id][joint].availabilityPercent??null,valid:scope?.availability[id][joint].validFrames??0,missing:scope?.availability[id][joint].missingFrames??0})),[scope,pipeline,onlyPipeline,joint]);
  const improvementData=useMemo(()=>scope?(['rightShoulder','rightElbow','rightWrist'] as const).map(j=>({joint:j,P3:scope.availability.P3[j].availabilityPercent,P4:scope.availability.P4[j].availabilityPercent,recovered:scope.p3VersusP4[j].recoveredByP4,lost:scope.p3VersusP4[j].lostByP4})):[],[scope]);
  const intervals=chartData.filter(row=>row.index>=0&&row.interval!==null).map(row=>row.interval!);
  const intervalBins=[16.67,33.33,50,100,250,Infinity].map((upper,index,limits)=>({range:index===0?'0-16.67':(limits[index-1]+'-'+(Number.isFinite(upper)?upper:'infinity')),count:intervals.filter(value=>value>(index===0?0:limits[index-1])&&value<=upper).length}));
  const anatomyId=pipeline==='P1'?null:pipeline==='all'?'P4':pipeline;
  const anatomical=anatomyId&&scope?scope.anatomical[anatomyId][segment]:null;
  const eventLines=(controller:'upperArm'|'forearm',yAxisId:string|number=0)=>report?.events.filter(e=>e.controller===controller&&e.timeMs!==null&&frameSet.has(e.index)&&(e.kind==='correction_activation'||e.kind==='recovery_entry')).map((e,i)=><ReferenceLine key={controller+i} x={e.timeMs!/1000} yAxisId={yAxisId} stroke={e.kind==='correction_activation'?'#f87171':'#22d3ee'} strokeDasharray="3 3" />);
  return <main className="bg-gray-950 text-gray-200 min-h-screen p-6 space-y-5 max-w-screen-2xl mx-auto">
    <h1 className="text-2xl font-bold">{onlyPipeline?onlyPipeline+' independent evaluation':'Comparison Evaluation'}</h1>
    <p>Evaluate archived final poses without cameras, IMUs, reconstruction, or fusion replay. Availability is not positional accuracy.</p>
    {!providedSource&&<section className={box}>
      <label className={button}>Import comparison JSON <input aria-label="Import comparison recordings" type="file" accept=".json" multiple className="ml-3" onChange={e=>{void importFiles(e.target.files);e.target.value='';}} /></label>
      {!!documents.length&&<label className="block">Recording <select className={control+' ml-2'} aria-label="Recording" value={selected} onChange={e=>select(e.target.value)}>{documents.map(d=><option key={d.key} value={d.key}>{d.name}</option>)}</select></label>}
      <p className="text-xs text-gray-400">Supports current and earlier P1-P4 comparison JSON exports. Original files are never modified. Stage 2C ZIPs contain streams, not evaluated final P1-P4 poses; single-pipeline recordings remain available in the existing Analyze tool.</p>
    </section>}
    {(error||evaluation.error)&&<p role="alert" className="rounded bg-red-950 p-3 text-red-200">{error??evaluation.error}</p>}
    {report&&scope&&<>
      <section className={box}>
        <h2 className="font-semibold">Experiment overview</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Experiment summary cards">{[
          ['Session duration',number(report.summary.durationMs===null?null:report.summary.durationMs/1000)+' s'],['Measurement cycles',report.summary.measurementCycles],['Selected scope cycles',scope.frameCount],['Effective cadence',number(scope.performance.effectiveFps)+' Hz'],
          ['IMU influence (correction + recovery)',number(scope.imuActivePercent)+'% ('+scope.imuActiveFrames+'/'+scope.imuActiveKnownFrames+' known)'],['Recorded error cycles',scope.dataQuality.recordedErrorCycles],
          ['Upper-arm activations',scope.controllers.upperArm.correctionActivations],['Forearm activations',scope.controllers.forearm.correctionActivations],
        ].map(([label,value])=><div className="rounded bg-gray-800 p-3" key={label}><p className="text-xs text-gray-400">{label}</p><p className="text-lg font-semibold">{value}</p></div>)}</div>
        <div className="flex flex-wrap gap-4 text-sm">{shownPipelines.map(id=>{const valid=frames.filter(f=>LANDMARK_KEYS.every(j=>f.pipelines[id][j].valid)).length,arm=frames.filter(f=>(['rightShoulder','rightElbow','rightWrist'] as const).every(j=>f.pipelines[id][j].valid)).length;return <p key={id}>{id}: right-arm complete {arm}/{scope.frameCount}; all 13 tracked landmarks complete {valid}/{scope.frameCount}; {scope.frameCount-valid} cycles with one or more missing landmarks</p>;})}</div>
        {!!report.warnings.length&&<details><summary>Recording quality / completeness warnings</summary><ul className="list-disc pl-5 text-sm text-amber-200">{report.warnings.filter(w=>!onlyPipeline||!w.includes('pipeline records absent')).map(w=><li key={w}>{w}</li>)}</ul></details>}
        <p>{report.source.sessionId} | {number(report.summary.durationMs===null?null:report.summary.durationMs/1000)} s | {report.summary.totalCycles} cycles | {report.summary.measurementCycles} measurement | {report.summary.warmupCycles} warmup | {report.summary.unclassifiedCycles} unclassified</p>
        {report.summary.stopReason&&report.summary.stopReason!=='user_stop'&&<p role="alert" className="text-amber-200">Analysis interrupted: {report.summary.stopReason}. Retained observations are available; a normally completed physical trial is not assumed.</p>}
        <p>Schema {report.source.schema}; engine {report.engineVersion}; fingerprint {report.source.fingerprint.value}; {onlyPipeline?independentProjection(report,onlyPipeline).summary.completeness:report.summary.completeness}</p>
        <p>Selected scope: {scope.frameCount} cycles, {number(scope.performance.effectiveFps)} Hz cadence. {onlyPipeline&&onlyPipeline!=='P4'?'Offline playback processing':'Live shared processing'} median/p95: {number(scope.performance.processingDurationMs.median)}/{number(scope.performance.processingDurationMs.p95)} ms.</p>
        <details><summary>Recorded configurations and geometry versions</summary><pre className="text-xs whitespace-pre-wrap max-h-64 overflow-auto">{JSON.stringify(report.configurations,null,2)}</pre></details>
        <div className="flex flex-wrap gap-2">{([
          ['Session with annotations',()=>download(JSON.stringify({...object(current!.source),evaluationMetadata:{schemaVersion:'1.0.0-comparative-annotations',annotations:config.annotations,config}},null,2),`annotated_session_${report.source.sessionId}.json`,'application/json')],
          ['Report JSON',()=>download(JSON.stringify(onlyPipeline?independentProjection(report,onlyPipeline):report,null,2),`evaluation_${report.source.sessionId}.json`,'application/json')],
          ['Metrics CSV',()=>download(onlyPipeline?['scope,pipeline,jointOrSegment,metric,value,unit',...metricsRows(report).filter(r=>r.pipeline===onlyPipeline||r.pipeline==='shared').map(r=>[r.scope,r.pipeline,r.jointOrSegment,r.metric,r.value,r.unit].map(v=>JSON.stringify(v??'')).join(','))].join('\n'):evaluationCsv(report),`evaluation_${report.source.sessionId}.csv`,'text/csv')],
          ['Results summary',()=>download(onlyPipeline?JSON.stringify(independentProjection(report,onlyPipeline),null,2):evaluationSummary(report),`evaluation_${report.source.sessionId}_summary.txt`)],
          ['Config / annotations sidecar',()=>download(evaluationSidecar(report),`evaluation_${report.source.sessionId}_config.json`,'application/json')],
        ] as const).map(([title,action])=><button className={button} key={title} disabled={!!evaluation.error} onClick={action}>{title}</button>)}</div>
        <label className="block text-sm">Import matching config sidecar <input type="file" accept=".json" aria-label="Import evaluation sidecar" onChange={e=>{void importSidecar(e.target.files?.[0]);e.target.value='';}} /></label>
      </section>
      <section className={box}>
        <h2 className="font-semibold">Filters and analysis-only thresholds</h2><div className="flex flex-wrap gap-3 items-center">
          <label>Pipeline <select className={control} value={pipeline} onChange={e=>{setPipeline(e.target.value as PipelineId|'all');setPage(0);}}>{!onlyPipeline&&<option value="all">All</option>}{(onlyPipeline?[onlyPipeline]:PIPELINE_IDS).map(p=><option key={p}>{p}</option>)}</select></label>
          <label>Joint <select className={control} value={joint} onChange={e=>{const joint=e.target.value as Joint;setJoint(joint);setConfig(c=>({...c,comparative:{...c.comparative,joint}}));}}>{LANDMARK_KEYS.map(j=><option key={j}>{j}</option>)}</select></label>
          <label>Phase <select className={control} value={scope.id} onChange={e=>{setScopeId(e.target.value);setPage(0);}}>{report.scopes.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          {(!onlyPipeline||onlyPipeline==='P4')&&<label>Controller state <select className={control} value={stateFilter} onChange={e=>{const [controller,state]=e.target.value.split(':');update('controllerFilter',e.target.value==='all'?null:{controller:controller as 'upperArm'|'forearm',state:state as State});}}><option value="all">All</option>{(['upperArm','forearm'] as const).flatMap(c=>STATES.map(s=><option key={c+s} value={c+':'+s}>{c}: {s}</option>))}</select></label>}
          <label><input type="checkbox" checked={config.includeWarmup} onChange={e=>update('includeWarmup',e.target.checked)} /> Include warmup</label>
          <label><input type="checkbox" checked={config.includeUnclassified} onChange={e=>update('includeUnclassified',e.target.checked)} /> Include unclassified</label>
        </div><details><summary>Advanced analysis thresholds (diagnostics only)</summary><div className="flex flex-wrap gap-4">
          {([['Gap limit (ms)','maxObservationGapMs',1],['Transition neighborhood (ms)','transitionWindowMs',1],['Length deviation (%)','lengthDeviationThresholdFraction',100],['Jump distance (mm)','jumpDistanceMm',1],['Jump speed (mm/s)','jumpSpeedMmPerSecond',1],['P1 jump XY','jumpDistanceNormalizedXY',1],['P1 speed XY/s','jumpSpeedNormalizedXYPerSecond',1]] as const).map(([title,key,scale])=><label key={key} className="text-sm">{title}<input className={control+' block w-32'} type="number" min="0" step="any" value={config[key]*scale} onChange={e=>update(key,Number(e.target.value)/scale)} /></label>)}
        </div><p className="text-xs text-gray-400">These settings only change offline calculations. They never change the live controller. P1 continuity is normalized image XY and cannot be ranked against millimeter 3D speeds.</p></details>
      </section>
      <details className={box}><summary className="font-semibold">User phase annotations</summary><div className="flex flex-wrap gap-2 items-center">
        <label>Annotation kind <select aria-label="Annotation kind" className={control} value={annotationKind} onChange={e=>{const kind=e.target.value as Annotation['kind'];setAnnotationKind(kind);if(kind!=='custom')setLabel(kind!.charAt(0).toUpperCase()+kind!.slice(1));}}>{['custom','stationary','moving','visible','occluded','recovery'].map(kind=><option key={kind}>{kind}</option>)}</select></label>
        <label>Label <input className={control} list="phase-labels" value={label} onChange={e=>setLabel(e.target.value)} /><datalist id="phase-labels">{['Visible baseline','Right-arm occlusion','Both-arm occlusion','Recovery','Unlabeled'].map(x=><option key={x}>{x}</option>)}</datalist></label>
        <select className={control} aria-label="Annotation coordinate" value={coordinate} onChange={e=>setCoordinate(e.target.value as Annotation['coordinate'])}><option value="time_ms">Experiment milliseconds</option><option value="frame_index">Absolute frame indices</option></select>
        <label>Start <input className={control+' w-28'} type="number" value={start} onChange={e=>setStart(e.target.value)} /></label><label>End (exclusive) <input className={control+' w-28'} type="number" value={end} onChange={e=>setEnd(e.target.value)} /></label>
        <label><input type="checkbox" checked={healthy} onChange={e=>setHealthy(e.target.checked)} /> Explicitly healthy visibility</label><button className={button} onClick={addAnnotation}>Add phase</button>
      </div><p className="text-xs text-gray-400">Intervals are half-open. Motion and visibility/recovery layers may overlap; intervals within one layer must remain disjoint. Frame indices include warmup and are zero-based. User labels are separate from recorded controller states. Save the sidecar to retain annotations.</p>
      {config.annotations.map(a=><p key={a.id}>{a.label} ({a.kind??'custom'}): [{a.start}, {a.end}) {a.coordinate}; healthy={String(a.healthyVisibility)} <button className="text-red-300" onClick={()=>{setConfig(c=>({...c,annotations:c.annotations.filter(x=>x.id!==a.id),comparative:{...c.comparative,stationaryIds:c.comparative?.stationaryIds?.filter(id=>id!==a.id),movingIds:c.comparative?.movingIds?.filter(id=>id!==a.id)}}));setScopeId('whole');}}>Remove</button></p>)}</details>
      <section className={box}><h2 className="font-semibold">B. {joint}: pipeline joint availability</h2>{!onlyPipeline&&<p>P4 recovered {scope.p3VersusP4[joint].recoveredByP4} cycles; lost {scope.p3VersusP4[joint].lostByP4}; both valid {scope.p3VersusP4[joint].bothValid}; both invalid {scope.p3VersusP4[joint].bothInvalid}; net {number(scope.p3VersusP4[joint].improvementPercentagePoints)} percentage points.</p>}
        {(!onlyPipeline||onlyPipeline==='P4')&&<p>Combined IMU-active flags/states: {scope.imuActiveFrames}/{scope.imuActiveKnownFrames} ({number(scope.imuActivePercent)}%). Missing active-state information is not counted as inactive.</p>}
        <Plot title={joint+' availability (%)'} hasData={scope.frameCount>0} emptyReason="No cycles are selected. Include warmup or select a populated phase to evaluate joint availability."><BarChart data={availabilityData}><CartesianGrid stroke="#374151"/><XAxis {...axis} dataKey="pipeline"/><YAxis {...axis} domain={[0,100]} unit="%"/><Tooltip contentStyle={tooltipStyle}/><Legend/><Bar name="Joint availability (%)" dataKey="availability" fill="#60a5fa" isAnimationActive={false} /></BarChart></Plot>
        <div className="flex flex-wrap gap-4 text-sm">{availabilityData.map(row=><p key={row.pipeline}>{row.pipeline}: {row.valid} valid / {row.missing} missing ({number(row.availability)}%); {scope.availability[row.pipeline][joint].missingIntervals.length} missing intervals; longest / mean complete duration {number(scope.availability[row.pipeline][joint].longestMissingIntervalMs)} / {number(scope.availability[row.pipeline][joint].meanCompleteMissingIntervalMs)} ms (boundary runs may be censored)</p>)}</div>
        <p className="text-xs text-gray-400">Availability is joint presence/validity, not positional accuracy. P1 normalized image coordinates are never compared numerically with metric stereo coordinates.</p>
      </section>
      <section className={box}><h3>Camera-specific visibility evidence for {joint}</h3><p>P1 requires Camera A; stereo requires both camera observations at visibility at least 0.5 plus a valid reconstruction. IMU-reconstructed output availability is a different source of evidence.</p>{(['cameraA','cameraB'] as const).map(camera=>{const values=frames.map(f=>f.cameraConfidence?.[camera]?.[joint]),known=values.filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));return <p key={camera}>{camera}: {known.length} known scores; {known.filter(v=>v<.5).length} below 0.5; {values.length-known.length} unavailable/invalid. No confidence values are invented.</p>;})}</section>
      <ComparativeAnalysisPanel report={report} onlyPipeline={onlyPipeline} onChange={setConfig}/>
      {!onlyPipeline&&<section className={box}><h2 className="font-semibold">P3 versus P4 improvement - shared cycles</h2>
        <Plot title="Right-arm joint availability: P3 versus P4 (%)" hasData={scope.frameCount>0} emptyReason="No shared comparison cycles are selected."><BarChart data={improvementData}><CartesianGrid stroke="#374151"/><XAxis {...axis} dataKey="joint"/><YAxis {...axis} domain={[0,100]} unit="%"/><Tooltip contentStyle={tooltipStyle}/><Legend/><Bar dataKey="P3" fill={colors.P3} isAnimationActive={false}/><Bar dataKey="P4" fill={colors.P4} isAnimationActive={false}/></BarChart></Plot>
        {improvementData.map(row=><p key={row.joint}>{row.joint}: P3 {number(row.P3)}%; P4 {number(row.P4)}%; P4-only {row.recovered}; P3-only {row.lost}; net {number(scope.p3VersusP4[row.joint].improvementPercentagePoints)} percentage points.</p>)}
        <p className="text-xs text-gray-400">Counts compare outputs within each archived shared cycle, including invalid observations. They do not establish synchronized physical exposures or absolute accuracy.</p>
      </section>}
      {(!onlyPipeline||onlyPipeline==='P4')&&<>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{(['upperArm','forearm'] as const).map(controller=><Plot key={controller} title={controller+' controller timeline (red: correction entry; cyan: recovery entry)'} hasData={frames.some(f=>f.timeMs!==null&&f.controllers[controller].state!=='UNKNOWN')} emptyReason="Recorded timestamps and known controller states are required for this timeline."><LineChart data={chartData}><CartesianGrid stroke="#374151"/><XAxis {...axis} dataKey="t" type="number" domain={['dataMin','dataMax']} unit="s" tickFormatter={v=>Number(v).toFixed(1)} label={{value:'Experiment time (s)',position:'insideBottomRight',offset:-5}}/><YAxis {...axis} width={110} domain={[0,4]} ticks={[0,1,2,3,4]} tickFormatter={v=>STATES[v]??'UNKNOWN'}/><Tooltip content={<ControllerTooltip/>}/><Line type="stepAfter" dataKey={controller} stroke="#a78bfa" dot={false} isAnimationActive={false}/>{eventLines(controller)}{selectedEvent!==null&&report.events[selectedEvent]?.timeMs!=null&&<ReferenceLine x={report.events[selectedEvent].timeMs!/1000} stroke="#facc15"/>}</LineChart></Plot>)}</div>
      <section className={box}><h2 className="font-semibold">Controller event and duration summary</h2>{(['upperArm','forearm'] as const).map(c=>{const m=scope.controllers[c];return <p key={c}>{c}: {m.correctionActivations} activations; correction/recovery complete-episode medians {number(m.correctionDurationMs.median)}/{number(m.recoveryDurationMs.median)} ms; interrupted recoveries {m.interruptedRecoveries}; healthy-annotated activations {m.activationsDuringAnnotatedHealthy??'not assessable'}; unknown hold time {number(m.unobservedTimeMs)} ms.</p>;})}
        <label>Inspect recorded event <select aria-label="Inspect controller event" className={control} value={selectedEvent??''} onChange={e=>setSelectedEvent(e.target.value===''?null:Number(e.target.value))}><option value="">Select an activation, recovery or state change</option>{report.events.map((e,i)=>frameSet.has(e.index)?<option key={i} value={i}>{number(e.timeMs)} ms - {e.controller}: {e.from} to {e.to}; {e.reason??'reason unavailable'}</option>:null)}</select></label>
        {selectedEvent!==null&&report.events[selectedEvent]&&<p className="text-amber-200">{report.events[selectedEvent].controller}: {report.events[selectedEvent].reason??'No failure reason recorded'}. {report.events[selectedEvent].latencyInterpretation}</p>}
        <details><summary>Observed event markers and latency limitations</summary>{report.events.filter(e=>frameSet.has(e.index)).map((e,i)=><p className="text-xs" key={i}>Frame {e.index}, {number(e.timeMs)} ms, {e.controller}: {e.from} → {e.to}; {e.reason??'reason unavailable'}. {e.latencyInterpretation}</p>)}</details>
      </section>
      </>}
      <details className={box}><summary className="font-semibold">G. Secondary diagnostics: anatomy, native continuity and performance</summary>
      {onlyPipeline!=='P1'&&<>
      <label className="block">Anatomical segment <select className={control} value={segment} onChange={e=>setSegment(e.target.value as Segment)}>{Object.keys(SEGMENTS).map(s=><option key={s}>{s}</option>)}</select></label>
      <Plot title={segment+' length (mm); reference is calibration, not ground truth'} hasData={chartData.some(row=>(['P2','P3','P4'] as const).some(id=>(!onlyPipeline||id===onlyPipeline)&&(pipeline==='all'||pipeline===id)&&typeof (row as any)[id]==='number'))} emptyReason={pipeline==='P1'?'P1 is normalized image space; metric segment lengths are not applicable.':'No valid metric segment observations are available for the selected pipeline and phase.'}><LineChart data={chartData}><CartesianGrid stroke="#374151"/><XAxis {...axis} dataKey="t" type="number" domain={['dataMin','dataMax']} unit="s"/><YAxis {...axis} unit="mm"/><Tooltip contentStyle={tooltipStyle}/><Legend/>{(['P2','P3','P4'] as const).filter(id=>(!onlyPipeline||id===onlyPipeline)&&(pipeline==='all'||pipeline===id)).map(id=><Line key={id} dataKey={id} stroke={colors[id]} dot={false} connectNulls={false} isAnimationActive={false}/>)}<Line dataKey="reference" stroke="#9ca3af" strokeDasharray="4 4" dot={false} connectNulls={false} isAnimationActive={false}/></LineChart></Plot>
      {anatomical&&<p className="text-sm">{anatomyId} {segment}: mean {number(anatomical.lengthMm.mean)} mm; median {number(anatomical.lengthMm.median)} mm; SD {number(anatomical.lengthMm.stdDev)} mm; mean absolute deviation {number(anatomical.absoluteDeviationFraction.mean===null?null:anatomical.absoluteDeviationFraction.mean*100)}%; {anatomical.exceedingThresholdFrames}/{anatomical.framesWithReference} observations exceed the analysis-only threshold. Segment lengths never trigger P4 correction.</p>}
      </>}
      {pipeline!=='all'&&<>
      <Plot title={`${motionId} ${joint} continuity (${scope.motion[motionId][joint].units}; right axis speed)`}><LineChart data={chartData}><CartesianGrid stroke="#374151"/><XAxis {...axis} dataKey="t" type="number" domain={['dataMin','dataMax']} unit="s"/><YAxis {...axis} yAxisId="distance" unit={motionId==='P1'?' norm':' mm'}/><YAxis {...axis} yAxisId="speed" orientation="right" unit={motionId==='P1'?' norm/s':' mm/s'}/><Tooltip contentStyle={tooltipStyle}/><Legend/><Line yAxisId="distance" dataKey="displacement" stroke="#34d399" dot={false} connectNulls={false} isAnimationActive={false}/><Line yAxisId="speed" dataKey="speed" stroke="#fb923c" dot={false} connectNulls={false} isAnimationActive={false}/><Line name="Large displacement indicator" yAxisId="distance" dataKey="largeDisplacement" stroke="#f87171" strokeWidth={0} dot={{r:4}} connectNulls={false} isAnimationActive={false}/><Line name="Near correction activation" yAxisId="distance" dataKey="activationDisplacement" stroke="#c084fc" strokeWidth={0} dot={{r:3}} isAnimationActive={false}/><Line name="Near recovery" yAxisId="distance" dataKey="recoveryDisplacement" stroke="#22d3ee" strokeWidth={0} dot={{r:3}} isAnimationActive={false}/>{eventLines('upperArm','distance')}{eventLines('forearm','distance')}</LineChart></Plot>
      <p className="text-sm">Continuity indicators: {scope.motion[motionId][joint].ordinary.intervals} ordinary intervals; {scope.motion[motionId][joint].nearActivation.intervals} near activation; {scope.motion[motionId][joint].nearRecovery.intervals} near recovery. Large displacement/speed counts: {scope.motion[motionId][joint].overall.largeDisplacementCount}/{scope.motion[motionId][joint].overall.largeSpeedCount}. These are possible discontinuities, not proof of tracking failure or ground-truth occlusion.</p>
      </>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Plot title="Observed frame cadence over time (Hz; not processing latency)"><LineChart data={chartData}><CartesianGrid stroke="#374151"/><XAxis {...axis} dataKey="t" type="number" unit="s"/><YAxis {...axis} unit="Hz"/><Tooltip contentStyle={tooltipStyle}/><Legend/><Line name="Adjacent-cycle cadence" dataKey="fps" stroke="#38bdf8" dot={{r:2}} connectNulls={false} isAnimationActive={false}/></LineChart></Plot>
        <Plot title="Frame interval distribution (ms)" hasData={intervals.length>0} emptyReason="At least two adjacent observations with increasing timestamps are required."><BarChart data={intervalBins}><CartesianGrid stroke="#374151"/><XAxis {...axis} dataKey="range" label={{value:'Interval (ms)',position:'insideBottomRight',offset:-5}}/><YAxis {...axis} allowDecimals={false}/><Tooltip contentStyle={tooltipStyle}/><Bar name="Observed intervals" dataKey="count" fill="#34d399" isAnimationActive={false}/></BarChart></Plot>
      </div>
      <p className="text-sm">Skipped cycle-ID indicators: {scope.performance.skippedCycleIdIndicators}; skipped Camera A presentation indicators: {scope.performance.skippedCameraAPresentationIndicators}; gaps above {config.maxObservationGapMs} ms: {scope.performance.largeObservationGaps}. These are observation indicators, not measured encoded-video drops.</p>
      <Plot title="Processing spans versus native observation intervals (ms; not exposure latency)"><LineChart data={chartData}><CartesianGrid stroke="#374151"/><XAxis {...axis} dataKey="t" type="number" domain={['dataMin','dataMax']} unit="s"/><YAxis {...axis} unit="ms"/><Tooltip contentStyle={tooltipStyle}/><Legend/>{(['processing','inference','interval'] as const).map((field,i)=><Line key={field} dataKey={field} stroke={['#60a5fa','#34d399','#fb923c'][i]} dot={false} connectNulls={false} isAnimationActive={false}/>)}</LineChart></Plot>
      <details className={box}><summary className="font-semibold">Detailed computed metrics table</summary><label>Search joint, segment or metric <input className={control} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} /></label>
        <div className="overflow-auto max-h-96"><table className="w-full text-xs text-left"><thead><tr>{['Pipeline','Joint / segment','Metric','Value','Unit'].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>{rows.slice(page*100,(page+1)*100).map((r,i)=><tr className="border-t border-gray-800" key={i}><td className="p-2">{r.pipeline}</td><td>{r.jointOrSegment}</td><td>{r.metric}</td><td>{typeof r.value==='number'?number(r.value,4):r.value??'Unavailable'}</td><td>{r.unit}</td></tr>)}</tbody></table></div>
        <button className={button} disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous</button> <span>{rows.length} rows; page {page+1}</span> <button className={button} disabled={(page+1)*100>=rows.length} onClick={()=>setPage(p=>p+1)}>Next</button>
      </details>
      <section className={box}><h2 className="font-semibold">Data quality and interpretation</h2><pre className="text-xs">{JSON.stringify(onlyPipeline?{pipeline:onlyPipeline,scopeDataQuality:scope.dataQuality}:report.quality,null,2)}</pre><ul className="list-disc pl-5">{report.warnings.filter(w=>!onlyPipeline||!w.includes('pipeline records absent')).map(w=><li key={w}>{w}</li>)}</ul>
        <details><summary>Metric definitions</summary>{Object.entries(report.definitions).map(([name,definition])=><p className="text-sm py-1" key={name}><strong>{name}:</strong> {definition}</p>)}</details>
      </section>
      </details>
    </>}
  </main>;
});
