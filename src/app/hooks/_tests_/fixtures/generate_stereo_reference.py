"""Regenerate immutable synthetic fixtures using Python OpenCV, not runtime TS.

Run from repository root. Does not read or modify experimental recordings.
The TS suite consumes the generated JSON without requiring Python/OpenCV.
"""
import json
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[5]
POINTS = np.array([[-180., -110., 1600.], [0., 0., 2200.], [170., 100., 3000.],
                   [250., -150., 2100.], [80., 200., 2600.]], dtype=np.float64)
KA = np.array([[900., 0., 640.], [0., 880., 360.], [0., 0., 1.]])
KB = np.array([[1100., 0., 810.], [0., 1080., 440.], [0., 0., 1.]])
rotation, _ = cv2.Rodrigues(np.array([.03, -.09, .02]))


def make_case(name, da, db, r=rotation, t=(-200., 13., 6.), sizes=(640, 360, 1920, 1080), legacy=None):
    calibration = legacy or {
        "camera1": {"K": KA.tolist(), "distortion": da, "imageWidth": 1280, "imageHeight": 720, "reprojectionError": .2},
        "camera2": {"K": KB.tolist(), "distortion": db, "imageWidth": 1600, "imageHeight": 900, "reprojectionError": .3},
        "extrinsic": {"R": r.tolist(), "T": list(t), "E": [], "F": []},
        "units": "mm", "stereoReprojectionError": .25, "calibrationDate": "synthetic", "checkerboardConfig": {"rows": 7, "cols": 10, "squareSize": 25.},
    }
    a, b = calibration["camera1"], calibration["camera2"]
    k1, k2 = np.array(a["K"]), np.array(b["K"])
    d1, d2 = np.array(a["distortion"]), np.array(b["distortion"])
    r, t = np.array(calibration["extrinsic"]["R"]), np.array(calibration["extrinsic"]["T"])
    points = POINTS.copy()
    if legacy:
        points[:, 2] += 3000.  # Stay within the calibrated central image region.
    raw1, _ = cv2.projectPoints(points, np.zeros(3), np.zeros(3), k1, d1)
    rvec, _ = cv2.Rodrigues(r)
    raw2, _ = cv2.projectPoints(points, rvec, t, k2, d2)
    r1, r2, p1, p2, *_ = cv2.stereoRectify(k1, d1, k2, d2, (a["imageWidth"], a["imageHeight"]), r, t, flags=cv2.CALIB_ZERO_DISPARITY, alpha=0)
    criterion = (cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS, 100, 1e-14)
    rect1 = cv2.undistortPointsIter(raw1, k1, d1, r1, p1, criterion)
    rect2 = cv2.undistortPointsIter(raw2, k2, d2, r2, p2, criterion)
    homogeneous = cv2.triangulatePoints(p1, p2, rect1.reshape(-1, 2).T, rect2.reshape(-1, 2).T)
    reference = (r1.T @ (homogeneous[:3] / homogeneous[3])).T
    error = float(np.max(np.linalg.norm(reference-points, axis=1)))
    assert error < 1e-5, (name, error)
    if not legacy:
        calibration.update({"R1": r1.tolist(), "R2": r2.tolist(), "P1": p1.tolist(), "P2": p2.tolist(), "projectionSpace": "rectified"})
    return {"name": name, "calibration": calibration, "captureSizes": list(sizes),
            "pointsCameraA": points.tolist(), "pointsRectifiedCameraA": (r1 @ points.T).T.tolist(),
            "observationsA": (raw1.reshape(-1, 2) / [a["imageWidth"], a["imageHeight"]]).tolist(),
            "observationsB": (raw2.reshape(-1, 2) / [b["imageWidth"], b["imageHeight"]]).tolist(),
            "opencvReconstructionMaxErrorMm": error}


if __name__ == "__main__":
    da = [-.13, .04, .002, -.003, .007]
    db = [.08, -.025, -.001, .003, .002]
    cases = [
        make_case("zero_distortion_parallel", [0.] * 5, [0.] * 5, np.eye(3), (-180., 0., 0.)),
        make_case("brown5_rotated_different_intrinsics_resized", da, db),
        make_case("rational8", da + [.01, -.004, .001], db + [-.01, .003, -.001]),
        make_case("thin_prism12", da + [.01, -.004, .001, .001, -.0004, .0003, -.0002], db + [-.01, .003, -.001, -.001, .0003, -.0002, .0004]),
        make_case("sensor_tilt14", da + [.01, -.004, .001, .001, -.0004, .0003, -.0002, .035, -.02], db + [-.01, .003, -.001, -.001, .0003, -.0002, .0004, -.03, .025]),
        make_case("vertical_baseline", da, db, np.eye(3), (0., -180., 0.)),
        make_case("legacy_saved_14_coefficients", [], [], legacy=json.loads((ROOT / "stereo_calibration.json").read_text())),
    ]
    output = {"reference": "Python OpenCV projectPoints + independent rectified triangulatePoints, rotated back with R1.T", "opencvVersion": cv2.__version__, "cases": cases}
    path = Path(__file__).with_name("stereoGeometryReference.json")
    path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(cases)} cases, {sum(len(c['pointsCameraA']) for c in cases)} known points; OpenCV max error {max(c['opencvReconstructionMaxErrorMm'] for c in cases):.3g} mm")
