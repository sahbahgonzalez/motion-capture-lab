import type {StereoCalibration} from '../type/calibration';
import {validateStereoCalibration} from './stereoGeometry';
const KEY='stereo_calibration_v1',META=KEY+'_identity';
export function calibrationContentId(value:StereoCalibration){
 const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 let hash=2166136261;for(const c of JSON.stringify(canonical(value))){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}return 'fnv1a32-'+(hash>>>0).toString(16).padStart(8,'0');
}
export interface CalibrationIdentity {contentId:string;sourceName:string;activatedAtMs:number|null;}
export function createActiveCalibrationStore(getStorage:()=>Storage|undefined=()=>globalThis.localStorage){
 let snapshot:{calibration:StereoCalibration|null;identity:CalibrationIdentity|null;revision:number}={calibration:null,identity:null,revision:0},storageSeen:Storage|undefined,initialized=false;
 const listeners=new Set<()=>void>();
 const storage=()=>{try{return getStorage();}catch{return undefined;}};
 function hydrate(){const store=storage();if(initialized&&store===storageSeen)return;initialized=true;storageSeen=store;let calibration:StereoCalibration|null=null,identity:CalibrationIdentity|null=null;
  try{const raw=store?.getItem(KEY);if(raw){const parsed=JSON.parse(raw);if(validateStereoCalibration(parsed).valid){calibration=parsed;const contentId=calibrationContentId(parsed),meta=JSON.parse(store?.getItem(META)??'null');identity=meta?.contentId===contentId&&typeof meta.sourceName==='string'&&(meta.activatedAtMs===null||typeof meta.activatedAtMs==='number'&&Number.isFinite(meta.activatedAtMs))?meta:{contentId,sourceName:'Browser storage (original file name unknown)',activatedAtMs:null};}}}catch{}
  snapshot={calibration,identity,revision:snapshot.revision+1};
 }
 const publish=()=>listeners.forEach(fn=>fn());
 const external=(event:StorageEvent)=>{if(event.key!==KEY&&event.key!==META&&event.key!==null)return;initialized=false;hydrate();publish();};
 return {
  getSnapshot(){hydrate();return snapshot;},
  subscribe(fn:()=>void){hydrate();if(!listeners.size&&typeof window!=='undefined')window.addEventListener?.('storage',external);listeners.add(fn);return()=>{listeners.delete(fn);if(!listeners.size&&typeof window!=='undefined')window.removeEventListener?.('storage',external);};},
  activate(value:StereoCalibration,sourceName='Loaded calibration',expectedRevision?:number){hydrate();if(expectedRevision!==undefined&&snapshot.revision!==expectedRevision)throw Error('Active calibration changed while calibration was running; result was not activated.');const validation=validateStereoCalibration(value);if(!validation.valid)throw Error(validation.errors.join(' '));
   const calibration=JSON.parse(JSON.stringify(value)) as StereoCalibration,identity={contentId:calibrationContentId(calibration),sourceName,activatedAtMs:Date.now()};
   try{storage()?.setItem(KEY,JSON.stringify(calibration));storage()?.setItem(META,JSON.stringify(identity));}catch{/* Active state remains available when browser persistence is unavailable. */}
   snapshot={calibration,identity,revision:snapshot.revision+1};publish();return calibration;
  },
 };
}
export const activeStereoCalibration=createActiveCalibrationStore();
