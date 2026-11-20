/** Shared shoulder-width normalization policy from the legacy jitter analyzer.
 * Carry previous valid width; leading gaps use the first valid width. Never invent scale=1.
 * Returned null explicitly means normalization unavailable. Call per experimental interval.
 */
export function resolveShoulderWidths(widths:Array<number|null>):Array<number|null>{
  let last:number|null=null;
  const result=widths.map(width=>{if(width!==null&&Number.isFinite(width)&&width>0)last=width;return last;});
  const first=result.find(width=>width!==null)??null;
  return result.map(width=>width??first);
}
export function shoulderWidth(a:number[]|null,b:number[]|null):number|null{
  if(!a||!b||a.length!==b.length||![...a,...b].every(Number.isFinite))return null;
  const width=Math.hypot(...a.map((value,i)=>value-b[i]));return width>0?width:null;
}
