# Offline P1–P4 evaluation

This workflow evaluates **archived final outputs**, not live inputs or a new fusion replay. It does not change calibration, reconstruction, correction, triggers, or recovery. There is no independent ground truth, so results describe availability, continuity, anatomical consistency and processing behavior—not absolute 3D positional accuracy.

## Reproduce an evaluation

1. Open **Offline Evaluation** in the application and import one or more `pipeline_comparison_*.json` files.
2. Select a recording. Measurement cycles are evaluated by default; enable warmup explicitly when needed.
3. Add disjoint annotations using experiment milliseconds or **absolute zero-based source indices**, including warmup. End boundaries are exclusive. Mark healthy visibility only when supported by experimental observation.
4. Choose a phase, pipeline, joint, anatomical segment and optional controller-state filter. Threshold controls affect offline calculations only.
5. Download report JSON, metrics CSV, neutral Results text and the configuration/annotation sidecar. Retain the original recording.
6. Reimport the matching sidecar for an identical analysis. Source/session fingerprint mismatches are rejected.

Hardware-free command line, from repository root:

```powershell
node --import tsx scripts/evaluate-comparison.ts "C:\path\pipeline_comparison_SESSION.json" --config "C:\path\evaluation_SESSION_config.json" --outdir "C:\path\evaluation-results"
```

Without `--outdir`, the command prints the summary and does not write reports. The CLI adds a SHA-256 source checksum and verifies the input was unchanged. Browser/engine reports use an explicitly non-cryptographic FNV-1a fingerprint for source/configuration change detection. No current date or random seed enters the deterministic engine report.

## Supported source formats and architecture

`evaluation/importSession.ts` reads current `1.0.0-live-pipeline-comparison` JSON and earlier comparison-shaped exports without optional fields/version markers. Unsupported explicit schemas are rejected. A known-schema malformed cycle is retained as missing output rather than dropped. Frame order is never sorted, shifted, stretched or resampled.

Stage 2C ZIPs contain videos and packet streams, not final evaluated P1–P4 poses, and are not imported here. Legacy single-pipeline `MotionRecording` files remain supported by the existing Analyze interface; the evaluator does not guess their pipeline identity or units.

The engine reuses `PipelineId`/joint definitions and the actual comparison validity contract. `configuration.ts` validates annotations/settings; `timeline.ts` handles durations and observed events; `metrics.ts` computes reports; `exports.ts` creates tables and export formats. The dashboard uses the existing Recharts dependency. No hardware, MediaPipe inference, or fusion-controller execution occurs during evaluation.

## Validity, clock and configuration rules

- A joint is valid only with finite XYZ, accepted visibility, and no explicit `valid:false`. Explicit per-joint validity takes precedence over a pipeline aggregate. A real `(0,0,0)` is not automatically missing; zero placeholders marked invalid are excluded.
- Older missing validity flags are inferred from finite points, visibility and an available pipeline status, with counts/warnings. Missing coordinate fields are not invented. Missing states are `UNKNOWN`, not `STEREO`.
- `experimentTimeMs` is authoritative. If unavailable, a relative time may be derived only from recorded `processingStartedPerformanceNowMs - originPerformanceNowMs`. Wall clock is never used for cadence.
- Configuration journal changes apply at their recorded experiment times, including calibration references. Original configurations/journal are included in the report. Missing geometry versions are not replaced with today's implementation.
- Calibrated right-arm lengths come from per-frame `segmentLengthDiagnostics.*.calibratedMm`, or the active non-failed `imuCalibration`. Learned FK reference lengths are not substituted for calibration. Left-arm references remain unavailable unless recorded by a future supported schema.
- The explicit combined IMU-active flag is retained when present. Otherwise it is derived only if both controller states are known: either controller in `IMU_CORRECTION` or `RECOVERY`. Per-controller correction-only percentages are also reported.

## Metric definitions

All formulas run identically for the default whole-measurement scope, explicitly included warmup, each annotation and the unannotated complement. Counts always refer to archived cycles, not all physical camera exposures.

### Session and availability

- Counts: total, warmup, measurement, unclassified, selected valid/missing frames.
- Availability: `100 * valid / selected cycles`. Zero denominator produces `null`.
- P3/P4 pairing: both valid, both invalid, recovered by P4, lost by P4. Net percentage-point difference: `100 * (recovered - lost) / selected cycles`.
- Missing runs contain consecutive selected source indices, without skipping intervening cycles. Start is the first missing sample; end is the next valid sample or available phase/recording boundary. Boundary runs are censored. Durations become unavailable for missing, duplicate, reversed or over-limit time intervals. Longest observable duration may be censored; mean duration uses only complete uncensored runs.

### State timing, events and recovery

States are the actual `STEREO`, `IMU_CORRECTION`, `RECOVERY`, `UNAVAILABLE`, or `UNKNOWN` values. State time uses bounded sample-and-hold `[t_i,t_(i+1))`, clipped to phase/measurement bounds. Final hold requires a recorded end. Intervals exceeding the configurable **250 ms default** or invalid timing are not held; unobserved time is separate. If no supported timed interval exists, state durations are unavailable, not measured zero.

Correction activations are observed transitions from another known state into `IMU_CORRECTION`; an initial active state is left-censored and is not a newly observed activation. Reasons are counted per activation, not repeatedly per active frame. Correction/recovery runs retain censoring; complete-episode duration summaries exclude censored episodes. Interrupted recovery ends in correction; unsuccessful recovery ends in correction or unavailability. A recovery still active at the boundary is censored, not automatically unsuccessful.

Failure evidence uses recorded P3 joint validity, explicit simulation or correction unreliability. Legacy length-triggered reasons remain historical recorded reasons; current policy is not replayed over them. If an observable failure precedes correction by valid consecutive timed cycles, report the positive **sampled lag**. Same-cycle failure/activation has a recorded cycle separation of zero but **unknown sub-cycle latency**. Physical failure onset and sensor-to-output latency are not recoverable from these fields.

Activations during healthy visibility require a manually marked `healthyVisibility:true` interval. A `STEREO` state does not establish visibility or ground truth. Counts are null/not assessable when no explicitly healthy samples exist.

### Anatomical consistency

For P2/P3/P4, compute Euclidean XYZ length for left/right shoulder–elbow and elbow–wrist, using valid endpoints only. Units are calibration millimeters according to the comparison schema. Report valid/missing counts, mean, median, population SD, extrema, p95/p99, MAD and IQR.

Signed calibrated deviation is `L - L_reference`; absolute relative deviation is `abs(L-L_reference)/L_reference`. Report fraction exceeding the configurable **25% default** among reference-available frames. These thresholds are offline diagnostics and never influence fusion. State-conditioned summaries for P2/P3 are conditioned on **P4's recorded controller state**, not an invented P2/P3 controller.

P4 lengths may be stabilized by kinematic constraints. Constant segment length is not independent evidence of accurate positions.

### Continuity

Use only valid samples at consecutive source indices with `0 < dt <= maxObservationGapMs`:

`displacement = ||p_i - p_(i-1)||`; `speed = displacement / (dt_ms/1000)`.

P2–P4 use XYZ and mm/mm per second. **P1 uses normalized image XY only**; inferred relative Z is excluded. Normalized image coordinates and calibration millimeters are different quantities and cannot support direct absolute displacement, speed or segment-length rankings across P1 and stereo.

Report distributions and p95/p99, large-distance and large-speed screening counts. Defaults: 100 mm and 3000 mm/s for stereo; 0.1 normalized XY and 2 normalized XY/s for P1. These flag intervals for inspection; rapid intended movement is not automatically an algorithmic error.

Transition neighborhoods default to **±100 ms** around correction entries and recovery entries/exits affecting the joint. Ordinary motion excludes both neighborhoods. No interpolation fills invalid output, observation gaps or phase/state-filter gaps. This is offline neighborhood analysis, not future-sample use in reconstruction.

### Processing performance

Effective cadence FPS is `positive consecutive selected interval count / sum(interval seconds)`; interval distributions and large-gap counts are retained. Cadence is not computational latency.

Shared processing duration uses the recorded duration, or an available same-clock completed-minus-started span. Inference and post-inference spans use their explicit recorded boundaries. Per-pipeline timings remain unavailable unless explicitly recorded; the shared duration is never attributed independently to four pipelines.

Cycle-ID and browser presentation-counter gaps are indicators only, not proof of dropped encoded frames, network loss or hardware synchronization.

### Statistics

Population SD: `sqrt(sum((x-mean)^2)/N)`. MAD: `median(abs(x-median))`. IQR: `Q75-Q25`. Percentiles interpolate linearly at index `p*(N-1)` of sorted valid values. Empty statistical results are `null`; single-sample SD is zero. Non-finite JSON values are never emitted.

## Annotation and export schemas

Example configuration annotation:

```json
{"id":"visible","label":"Visible baseline","coordinate":"time_ms","start":3000,"end":7000,"healthyVisibility":true}
```

`coordinate:"frame_index"` uses absolute source indices with exclusive end. IDs `whole`/`unlabeled` are reserved. Overlapping phases are rejected to avoid ambiguous duration allocation. Unlabeled intervals remain available as a separate scope.

The `1.0.0-evaluation-sidecar` contains session ID, source fingerprint and full `1.0.0-evaluation-config`, including annotations and thresholds. It never modifies the recording.

The `1.0.0-offline-evaluation` report contains engine version, complete configuration, source identity, session summary, data-quality counts, warnings, original runtime configurations/journal, metric definitions, all scopes, observed controller events and normalized frame-level data. CSV is a long metrics table with source/config fingerprints, scope labels, pipeline, joint/segment, metric, value and units. Missing numbers are empty CSV cells. Spreadsheet formula-like user text is escaped.

The Results text describes conditions, availability comparisons, segment consistency, event/duration summaries and limitations in neutral language. It does not turn availability improvements into accuracy claims. Figures, hypothesis tests, cross-subject inference and absolute accuracy remain separate future work.

## Validation

The test suite uses analytically specified sessions for visibility, correction/recovery, irregular timing, malformed fields, warmup, phase boundaries, calibration changes, continuity and exports. The provided visible-to-occluded recording is additionally checked with the **user-specified** 114/178-measurement-frame partition; this partition is not inferred from state changes. See the saved reference sidecar and validation results in this directory. These are data checks, not hardcoded evaluator outcomes.

Dashboard use is in-memory; retain downloaded sidecars and reports before leaving/reloading. Very large sessions may require future worker/streaming support. Manual annotations and sample-and-hold durations carry uncertainty. Hardware synchronization and absolute accuracy are not established.
