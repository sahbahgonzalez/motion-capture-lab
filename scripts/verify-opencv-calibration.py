"""Read-only independent Python check of browser calibration output and observations.
No calibration fitting or original-image/calibration changes are performed.
"""
import argparse, base64, json, pathlib
import cv2
import numpy as np
p=argparse.ArgumentParser(description=__doc__);p.add_argument("report");p.add_argument("captures");a=p.parse_args()
r=json.loads(pathlib.Path(a.report).read_text());captures=json.loads(pathlib.Path(a.captures).read_text());c=r["calibration"]
K=[np.array(c[name]["K"],dtype=float) for name in ["camera1","camera2"]];D=[np.array(c[name]["distortion"],dtype=float) for name in ["camera1","camera2"]];R=np.array(c["extrinsic"]["R"]);T=np.array(c["extrinsic"]["T"]);P=[np.column_stack([np.eye(3),np.zeros(3)]),np.column_stack([R,T])]
criteria=(cv2.TERM_CRITERIA_COUNT|cv2.TERM_CRITERIA_EPS,100,1e-12);errors=[[],[]];differences=[];point_differences=[];corner_differences=[]
for observation,pair,production in zip(r["observations"],captures["captures"],r["productionGeometry"]):
 pixels=[np.array(observation[key],dtype=float).reshape(-1,1,2) for key in ["cameraA","cameraB"]]
 uv=[cv2.undistortPointsIter(pixels[i],K[i],D[i],None,None,criteria).reshape(-1,2) for i in range(2)]
 h=cv2.triangulatePoints(*P,uv[0].T,uv[1].T);points=(h[:3]/h[3]).T
 for i,key in enumerate(["camera1Image","camera2Image"]):
  image=cv2.imdecode(np.frombuffer(base64.b64decode(pair[key]["imageData"].split(",")[1]),np.uint8),cv2.IMREAD_GRAYSCALE)
  found,corners=cv2.findChessboardCorners(image,(c["checkerboardConfig"]["cols"],c["checkerboardConfig"]["rows"]),cv2.CALIB_CB_ADAPTIVE_THRESH|cv2.CALIB_CB_NORMALIZE_IMAGE)
  if not found:raise RuntimeError("Independent checkerboard detection failed: "+pair["id"])
  corners=cv2.cornerSubPix(image,corners,(11,11),(-1,-1),(cv2.TERM_CRITERIA_COUNT|cv2.TERM_CRITERIA_EPS,30,.001))
  corner_differences.extend(np.linalg.norm(corners.reshape(-1,2)-pixels[i].reshape(-1,2),axis=1))
  q=cv2.projectPoints(points,np.zeros(3) if i==0 else cv2.Rodrigues(R)[0],np.zeros(3) if i==0 else T,K[i],D[i])[0].reshape(-1,2)
  e=np.linalg.norm(q-pixels[i].reshape(-1,2),axis=1);errors[i].extend(e)
  for j,error in enumerate(e):differences.append(abs(float(error)-production["corners"][j]["reprojectionErrorCameraAPx" if i==0 else "reprojectionErrorCameraBPx"]))
 for i,point in enumerate(points):point_differences.append(np.linalg.norm(point-np.array([production["corners"][i]["point"][key] for key in ["x","y","z"]])))
def stats(v):return dict(count=len(v),median=float(np.median(v)),p95=float(np.percentile(v,95)),max=float(np.max(v)))
result={"pythonOpenCVVersion":cv2.__version__,"pairs":len(r["observations"]),"cameraAReprojectionPx":stats(errors[0]),"cameraBReprojectionPx":stats(errors[1]),"productionReprojectionDifferencePx":stats(differences),"productionPointDifferenceMm":stats(point_differences),"pythonVsBrowserDetectedCornerDifferencePx":stats(corner_differences),"interpretation":"Same training captures: software/API/coordinate agreement, not held-out or ground-truth accuracy."}
print(json.dumps(result,indent=2))
if max(differences)>1e-5 or max(point_differences)>1e-3:raise SystemExit("Independent production geometry disagreement")
