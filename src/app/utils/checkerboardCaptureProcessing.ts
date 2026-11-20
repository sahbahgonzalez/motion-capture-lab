import type {CalibrationCapture,CalibrationImage} from '../type/calibration';
export interface CornerDetection {found:boolean;corners?:number[][];width:number;height:number;error?:string;}
export function detectionStatus(image:CalibrationImage){return image.detectionStatus??(image.cornersDetected&&image.corners?.length?'detected':'unprocessed');}
export async function processCheckerboardCaptures(captures:CalibrationCapture[],pattern:{rows:number;cols:number},detect:(url:string)=>Promise<CornerDetection>,progress:(done:number)=>void=()=>{},current:()=>boolean=()=>true){
 if(!Number.isInteger(pattern.rows)||!Number.isInteger(pattern.cols)||pattern.rows<1||pattern.cols<1)throw Error('Inner-corner dimensions must be positive integers.');
 const result:CalibrationCapture[]=[];
 for(const capture of captures){if(!current())return null;
  const process=async(image:CalibrationImage):Promise<CalibrationImage>=>{let r:CornerDetection;try{r=await detect(image.imageData);}catch(error){r={found:false,width:image.imageWidth??0,height:image.imageHeight??0,error:String(error)};}
   const malformed=r.found&&(!r.corners||r.corners.length!==pattern.rows*pattern.cols||r.corners.some(p=>p.length!==2||!p.every(Number.isFinite)));
   const error=r.error??(malformed?'Detector returned invalid corners or the wrong corner count.':null),found=r.found&&!error;
   return {...image,cornersDetected:found,corners:found?r.corners:undefined,cornerCount:found?r.corners!.length:0,detectionStatus:error?'processing_error':found?'detected':'not_found',detectionError:error,detectionPattern:{...pattern},imageWidth:r.width||image.imageWidth,imageHeight:r.height||image.imageHeight};
  };
  const [camera1Image,camera2Image]=await Promise.all([process(capture.camera1Image),process(capture.camera2Image)]);if(!current())return null;
  result.push({...capture,camera1Image,camera2Image,bothCornersDetected:camera1Image.cornersDetected&&camera2Image.cornersDetected});progress(result.length);
 }
 return result;
}
