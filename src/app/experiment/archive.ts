import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import type {StoredExperiment,ExperimentalSession} from './types';
export function downloadExperimentBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function exportExperiment(entry:StoredExperiment){
  if(['recording','finalizing'].includes(entry.manifest.status))throw Error('Stop and finalize analysis before export.');
  const files:Record<string,Uint8Array>={'manifest.json':strToU8(JSON.stringify(entry.manifest,null,2))};
  for(const key of ['cameraA','cameraB'] as const){const blob=entry.assets[key],path=entry.manifest.cameras[key+'Asset' as 'cameraAAsset'];if(blob&&path)files[path]=new Uint8Array(await blob.arrayBuffer());}
  return new Blob([zipSync(files,{level:0})],{type:'application/zip'});
}
export async function importExperiment(blob:Blob):Promise<StoredExperiment>{
  const files=unzipSync(new Uint8Array(await blob.arrayBuffer()));if(!files['manifest.json'])throw Error('Experimental manifest missing. Legacy comparison JSON belongs in Offline Evaluation.');
  const m=JSON.parse(strFromU8(files['manifest.json'])) as ExperimentalSession;
  if(m.schemaVersion!=='1.0.0-live-p4-visual-offline'||!m.sessionId||!Array.isArray(m.liveP4)||!m.cameras||!m.offline||!m.cameraMapping||!m.alignment||!Array.isArray(m.errors)||!Array.isArray(m.annotations))throw Error('Unsupported or malformed experimental manifest.');
  if(['recording','finalizing'].includes(m.status))throw Error('An unfinished manifest cannot be imported as a finalized experiment.');
  if(!Array.isArray(m.configurationChanges))m.configurationChanges=[];
  if(!Number.isFinite(m.originPerformanceNowMs)||!Number.isFinite(m.alignment.toleranceMs)||m.alignment.toleranceMs<0)throw Error('Invalid experiment clock or matching tolerance.');
  for(const mapping of Object.values(m.cameraMapping))if(mapping&&(!Number.isFinite(mapping.offsetMs)||!['user_supplied','estimated_recorder_start'].includes(mapping.provenance)))throw Error('Invalid video clock mapping.');
  for(const [pipeline,result] of Object.entries(m.offline))if(!['P1','P2','P3'].includes(pipeline)||result.sessionId!==m.sessionId||result.pipeline!==pipeline||!Array.isArray(result.samples))throw Error('Offline result pipeline/session mismatch.');
  for(const sidecar of [m.cameras.cameraATiming,m.cameras.cameraBTiming])if(sidecar&&(sidecar.recordingId!==m.sessionId||sidecar.experimentStartPerformanceNowMs!==m.originPerformanceNowMs))throw Error('Camera clock/session mismatch.');
  const assets:StoredExperiment['assets']={cameraA:null,cameraB:null};
  for(const key of ['cameraA','cameraB'] as const){const path=m.cameras[key+'Asset' as 'cameraAAsset'];if(path&&files[path]?.length)assets[key]=new Blob([files[path]],{type:m.cameras[key+'MimeType' as 'cameraAMimeType']||'video/webm'});else{m.errors.push(key+': recording absent from archive.');m.status='partial';}}
  return {manifest:m,assets};
}
