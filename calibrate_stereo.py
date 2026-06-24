#!/usr/bin/env python3
"""
Stereo camera calibration pipeline using opencv-python.

Install deps:
    pip install opencv-python numpy

Usage — two folders of paired images:
    python calibrate_stereo.py --cam1 ./cam1/ --cam2 ./cam2/ --rows 5 --cols 8 --square 25

Usage — JSON export from the web app (Export Captures JSON button):
    python calibrate_stereo.py --json captures.json --rows 5 --cols 8 --square 25

Usage — preview/verify frames before calibrating:
    python calibrate_stereo.py --json captures.json --rows 5 --cols 8 --square 25 --preview

--rows/--cols are INNER corner counts (squares - 1 in each direction).
--square is the physical square size in mm.

Output: stereo_calibration.json  (load this in the web app via Load Calibration)
"""

import argparse
import base64
import glob
import json
import os
import sys
from datetime import datetime

import cv2
import numpy as np


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_image_gray(path: str) -> np.ndarray:
    img = cv2.imread(path)
    if img is None:
        raise FileNotFoundError(f"Cannot read image: {path}")
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def b64_to_gray(data_url: str) -> np.ndarray:
    """Decode a base64 data-URL (image/jpeg or image/png) to a grayscale numpy array."""
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    raw = base64.b64decode(data_url)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode base64 image")
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def find_corners(gray: np.ndarray, pattern: tuple) -> tuple:
    """
    Detect checkerboard inner corners with sub-pixel refinement.
    pattern = (cols, rows) — OpenCV expects (width, height).
    """
    flags = cv2.CALIB_CB_ADAPTIVE_THRESH | cv2.CALIB_CB_NORMALIZE_IMAGE | cv2.CALIB_CB_FAST_CHECK
    found, corners = cv2.findChessboardCorners(gray, pattern, flags)
    if found:
        criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)
        corners = cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1), criteria)
    return found, corners


def build_object_points(pattern: tuple, square_size_mm: float) -> np.ndarray:
    """3-D world coordinates of checkerboard inner corners (Z=0 plane)."""
    cols, rows = pattern
    obj = np.zeros((rows * cols, 3), dtype=np.float32)
    obj[:, :2] = np.mgrid[0:cols, 0:rows].T.reshape(-1, 2)
    obj *= square_size_mm
    return obj


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_from_folders(cam1_dir: str, cam2_dir: str) -> list:
    exts = ("*.jpg", "*.jpeg", "*.png", "*.bmp", "*.tiff")

    def collect(d):
        files = []
        for e in exts:
            files.extend(glob.glob(os.path.join(d, e)))
        return sorted(files)

    f1, f2 = collect(cam1_dir), collect(cam2_dir)
    if len(f1) != len(f2):
        print(f"  WARNING: cam1 has {len(f1)} images, cam2 has {len(f2)}. Pairing by sort order up to min.")
    pairs = []
    for p1, p2 in zip(f1, f2):
        pairs.append((load_image_gray(p1), load_image_gray(p2)))
    return pairs


def load_from_json(json_path: str) -> list:
    with open(json_path, "r") as f:
        data = json.load(f)

    # Accept either the raw captures array or a wrapper object {"captures": [...]}
    captures = data if isinstance(data, list) else data.get("captures", [])
    pairs = []
    for cap in captures:
        g1 = b64_to_gray(cap["camera1Image"]["imageData"])
        g2 = b64_to_gray(cap["camera2Image"]["imageData"])
        pairs.append((g1, g2))
    return pairs


# ---------------------------------------------------------------------------
# Preview — verify frames before calibrating
# ---------------------------------------------------------------------------

def run_preview(pairs: list, inner_rows: int, inner_cols: int, out_dir: str):
    """
    For each image pair:
      - Run findChessboardCorners on both cameras
      - Draw corners (green = found, red X = not found)
      - Save annotated side-by-side image to out_dir/pair_NNN.jpg
      - Print a per-frame quality summary to the terminal
    """
    pattern = (inner_cols, inner_rows)
    os.makedirs(out_dir, exist_ok=True)

    total = len(pairs)
    found_both = 0
    found_one = 0
    found_none = 0

    print(f"\nPreviewing {total} pairs — pattern {inner_cols}x{inner_rows}")
    print(f"Annotated images -> {out_dir}/\n")
    print(f"{'Pair':>4}  {'Cam1':^20}  {'Cam2':^20}  Result")
    print("-" * 64)

    for i, (g1, g2) in enumerate(pairs):
        ok1, c1 = find_corners(g1, pattern)
        ok2, c2 = find_corners(g2, pattern)

        vis1 = cv2.cvtColor(g1, cv2.COLOR_GRAY2BGR)
        vis2 = cv2.cvtColor(g2, cv2.COLOR_GRAY2BGR)

        if ok1:
            cv2.drawChessboardCorners(vis1, pattern, c1, ok1)
            cam1_msg = f"OK ({len(c1)} corners)"
        else:
            h, w = vis1.shape[:2]
            cv2.line(vis1, (0, 0), (w, h), (0, 0, 220), 3)
            cv2.line(vis1, (w, 0), (0, h), (0, 0, 220), 3)
            cv2.putText(vis1, "NOT FOUND", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
            cam1_msg = "NOT FOUND"

        if ok2:
            cv2.drawChessboardCorners(vis2, pattern, c2, ok2)
            cam2_msg = f"OK ({len(c2)} corners)"
        else:
            h, w = vis2.shape[:2]
            cv2.line(vis2, (0, 0), (w, h), (0, 0, 220), 3)
            cv2.line(vis2, (w, 0), (0, h), (0, 0, 220), 3)
            cv2.putText(vis2, "NOT FOUND", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
            cam2_msg = "NOT FOUND"

        label_color = (0, 200, 0) if (ok1 and ok2) else (0, 100, 255)
        for vis, cam in ((vis1, "CAM1"), (vis2, "CAM2")):
            cv2.putText(vis, f"Pair {i+1:03d} - {cam}", (8, vis.shape[0] - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, label_color, 2)

        h_target = 480

        def fit(img):
            h, w = img.shape[:2]
            scale = h_target / h
            return cv2.resize(img, (int(w * scale), h_target))

        side_by_side = np.hstack([fit(vis1), fit(vis2)])
        out_path = os.path.join(out_dir, f"pair_{i+1:03d}.jpg")
        cv2.imwrite(out_path, side_by_side)

        if ok1 and ok2:
            result = "VALID  OK"
            found_both += 1
        elif ok1 or ok2:
            result = "PARTIAL"
            found_one += 1
        else:
            result = "SKIP   X"
            found_none += 1

        print(f"{i+1:>4}  {cam1_msg:^20}  {cam2_msg:^20}  {result}")

    print("-" * 64)
    print(f"\nSummary: {found_both} valid / {found_one} partial / {found_none} no detection (out of {total})")
    print(f"\nAnnotated images saved to: {out_dir}/")
    print("\nWhat to look for:")
    print("  Green dots  - corners detected correctly, should form a neat grid")
    print("  Red cross   - findChessboardCorners failed on that frame")
    print("\nCommon reasons for failure:")
    print("  - Wrong --rows/--cols (must be INNER corners = squares - 1)")
    print("  - Board partially out of frame or too small")
    print("  - Motion blur - hold the board still when capturing")
    print("  - Poor lighting or glare on a glossy print")
    print("  - Board at too steep an angle (keep < ~45 deg tilt)")

    if found_both < 10:
        print(f"\n  WARNING: Only {found_both} valid pairs - need 10+ to calibrate.")
        print("  Capture more frames or fix the issues above.")
    else:
        print(f"\n  {found_both} valid pairs - enough to run calibration.")


# ---------------------------------------------------------------------------
# Main calibration pipeline
# ---------------------------------------------------------------------------

def diagnose_mirroring(pairs: list, inner_rows: int, inner_cols: int):
    """
    Check whether one camera's images are horizontally mirrored relative to the other.
    OpenCV always returns corners left-to-right, top-to-bottom. If one camera is mirrored,
    its first corner (top-left in image) will be on the right side of the frame instead.
    We compare the normalized X position of corner[0] between cameras — if they're on
    opposite sides consistently, one camera is mirrored.
    """
    pattern = (inner_cols, inner_rows)
    cam1_first_x = []
    cam2_first_x = []

    for g1, g2 in pairs[:5]:
        h1, w1 = g1.shape[:2]
        h2, w2 = g2.shape[:2]
        ok1, c1 = find_corners(g1, pattern)
        ok2, c2 = find_corners(g2, pattern)
        if ok1 and ok2:
            cam1_first_x.append(c1[0][0][0] / w1)
            cam2_first_x.append(c2[0][0][0] / w2)

    if not cam1_first_x:
        return

    avg1 = sum(cam1_first_x) / len(cam1_first_x)
    avg2 = sum(cam2_first_x) / len(cam2_first_x)

    print(f"\n[Mirroring diagnostic]")
    print(f"  Cam1 corner[0] avg X (normalized): {avg1:.3f}  ({'left side' if avg1 < 0.5 else 'RIGHT side'})")
    print(f"  Cam2 corner[0] avg X (normalized): {avg2:.3f}  ({'left side' if avg2 < 0.5 else 'RIGHT side'})")

    both_left = avg1 < 0.5 and avg2 < 0.5
    both_right = avg1 >= 0.5 and avg2 >= 0.5
    opposite = (avg1 < 0.5) != (avg2 < 0.5)

    if opposite:
        print("  *** WARNING: cameras appear to be MIRRORED relative to each other! ***")
        print("  One camera is outputting a horizontally flipped image.")
        print("  Re-run with --flip-cam2 (or --flip-cam1) to correct this.")
    elif both_right:
        print("  Both cameras have corner[0] on the right — both may be mirrored (consistent, OK for calibration)")
    else:
        print("  Corner ordering looks consistent between cameras — mirroring is not the issue.")


def run_calibration(pairs: list, inner_rows: int, inner_cols: int, square_size_mm: float, output_path: str, flip_cam1: bool = False, flip_cam2: bool = False):
    pattern = (inner_cols, inner_rows)  # OpenCV Size is (width=cols, height=rows)
    obj_pts_template = build_object_points(pattern, square_size_mm)

    obj_points_list = []
    img_points1_list = []
    img_points2_list = []
    image_size = None

    if flip_cam1:
        print("  NOTE: Horizontally flipping Camera 1 images before processing")
        pairs = [(cv2.flip(g1, 1), g2) for g1, g2 in pairs]
    if flip_cam2:
        print("  NOTE: Horizontally flipping Camera 2 images before processing")
        pairs = [(g1, cv2.flip(g2, 1)) for g1, g2 in pairs]

    print(f"\n[1/5] Checkerboard detection - pattern {inner_cols}x{inner_rows} inner corners")

    # Print image dimensions for both cameras to detect resolution mismatch
    h1s, w1s = pairs[0][0].shape[:2]
    h2s, w2s = pairs[0][1].shape[:2]
    print(f"  Camera 1 resolution: {w1s}x{h1s}")
    print(f"  Camera 2 resolution: {w2s}x{h2s}")
    if (w1s, h1s) != (w2s, h2s):
        print(f"  *** WARNING: cameras have different resolutions! ***")
        print(f"  This will cause stereoRectify to produce wrong P matrices.")
        print(f"  Set both cameras to the same resolution in Camera Setup.")

    image_size1 = (w1s, h1s)
    image_size2 = (w2s, h2s)

    valid = 0
    for i, (g1, g2) in enumerate(pairs):
        found1, c1 = find_corners(g1, pattern)
        found2, c2 = find_corners(g2, pattern)

        status = "OK" if (found1 and found2) else f"SKIP (cam1={'OK' if found1 else 'miss'}, cam2={'OK' if found2 else 'miss'})"
        print(f"  Pair {i+1:3d}: {status}")

        if found1 and found2:
            obj_points_list.append(obj_pts_template)
            img_points1_list.append(c1)
            img_points2_list.append(c2)
            valid += 1
            if image_size is None:
                h, w = g1.shape[:2]
                image_size = (w, h)

    print(f"\n  Valid pairs: {valid} / {len(pairs)}")
    if valid < 10:
        sys.exit(f"ERROR: Need at least 10 valid pairs, got {valid}. Run --preview to diagnose.")

    # ------------------------------------------------------------------
    print("\n[2/5] calibrateCamera - Camera 1")
    K1 = np.eye(3, dtype=np.float64)
    dist1 = np.zeros((5, 1), dtype=np.float64)
    err1, K1, dist1, rvecs1, tvecs1 = cv2.calibrateCamera(
        obj_points_list, img_points1_list, image_size1, K1, dist1
    )
    print(f"  Reprojection error: {err1:.4f} px")
    print(f"  Focal length: fx={K1[0,0]:.1f} fy={K1[1,1]:.1f} px")

    print("\n[3/5] calibrateCamera - Camera 2")
    K2 = np.eye(3, dtype=np.float64)
    dist2 = np.zeros((5, 1), dtype=np.float64)
    err2, K2, dist2, rvecs2, tvecs2 = cv2.calibrateCamera(
        obj_points_list, img_points2_list, image_size2, K2, dist2
    )
    print(f"  Reprojection error: {err2:.4f} px")
    print(f"  Focal length: fx={K2[0,0]:.1f} fy={K2[1,1]:.1f} px")

    # ------------------------------------------------------------------
    print("\n[4/5] stereoCalibrate")
    # Rational model captures more lens distortion (barrel/pincushion) —
    # helps with webcams that have significant wide-angle distortion.
    stereo_flags = cv2.CALIB_USE_INTRINSIC_GUESS | cv2.CALIB_RATIONAL_MODEL
    R = np.eye(3, dtype=np.float64)
    T = np.zeros((3, 1), dtype=np.float64)
    E = np.zeros((3, 3), dtype=np.float64)
    F = np.zeros((3, 3), dtype=np.float64)

    stereo_err, K1, dist1, K2, dist2, R, T, E, F = cv2.stereoCalibrate(
        obj_points_list,
        img_points1_list,
        img_points2_list,
        K1, dist1,
        K2, dist2,
        image_size,
        R, T, E, F,
        stereo_flags,
    )
    print(f"  Stereo reprojection error: {stereo_err:.4f} px")
    baseline_mm = float(np.linalg.norm(T))
    Tvec = T.flatten()
    print(f"  Baseline (total norm):  {baseline_mm:.1f} mm")
    print(f"  T vector (X, Y, Z mm):  [{Tvec[0]:.1f}, {Tvec[1]:.1f}, {Tvec[2]:.1f}]")
    print(f"  Horizontal separation:  {abs(Tvec[0]):.1f} mm")
    print(f"  Vertical offset:        {abs(Tvec[1]):.1f} mm")
    print(f"  Depth offset:           {abs(Tvec[2]):.1f} mm")

    # Per-pair stereo reprojection error to identify outliers
    print("\n  Per-pair stereo error:")
    pair_errors = []
    for i, (op, ip1, ip2) in enumerate(zip(obj_points_list, img_points1_list, img_points2_list)):
        _, rvec, tvec = cv2.solvePnP(op, ip1, K1, dist1)
        proj1, _ = cv2.projectPoints(op, rvec, tvec, K1, dist1)
        err1_i = float(np.mean(np.linalg.norm(ip1.reshape(-1, 2) - proj1.reshape(-1, 2), axis=1)))
        _, rvec2, tvec2 = cv2.solvePnP(op, ip2, K2, dist2)
        proj2, _ = cv2.projectPoints(op, rvec2, tvec2, K2, dist2)
        err2_i = float(np.mean(np.linalg.norm(ip2.reshape(-1, 2) - proj2.reshape(-1, 2), axis=1)))
        pair_errors.append((err1_i, err2_i))
        print(f"    Pair {i+1:2d}: cam1={err1_i:.3f}px  cam2={err2_i:.3f}px")

    # ------------------------------------------------------------------
    print("\n[5/5] stereoRectify")
    R1, R2, P1, P2, Q, _, _ = cv2.stereoRectify(
        K1, dist1,
        K2, dist2,
        image_size1,
        R, T,
        flags=cv2.CALIB_ZERO_DISPARITY,
        alpha=0,
        newImageSize=image_size1,
    )

    # ------------------------------------------------------------------
    print("\n[Bonus] triangulatePoints - demo on first valid pair")
    if valid > 0:
        c1_demo = img_points1_list[0].reshape(-1, 2).T.astype(np.float64)
        c2_demo = img_points2_list[0].reshape(-1, 2).T.astype(np.float64)
        pts4d = cv2.triangulatePoints(P1, P2, c1_demo, c2_demo)
        pts3d = (pts4d[:3] / pts4d[3]).T
        print(f"  Triangulated {len(pts3d)} checkerboard corners.")
        print(f"  Sample 3D points (first 3, in mm):")
        for pt in pts3d[:3]:
            print(f"    [{pt[0]:8.2f}, {pt[1]:8.2f}, {pt[2]:8.2f}]")
        z_vals = pts3d[:, 2]
        print(f"  Z range: {z_vals.min():.1f} – {z_vals.max():.1f} mm  (board was ~{z_vals.mean():.0f} mm from cam1)")

    # ------------------------------------------------------------------
    w, h = image_size1
    result = {
        "camera1": {
            "K": K1.tolist(),
            "distortion": dist1.flatten().tolist(),
            "imageWidth": w,
            "imageHeight": h,
            "reprojectionError": float(err1),
        },
        "camera2": {
            "K": K2.tolist(),
            "distortion": dist2.flatten().tolist(),
            "imageWidth": w,
            "imageHeight": h,
            "reprojectionError": float(err2),
        },
        "extrinsic": {
            "R": R.tolist(),
            "T": T.flatten().tolist(),
            "E": E.tolist(),
            "F": F.tolist(),
        },
        "P1": P1.tolist(),
        "P2": P2.tolist(),
        "stereoReprojectionError": float(stereo_err),
        "calibrationDate": datetime.utcnow().isoformat() + "Z",
        "checkerboardConfig": {
            "rows": inner_rows,
            "cols": inner_cols,
            "squareSize": square_size_mm,
        },
    }

    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    print(f"\nCalibration saved to: {output_path}")
    print(f"  Camera 1 error : {err1:.4f} px")
    print(f"  Camera 2 error : {err2:.4f} px")
    print(f"  Stereo error   : {stereo_err:.4f} px")
    print(f"  Baseline       : {baseline_mm:.1f} mm")
    print(f"\nTip: reprojection error < 1.0 px is good, < 0.5 px is excellent.")
    print(f"Load {output_path} in the web app via the 'Load Calibration' button.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Stereo camera calibration: checkerboard -> calibrateCamera -> stereoCalibrate -> stereoRectify"
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--cam1", metavar="DIR", help="Folder of camera-1 images")
    src.add_argument("--json", metavar="FILE", help="JSON captures export from the web app")
    parser.add_argument("--cam2", metavar="DIR", help="Folder of camera-2 images (required with --cam1)")
    parser.add_argument("--rows", type=int, required=True, help="Inner corner rows (squares - 1 vertically)")
    parser.add_argument("--cols", type=int, required=True, help="Inner corner cols (squares - 1 horizontally)")
    parser.add_argument("--square", type=float, required=True, help="Square size in mm")
    parser.add_argument("--out", default="stereo_calibration.json", help="Output JSON path")
    parser.add_argument("--preview", metavar="DIR", nargs="?", const="preview_out",
                        help="Verify frames without calibrating. Saves annotated images to DIR (default: preview_out/)")
    parser.add_argument("--flip-cam1", action="store_true", help="Horizontally flip Camera 1 images before processing")
    parser.add_argument("--flip-cam2", action="store_true", help="Horizontally flip Camera 2 images before processing")
    parser.add_argument("--diagnose", action="store_true", help="Run mirroring diagnostic and exit")
    args = parser.parse_args()

    if args.cam1 and not args.cam2:
        parser.error("--cam2 is required when --cam1 is used")

    print("OpenCV version:", cv2.__version__)
    print(f"Pattern: {args.cols}x{args.rows} inner corners, square size {args.square} mm")

    if args.json:
        print(f"\nLoading captures from JSON: {args.json}")
        pairs = load_from_json(args.json)
    else:
        print(f"\nLoading images from folders:\n  cam1: {args.cam1}\n  cam2: {args.cam2}")
        pairs = load_from_folders(args.cam1, args.cam2)

    print(f"Loaded {len(pairs)} image pairs")

    if args.diagnose:
        diagnose_mirroring(pairs, args.rows, args.cols)
    elif args.preview is not None:
        run_preview(pairs, args.rows, args.cols, args.preview)
    else:
        run_calibration(pairs, args.rows, args.cols, args.square, args.out,
                        flip_cam1=args.flip_cam1, flip_cam2=args.flip_cam2)


if __name__ == "__main__":
    main()