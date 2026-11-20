"""Configure/build a local pinned official source checkout; never install public/opencv.js.
Requirements: Emscripten 3.1.64, CMake, Ninja. Official upstream only.
Source pin: OpenCV 4.12.0 / 49486f61fb25722cbcf586b7f4320921d46fb38e.
SDK manager pin: 0b3bcbc3b005cbb811d48e497eabcc6846d43001 / SDK 3.1.64.
"""
import argparse, json, os, pathlib, subprocess, sys
COMMIT = "49486f61fb25722cbcf586b7f4320921d46fb38e"
p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--source", required=True); p.add_argument("--emsdk", required=True)
p.add_argument("--cmake", required=True); p.add_argument("--ninja", required=True)
p.add_argument("--build-dir", required=True); p.add_argument("--jobs", type=int, default=4)
a = p.parse_args()
source, sdk, build = [pathlib.Path(x).resolve() for x in [a.source, a.emsdk, a.build_dir]]
if (source / ".git").exists():
    actual = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
else:
    actual = json.loads((source / "source-provenance.json").read_text())["commit"]
if actual != COMMIT:
    raise SystemExit("Refusing to build unpinned OpenCV source: " + actual)
env = dict(os.environ)
env["EMSDK"] = str(sdk); env["EM_CONFIG"] = str(sdk / ".emscripten")
env["EM_CACHE"] = str(sdk / "upstream/emscripten/cache")
env["OPENCV_PINNED_SOURCE"] = str(source)
env["CMAKE_GENERATOR"] = "Ninja"
env["PATH"] = os.pathsep.join([str(pathlib.Path(a.cmake).resolve().parent), str(pathlib.Path(a.ninja).resolve().parent), str(sdk / "upstream/emscripten"), env["PATH"]])
sdk_revision = subprocess.check_output(["git", "-C", str(sdk), "rev-parse", "HEAD"], text=True).strip()
if sdk_revision != "0b3bcbc3b005cbb811d48e497eabcc6846d43001":
    raise SystemExit("Refusing unpinned SDK manager checkout: " + sdk_revision)
compiler_version = subprocess.check_output([sys.executable, str(sdk / "upstream/emscripten/emcc.py"), "--version"], env=env, text=True)
if "3.1.64" not in compiler_version.splitlines()[0]:
    raise SystemExit("Refusing a different compiler version: " + compiler_version)
print(compiler_version.splitlines()[0], flush=True)
config = pathlib.Path(__file__).resolve().with_name("opencv-calibration.config.py")
command = [sys.executable, str(source / "platforms/js/build_js.py"), str(build), "--emscripten_dir", str(sdk / "upstream/emscripten"), "--config", str(config), "--config_only", "--enable_exception",
    "--cmake_option=-DCMAKE_MAKE_PROGRAM=" + str(pathlib.Path(a.ninja).resolve()),
    "--cmake_option=-DBUILD_LIST=core,imgproc,calib3d,features2d,flann,js",
    "--cmake_option=-DBUILD_opencv_calib3d=ON", "--cmake_option=-DBUILD_opencv_features2d=ON", "--cmake_option=-DBUILD_opencv_flann=ON",
    "--cmake_option=-DWITH_ITT=OFF", "--cmake_option=-DBUILD_TESTS=OFF", "--cmake_option=-DBUILD_PERF_TESTS=OFF"]
subprocess.run(command, env=env, check=True)
# OpenCV's upstream LINK_FLAGS leaves --post-js unquoted on Windows.
# Quote the generated Ninja argument only; official sources/bindings are untouched.
ninja_file = build / "build.ninja"
if os.name == "nt" and " " in str(source) and ninja_file.exists():
    helper = (source / "modules/js/src/helpers.js").as_posix()
    text = ninja_file.read_text(encoding="utf-8")
    ninja_file.write_text(text.replace("--post-js " + helper, '--post-js "' + helper + '"'), encoding="utf-8")
subprocess.run([a.cmake, "--build", str(build), "--target", "opencv.js", "--parallel", str(a.jobs)], env=env, check=True)
print("Candidate only (not installed):", build / "bin/opencv.js")
