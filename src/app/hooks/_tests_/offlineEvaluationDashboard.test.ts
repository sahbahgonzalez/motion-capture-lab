import * as React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {OfflineEvaluationDashboard} from '../../components/OfflineEvaluationDashboard';
import {LANDMARK_KEYS} from '../useTriangulation';

vi.mock('recharts',async()=>{
  const React=await import('react');
  return Object.fromEntries(['Bar','BarChart','CartesianGrid','Legend','Line','LineChart','ReferenceLine','ResponsiveContainer','Tooltip','XAxis','YAxis'].map(name=>[name,(props:any)=>React.createElement('div',{'data-chart':name,data:props.data},props.children)]));
});
let renderer:ReactTestRenderer|null=null;const blobs:Blob[]=[];
beforeEach(()=>{
  vi.stubGlobal('React',React);blobs.length=0;vi.useFakeTimers();
  vi.stubGlobal('URL',{createObjectURL:(blob:Blob)=>{blobs.push(blob);return 'blob:export';},revokeObjectURL:vi.fn()});
  vi.stubGlobal('document',{body:{appendChild:vi.fn()},createElement:()=>({href:'',download:'',click:vi.fn(),remove:vi.fn()})});
});
afterEach(()=>{act(()=>renderer?.unmount());renderer=null;vi.runOnlyPendingTimers();vi.useRealTimers();vi.unstubAllGlobals();});
function recording(){
  const pose=Object.fromEntries(LANDMARK_KEYS.map(j=>[j,{x:1,y:2,z:1000}]));
  return {schemaVersion:'1.0.0-live-pipeline-comparison',sessionId:'dashboard-test',status:'stopped',durationMs:300,warmupEndExperimentTimeMs:100,metadata:{},frames:[0,1,2].map(i=>({cycleId:i,experimentTimeMs:i*100,phase:i===0?'warmup':'measurement',pipelines:Object.fromEntries(['P1','P2','P3','P4'].map(id=>[id,{pose,joints:Object.fromEntries(LANDMARK_KEYS.map(j=>[j,{valid:!(id==='P3'&&j==='rightWrist'&&i===2)}]))}])),fusion:{uaState:'STEREO',faState:i===2?'IMU_CORRECTION':'STEREO'},imuCorrectionActive:i===2}))};
}
function button(text:string){return renderer!.root.findAllByType('button').find(b=>b.children.join('')===text)!;}
async function mountImported(){
  const source=recording(),json=JSON.stringify(source);
  act(()=>{renderer=create(React.createElement(OfflineEvaluationDashboard));});
  await act(async()=>{renderer!.root.findByProps({'aria-label':'Import comparison recordings'}).props.onChange({target:{files:[{name:'recording.json',lastModified:1,size:json.length,text:async()=>json}],value:'recording.json'}});await Promise.resolve();});
  return {source,json};
}
it('imports through the real engine, renders numerical time charts and exports all artifact types',async()=>{
  await mountImported();expect(renderer!.root.findAllByProps({'data-chart':'LineChart'}).length).toBeGreaterThanOrEqual(5);
  const data=renderer!.root.findAllByProps({'data-chart':'LineChart'})[0].props.data;
  expect(data.map((r:any)=>r.t)).toEqual([.1,.2]);
  act(()=>button('Report JSON').props.onClick());
  const report=JSON.parse(await blobs[0].text());expect(report.scopes[0].frameCount).toBe(2);expect(report.scopes[0].p3VersusP4.rightWrist.recoveredByP4).toBe(1);
  act(()=>button('Metrics CSV').props.onClick());expect(await blobs[1].text()).toContain('config_fingerprint');
  act(()=>button('Results summary').props.onClick());expect(await blobs[2].text()).toContain('not proven positional accuracy');
  act(()=>button('Config / annotations sidecar').props.onClick());expect(JSON.parse(await blobs[3].text()).sessionId).toBe('dashboard-test');
});
it('preserves editable controls after invalid settings and disables stale exports',async()=>{
  await mountImported();const gap=renderer!.root.findAllByType('input').find(i=>i.props.type==='number'&&i.props.value===250)!;
  act(()=>gap.props.onChange({target:{value:'0'}}));expect(renderer!.root.findByProps({role:'alert'}).children.join('')).toContain('last valid report');expect(button('Report JSON').props.disabled).toBe(true);
  const invalidGap=renderer!.root.findAllByType('input').find(i=>i.props.type==='number'&&i.props.value===0)!;
  act(()=>invalidGap.props.onChange({target:{value:'250'}}));expect(renderer!.root.findAllByProps({role:'alert'})).toHaveLength(0);expect(button('Report JSON').props.disabled).toBe(false);
});
it('saves manual healthy annotations separately and leaves the imported recording untouched',async()=>{
  const {source,json}=await mountImported();
  const healthy=renderer!.root.findAllByType('input').filter(i=>i.props.type==='checkbox').at(-1)!;
  act(()=>healthy.props.onChange({target:{checked:true}}));act(()=>button('Add phase').props.onClick());
  act(()=>button('Config / annotations sidecar').props.onClick());const sidecar=JSON.parse(await blobs[0].text());
  expect(sidecar.config.annotations).toHaveLength(1);expect(sidecar.config.annotations[0].healthyVisibility).toBe(true);expect(JSON.stringify(source)).toBe(json);
});
it('rejects a sidecar from a different session instead of silently applying it',async()=>{
  await mountImported();await act(async()=>{renderer!.root.findByProps({'aria-label':'Import evaluation sidecar'}).props.onChange({target:{files:[{text:async()=>JSON.stringify({schemaVersion:'1.0.0-evaluation-sidecar',sessionId:'wrong',config:{}})}],value:'x'}});await Promise.resolve();});
  expect(renderer!.root.findByProps({role:'alert'}).children.join('')).toContain('does not match');
});

it('embedded independent evaluation hides uncomputed pipelines and exports only the selected pipeline',async()=>{
  const source=recording();source.frames.forEach((f:any)=>{f.pipelines={P4:f.pipelines.P4};});
  act(()=>{renderer=create(React.createElement(OfflineEvaluationDashboard,{providedSource:source,onlyPipeline:'P4'}));});
  expect(renderer!.root.findAllByProps({'aria-label':'Import comparison recordings'})).toHaveLength(0);
  const select=renderer!.root.findAllByType('select').find(s=>s.props.value==='P4')!;expect(select.findAllByType('option').map(o=>o.children.join(''))).toEqual(['P4']);
  act(()=>button('Report JSON').props.onClick());const report=JSON.parse(await blobs[0].text());expect(report.pipeline).toBe('P4');expect(report.scopes[0].p3VersusP4).toBeUndefined();expect(report.scopes[0].availability.rightWrist).toBeDefined();
  act(()=>button('Metrics CSV').props.onClick());expect(await blobs[1].text()).not.toContain('P3_vs_P4');
});
