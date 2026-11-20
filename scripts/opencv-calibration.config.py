# Official OpenCV 4.12.0 commit 49486f61fb25722cbcf586b7f4320921d46fb38e.
# This only extends the upstream export whitelist; no C++ or binding generator changes.
import os
from pathlib import Path
_source = Path(os.environ["OPENCV_PINNED_SOURCE"])
_base = _source / "platforms/js/opencv_js.config.py"
exec(compile(_base.read_text(encoding="utf-8"), str(_base), "exec"))
imgproc[""].append("cornerSubPix")
calib3d[""].extend(["findChessboardCorners", "calibrateCamera", "stereoCalibrate", "stereoRectify"])
white_list = makeWhiteList([core, imgproc, objdetect, video, dnn, features2d, photo, calib3d])
