import {LineChart,Line,ResponsiveContainer,CartesianGrid,XAxis,YAxis,Tooltip,Legend} from 'recharts';
export const PIPELINE_COLORS={P1:'#60a5fa',P2:'#f59e0b',P3:'#34d399',P4:'#c084fc'};
/** Stereo Lab position plot, with an opt-in synchronized comparison representation. */
export function JointAnalysisPositionPlot({data,axis,comparison=false}:{data:Record<string,unknown>[];axis:'x'|'y'|'z';comparison?:boolean}){
 const colors={x:'#3B82F6',y:'#10B981',z:'#F59E0B'};
 return <ResponsiveContainer width="100%" height={200}><LineChart data={data}><CartesianGrid strokeDasharray="3 3" stroke="#374151"/>
 <XAxis dataKey={comparison?'t':'frameNumber'} stroke="#9CA3AF" {...(comparison?{type:'number' as const,domain:['dataMin','dataMax']}: {})} label={{value:comparison?'Experiment time (s)':'Frame',position:'insideBottom',offset:-5,fill:'#9CA3AF'}}/>
 <YAxis stroke="#9CA3AF" {...(comparison?{domain:['auto','auto']}:axis!=='z'?{domain:[0,1]}:{})}/>
 <Tooltip contentStyle={{backgroundColor:'#1F2937',border:'1px solid #374151',color:'#fff'}}/>
 {comparison?<Legend/>:null}
 {comparison?Object.entries(PIPELINE_COLORS).filter(([id])=>axis!=='z'||id!=='P1').map(([id,color])=><Line key={id} type="linear" dataKey={id+'_'+axis} name={id} stroke={color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}/>):<Line type="monotone" isAnimationActive={false} dataKey={axis} stroke={colors[axis]} strokeWidth={2} dot={false}/>}
 </LineChart></ResponsiveContainer>;
}
