// Run only against a trusted locally built candidate. This script never installs it.
// Upstream build guide: https://docs.opencv.org/4.12.0/d4/da1/tutorial_js_setup.html
// Required exports must be explicitly bound; upstream default JS whitelist omits them.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
const file=path.resolve(process.argv[2]??'public/opencv.js'),source=readFileSync(file);
const functions=['Mat','MatVector','Size','TermCriteria','matFromImageData','cvtColor','findChessboardCorners','cornerSubPix','calibrateCamera','stereoCalibrate','stereoRectify'];
const constants=['TermCriteria_EPS','TermCriteria_MAX_ITER','CALIB_CB_ADAPTIVE_THRESH','CALIB_CB_NORMALIZE_IMAGE','COLOR_RGBA2GRAY','CV_32FC3','CV_32FC2','CALIB_FIX_INTRINSIC','CALIB_ZERO_DISPARITY'];
const sandbox={module:{exports:{}},exports:{},require:createRequire(file),process,console,Buffer,__dirname:path.dirname(file),setTimeout,clearTimeout,performance,WebAssembly};
vm.runInNewContext(source.toString('utf8'),sandbox,{filename:file});
const runtime=sandbox.module.exports;
const inspect=cv=>{const missing=[...functions.filter(k=>typeof cv[k]!=='function'),...constants.filter(k=>typeof cv[k]!=='number')];console.log(JSON.stringify({file,sha256:createHash('sha256').update(source).digest('hex'),requiredFunctions:functions,missing,capabilityCheckPassed:missing.length===0,scope:'Export/capability check only. Validate actual API signatures, checkerboard detections, calibration results, and held-out reprojections against independent Python OpenCV before manually installing a candidate.'},null,2));if(missing.length)process.exitCode=1;};
// Callback form also works for self-resolving legacy Emscripten thenables.
let finished=false;const timeout=setTimeout(()=>{if(!finished){console.error('OpenCV initialization timeout.');process.exitCode=1;}},30000);
const done=cv=>{if(finished)return;finished=true;clearTimeout(timeout);inspect(cv);};
if(typeof runtime.then==='function')runtime.then(done);else if(typeof runtime==='function'){const candidate=runtime();if(typeof candidate.then==='function')candidate.then(done);else done(candidate);}else if(runtime.ready?.then)runtime.ready.then(done);else done(runtime.default??runtime);
