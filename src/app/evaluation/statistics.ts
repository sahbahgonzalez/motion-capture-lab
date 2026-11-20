import type {Stats} from './types';

export const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
export const positive=(v:unknown):v is number=>finite(v)&&v>0;
export function percentile(sorted:number[],p:number):number|null {
  if(!sorted.length)return null;
  const at=(sorted.length-1)*p,lo=Math.floor(at),hi=Math.ceil(at);
  return sorted[lo]+(sorted[hi]-sorted[lo])*(at-lo);
}
export function statistics(values:Array<number|null|undefined>):Stats {
  const x=values.filter(finite).sort((a,b)=>a-b),n=x.length;
  if(!n)return {count:0,mean:null,median:null,stdDev:null,min:null,max:null,p95:null,p99:null,mad:null,iqr:null};
  const mean=x.reduce((s,v)=>s+v,0)/n,median=percentile(x,.5)!;
  return {count:n,mean,median,stdDev:Math.sqrt(x.reduce((s,v)=>s+(v-mean)**2,0)/n),min:x[0],max:x[n-1],p95:percentile(x,.95),p99:percentile(x,.99),
    mad:percentile(x.map(v=>Math.abs(v-median)).sort((a,b)=>a-b),.5),iqr:percentile(x,.75)!-percentile(x,.25)!};
}
export const percent=(count:number,total:number)=>total>0?count*100/total:null;
export function fingerprint(text:string):string {let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');}
export const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function at(v:unknown,...keys:string[]):unknown {let current=v;for(const key of keys)current=object(current)[key];return current;}
