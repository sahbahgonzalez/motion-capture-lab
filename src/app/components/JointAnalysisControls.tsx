import {Button} from './ui/button';
import {TabsList,TabsTrigger} from './ui/tabs';
import type {PoseLandmarks} from '../hooks/useMediaPipePose';
export const JOINT_ANALYSIS_TABS=[['quality','Quality'],['jitter','Jitter'],['occlusion','Occlusion'],['limbswap','Limb Swap'],['depth','Depth'],['position','Position'],['trajectory','Trajectory'],['raw','Raw Data']] as const;
/** Controls extracted unchanged from the Stereo Lab's MotionDataVisualizer. */
export function JointAnalysisSelector({joints,selected,onSelect}:{joints:Array<keyof PoseLandmarks>;selected:keyof PoseLandmarks;onSelect:(joint:keyof PoseLandmarks)=>void}){
 return <div className="mb-6"><h3 className="text-sm font-semibold text-gray-300 mb-2">Select Joint to Analyze</h3><div className="flex flex-wrap gap-2">{joints.map(joint=><Button key={joint} variant={selected===joint?'default':'outline'} size="sm" onClick={()=>onSelect(joint)} className={selected===joint?'bg-blue-600 hover:bg-blue-700 text-white':'border-gray-600 text-gray-300 hover:bg-gray-700'}>{joint}</Button>)}</div></div>;
}
export function JointAnalysisTabList(){return <TabsList className="bg-gray-700 mb-4 grid grid-cols-4 lg:grid-cols-8 gap-1">{JOINT_ANALYSIS_TABS.map(([value,label])=><TabsTrigger key={value} value={value} className="data-[state=active]:bg-gray-600 text-xs">{label}</TabsTrigger>)}</TabsList>;}
