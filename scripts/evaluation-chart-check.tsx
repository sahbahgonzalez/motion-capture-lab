import React from 'react';
import {createRoot} from 'react-dom/client';
import {ComparisonResults} from '../src/app/components/ComparisonResults';
import {analyzeComparisonJoint} from '../src/app/evaluation/comparisonJointAnalysis';
import {source} from '../src/app/hooks/_tests_/standardizedFixtures';
import '../src/styles/index.css';
window.addEventListener('error',event=>fail(event.message));
function fail(message:string){const output=document.getElementById('chart-verification')!;output.dataset.chartResult='failed';output.textContent=message;}
const wait=()=>new Promise(resolve=>setTimeout(resolve,600));
function button(label:string){const result=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===label);if(!result)throw Error('Missing button: '+label+'; visible buttons='+Array.from(document.querySelectorAll('button')).map(b=>b.textContent).join('|')+'; alerts='+document.querySelector('[role=alert]')?.textContent);return result;}
async function tab(label:string){button(label).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));await wait();}
async function verify(){
 const archived=new URLSearchParams(location.search).has('recording'),recording=archived?await fetch('/__chart_recording').then(r=>r.json()):source(Array.from({length:30},(_,i)=>Math.sin(i/3)));
 createRoot(document.getElementById('root')!).render(<ComparisonResults/>);await wait();
 const input=document.querySelector<HTMLInputElement>('input[type=file]')!,transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(recording)],'archived.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));for(let i=0;i<60&&button('Analyze').disabled;i++)await wait();if(button('Analyze').disabled)throw Error('Import did not finish: '+document.querySelector('section')?.textContent);
 if(document.querySelector('[role=dialog]'))throw Error('Analyzer opened without Analyze');button('Analyze').click();await wait();button('rightWrist').click();await wait();
 const tabs=Array.from(document.querySelectorAll('[role=tab]')).map(el=>el.textContent);
 if(tabs.join('|')!=='Quality|Jitter|Occlusion|Limb Swap|Depth|Position|Trajectory|Raw Data')throw Error('Unexpected analysis tabs');
 const analysis=analyzeComparisonJoint(recording,'rightWrist'),wristValid=Object.fromEntries(Object.entries(analysis.pipelines).map(([id,p])=>[id,p.availability.validFrames]));
 await tab('Jitter');const jitterTable=document.querySelector('[role=tabpanel][data-state=active] table')!;
 if(!jitterTable.textContent?.includes('Mean velocity')||jitterTable.querySelectorAll('thead th').length!==5)throw Error('Original metrics not populated together');
 await tab('Position');
 const plots=Array.from(document.querySelectorAll('[data-position-axis]')).map(plot=>({axis:plot.getAttribute('data-position-axis'),curves:Array.from(plot.querySelectorAll<SVGGraphicsElement>('.recharts-line-curve')).filter(path=>{const box=path.getBBox(),bounds=path.getBoundingClientRect(),style=getComputedStyle(path);return box.width>0&&bounds.width>0&&style.stroke!=='none'&&style.visibility!=='hidden';}).length}));
 const paths=Array.from(document.querySelectorAll<SVGPathElement>('[data-position-axis=x] .recharts-line-curve')).map(p=>p.getAttribute('d')!);
 const gapSubpaths=paths.map(d=>(d.match(/M/g)||[]).length);
 const archivedCounts=!archived||(analysis.frames.length===546&&wristValid.P1===546&&wristValid.P2===344&&wristValid.P3===344&&wristValid.P4===546&&analysis.pairedP2P3.different===338);
 if(!archivedCounts||plots.map(p=>p.curves).join(',')!=='4,4,3'||archived&&gapSubpaths[1]<2)throw Error(JSON.stringify({plots,wristValid,gapSubpaths,paired:analysis.pairedP2P3}));
 await tab('Trajectory');if(document.querySelectorAll('.recharts-scatter').length!==4)throw Error('Missing trajectories');
 await tab('Raw Data');if(!document.querySelector('[role=tabpanel][data-state=active]')?.textContent?.includes('cycleId'))throw Error('Missing synchronized raw data');
 button('Close').click();await wait();if(document.querySelector('[role=dialog]'))throw Error('Close failed');
 const output=document.getElementById('chart-verification')!;output.dataset.chartResult='passed';output.textContent=JSON.stringify({historicalImport:true,explicitAnalyze:true,tabs,plots,gapSubpaths,measurementCycles:analysis.frames.length,wristValid,p2P3:{common:analysis.pairedP2P3.commonSamples,different:analysis.pairedP2P3.different},jitterWithoutAnnotations:true,trajectoryPipelines:4,rawData:true,close:true});
}
void verify().catch(error=>fail(String(error)));
