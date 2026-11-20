import type {EvaluationReport} from './types';
import {PIPELINE_IDS} from './importSession';
import {LANDMARK_KEYS} from '../hooks/useTriangulation';
import {at,fingerprint} from './statistics';

export interface MetricRow {scope:string;pipeline:string;jointOrSegment:string;metric:string;value:number|string|null;unit:string;}
export function metricsRows(report:EvaluationReport):MetricRow[] {
  const rows:MetricRow[]=[];
  const add=(scope:string,pipeline:string,jointOrSegment:string,metric:string,value:number|string|null,unit:string)=>rows.push({scope,pipeline,jointOrSegment,metric,value,unit});
  for(const scope of report.scopes){
    add(scope.id,'all','session','cycles',scope.frameCount,'cycles');add(scope.id,'all','session','effective_fps',scope.performance.effectiveFps,'Hz');
    for(const [key,value] of Object.entries(scope.dataQuality))add(scope.id,'all','data_quality',key,value,'cycles');
    add(scope.id,'P4','both_controllers','IMU_active_frames',scope.imuActiveFrames,'cycles');add(scope.id,'P4','both_controllers','IMU_active_percent',scope.imuActivePercent,'% of known active flags/states');
    for(const id of PIPELINE_IDS)for(const joint of LANDMARK_KEYS){
      const a=scope.availability[id][joint],m=scope.motion[id][joint];
      add(scope.id,id,joint,'valid_frames',a.validFrames,'cycles');add(scope.id,id,joint,'missing_frames',a.missingFrames,'cycles');add(scope.id,id,joint,'availability',a.availabilityPercent,'%');
      add(scope.id,id,joint,'longest_missing_interval',a.longestMissingIntervalMs,'ms; may be censored');add(scope.id,id,joint,'mean_complete_missing_interval',a.meanCompleteMissingIntervalMs,'ms');
      for(const group of ['overall','ordinary','nearActivation','nearRecovery'] as const){
        for(const [name,data,unit] of [['displacement',m[group].displacement,m.units],['speed',m[group].speed,m.speedUnits]] as const)
          for(const stat of ['count','mean','median','stdDev','min','max','p95','p99','mad','iqr'] as const)add(scope.id,id,joint,`${group}_${name}_${stat}`,data[stat],stat==='count'?'intervals':unit);
        add(scope.id,id,joint,`${group}_large_displacement_count`,m[group].largeDisplacementCount,'screened intervals');add(scope.id,id,joint,`${group}_large_speed_count`,m[group].largeSpeedCount,'screened intervals');
      }
    }
    for(const joint of LANDMARK_KEYS)for(const [metric,value] of Object.entries(scope.p3VersusP4[joint]))add(scope.id,'P3_vs_P4',joint,metric,value,metric==='improvementPercentagePoints'?'percentage points':'cycles');
    for(const controller of ['upperArm','forearm'] as const){const m=scope.controllers[controller];
      for(const [state,value] of Object.entries(m.stateFrames))add(scope.id,'P4',controller,state+'_frames',value,'cycles');
      for(const [state,value] of Object.entries(m.stateTimeMs))add(scope.id,'P4',controller,state+'_time',value,'ms, bounded sample-and-hold');
      for(const metric of ['correctionActivations','interruptedRecoveries','unsuccessfulRecoveries','censoredRecoveries','activationsDuringAnnotatedHealthy','healthyAnnotatedFrames','unobservedTimeMs','correctionFramePercent','imuInfluenceFramePercent'] as const)add(scope.id,'P4',controller,metric,m[metric],metric.endsWith('Ms')?'ms':metric.endsWith('Percent')?'%':'count');
      for(const [name,stats] of [['correctionDurationMs',m.correctionDurationMs],['recoveryDurationMs',m.recoveryDurationMs],['activationLatenciesMs',m.activationLatenciesMs]] as const)for(const [stat,value] of Object.entries(stats))add(scope.id,'P4',controller,name+'_'+stat,value,stat==='count'?'episodes':'ms');
      for(const [reason,count] of Object.entries(m.activationReasons))add(scope.id,'P4',controller,'activation_reason: '+reason,count,'observed activations');
    }
    for(const id of ['P2','P3','P4'] as const)for(const [segment,m] of Object.entries(scope.anatomical[id])){
      for(const [name,stats,unit] of [['length',m.lengthMm,'mm'],['reference',m.calibratedReferenceMm,'mm'],['deviation',m.deviationMm,'mm'],['absoluteDeviationFraction',m.absoluteDeviationFraction,'fraction']] as const)
        for(const [stat,value] of Object.entries(stats))add(scope.id,id,segment,name+'_'+stat,value,stat==='count'?'valid cycles':unit);
      add(scope.id,id,segment,'exceeding_deviation_threshold',m.exceedingThresholdPercent,'% of frames with reference');
      add(scope.id,id,segment,'valid_length_frames',m.validLengthFrames,'cycles');add(scope.id,id,segment,'missing_length_frames',m.missingLengthFrames,'cycles');
      for(const [state,group] of Object.entries(m.byControllerState))if(group)for(const [name,stats] of [['length',group.lengthMm],['deviation',group.deviationMm]] as const)
        for(const [stat,value] of Object.entries(stats))add(scope.id,id,segment,`P4_${state}_${name}_${stat}`,value,stat==='count'?'valid cycles':'mm');
    }
    for(const [name,stats] of [['frame_interval',scope.performance.frameIntervalsMs],['processing',scope.performance.processingDurationMs],['inference_span',scope.performance.inferenceSpanMs],['post_inference_span',scope.performance.postInferenceSpanMs]] as const)
      for(const [stat,value] of Object.entries(stats))add(scope.id,'shared','processing',name+'_'+stat,value,stat==='count'?'samples':'ms');
    for(const id of PIPELINE_IDS)for(const [stat,value] of Object.entries(scope.performance.perPipelineDurationMs[id]))add(scope.id,id,'processing','duration_'+stat,value,stat==='count'?'samples':'ms');
    add(scope.id,'shared','cadence','skipped_cycle_id_indicators',scope.performance.skippedCycleIdIndicators,'indicators, not proven dropped frames');
    add(scope.id,'cameraA','cadence','skipped_presentation_indicators',scope.performance.skippedCameraAPresentationIndicators,'browser presentation indicators');
    add(scope.id,'shared','cadence','large_observation_gaps',scope.performance.largeObservationGaps,'intervals');
  }
  for(const phase of report.comparative.phases)for(const [representation,data] of Object.entries(phase.representations)){
    const scope=phase.annotation.id,joint=report.comparative.joint;
    add(scope,'all',joint,representation+'_phase_kind',phase.kind,'operator annotation');
    for(const [id,m]of Object.entries(data.independent)){
      for(const [name,value,unit]of [['RMS_position_variation',m.rms,m.units],['valid_samples',m.validSamples,'samples'],['availability',m.availabilityPercent,'%'],['duration',m.durationMs,'ms'],['amplitude',m.amplitude,m.units],['path_length',m.pathLength,m.units],['constant_intervals',m.constantIntervals,'screened intervals'],['constant_duration',m.constantDurationMs,'ms'],['normalization_missing_samples',m.normalizationMissingSamples,'samples'],['normalization_observed_references',m.normalizationObservedSamples,'samples'],['normalization_carried_references',m.normalizationCarriedSamples,'samples'],['large_displacements',m.largeDisplacements,'screened intervals'],['large_speeds',m.largeSpeeds,'screened intervals']] as const)add(scope,id,joint,representation+'_'+name,value,unit);
      for(const [axis,value]of (m.axisStdDev??[]).entries())add(scope,id,joint,representation+'_axis_'+axis+'_SD',value,m.units);
      for(const name of ['displacement','speed','acceleration','jerk'] as const)for(const [stat,value]of Object.entries(m[name]))add(scope,id,joint,representation+'_'+name+'_'+stat,value,stat==='count'?'intervals':m.units+(name==='speed'?'/s':name==='acceleration'?'/s^2':name==='jerk'?'/s^3':''));
    }
    for(const pair of data.pairs){const id=pair.pipelines.join('_vs_');
      for(const [side,m]of [['first',pair.first],['second',pair.second]] as const)for(const name of ['displacement','speed','acceleration','jerk'] as const)for(const [stat,value]of Object.entries(m[name]))add(scope,id,joint,representation+'_paired_'+side+'_'+name+'_'+stat,value,stat==='count'?'intervals':m.units+(name==='speed'?'/s':name==='acceleration'?'/s^2':name==='jerk'?'/s^3':''));
      for(const [name,value,unit]of [['common_samples',pair.commonSamples,'samples'],['common_coverage',pair.commonCoveragePercent,'%'],['coordinate_difference_mean',pair.coordinateDifference.mean,pair.first.units],['coordinate_difference_median',pair.coordinateDifference.median,pair.first.units],['coordinate_difference_max',pair.coordinateDifference.max,pair.first.units],['exactly_identical',pair.exactlyIdentical,'samples'],['different',pair.different,'samples'],['RMS_first',pair.first.rms,pair.first.units],['RMS_second',pair.second.rms,pair.second.units],['RMS_reduction',pair.rmsReductionPercent,'%; positive means second lower'],['amplitude_ratio',pair.amplitudeRatio,'second/first'],['path_ratio',pair.pathLengthRatio,'second/first'],['relative_freeze_intervals',pair.relativeFreezeIntervals,'screened intervals'],['relative_delay',pair.delay.lagMs,'ms; exploratory'],['delay_matches',pair.delay.matchedSamples,'timestamp pairs']] as const)add(scope,id,joint,representation+'_paired_'+name,value,unit);
    }
  }
  return rows;
}
function csvCell(value:unknown):string {
  const s=value===null||value===undefined?'':String(value);
  // Spreadsheet formula injection protection for user labels/reasons.
  const safe=/^[=+@\-]/.test(s)&&typeof value!=='number'?"'"+s:s;
  return /[",\r\n]/.test(safe)?'"'+safe.replaceAll('"','""')+'"':safe;
}
export function evaluationCsv(report:EvaluationReport,additionalRows:MetricRow[]=[]):string {
  const header=['session_id','source_fingerprint','config_fingerprint','engine_version','scope','scope_label','pipeline','joint_or_segment','metric','value','unit'];
  const configHash=fingerprint(JSON.stringify(report.config));
  return [header.join(','),...[...metricsRows(report),...additionalRows].map(r=>[report.source.sessionId,report.source.fingerprint.value,configHash,report.engineVersion,r.scope,report.scopes.find(s=>s.id===r.scope)?.label??r.scope,r.pipeline,r.jointOrSegment,r.metric,r.value,r.unit].map(csvCell).join(','))].join('\r\n')+'\r\n';
}
const number=(v:number|null,digits=2)=>v===null?'unavailable':v.toFixed(digits);
export function evaluationSummary(report:EvaluationReport):string {
  const lines=[`Offline motion-capture evaluation: ${report.source.sessionId}`,`Engine ${report.engineVersion}; source ${report.source.schema}; fingerprint ${report.source.fingerprint.algorithm}:${report.source.fingerprint.value}.`,
    `The recording contains ${report.summary.totalCycles} cycles (${report.summary.warmupCycles} warmup, ${report.summary.measurementCycles} measurement, ${report.summary.unclassifiedCycles} unclassified). Declared duration: ${number(report.summary.durationMs===null?null:report.summary.durationMs/1000)} s. Completion: ${report.summary.completeness}.`,
    `Evaluation conditions: warmup ${report.config.includeWarmup?'included':'excluded'}; unclassified cycles ${report.config.includeUnclassified?'included':'excluded'}; timing gap limit ${report.config.maxObservationGapMs} ms; transition neighborhood +/-${report.config.transitionWindowMs} ms; analysis-only length deviation threshold ${(report.config.lengthDeviationThresholdFraction*100).toFixed(1)}%.`,
    `Controller filter: ${report.config.controllerFilter?report.config.controllerFilter.controller+' '+report.config.controllerFilter.state:'none'}. Annotations are user-specified and do not establish controller truth.`,
    'Recorded geometry versions: '+[...new Set(report.configurations.map(c=>at(c,'stereoGeometry','method')).filter(v=>typeof v==='string'))].join(', ')+'.',
    ''];
  for(const s of report.scopes){
    lines.push(`${s.label} [${s.id}]: ${s.frameCount} cycles; effective cadence ${number(s.performance.effectiveFps)} Hz.`);
    for(const id of PIPELINE_IDS){const a=s.availability[id].rightWrist;lines.push(`  ${id} right-wrist availability: ${a.validFrames}/${s.frameCount} (${number(a.availabilityPercent)}%).`);}
    const r=s.p3VersusP4.rightWrist;lines.push(`  P3/P4 right wrist: both valid ${r.bothValid}; both invalid ${r.bothInvalid}; P4 recovered ${r.recoveredByP4}; P4-only losses ${r.lostByP4}; net availability difference ${number(r.improvementPercentagePoints)} percentage points.`);
    lines.push(`  Combined IMU influence flag: ${s.imuActiveFrames}/${s.imuActiveKnownFrames} known cycles (${number(s.imuActivePercent)}%); correction and recovery contributions may both be included.`);
    for(const controller of ['upperArm','forearm'] as const){const m=s.controllers[controller];lines.push(`  ${controller}: ${m.correctionActivations} observed correction entries; ${m.interruptedRecoveries} interrupted recoveries; ${m.censoredRecoveries} censored recovery episodes; activations in explicitly healthy intervals ${m.activationsDuringAnnotatedHealthy??'not assessable'}.`);
      lines.push(`    State time estimates (ms): ${Object.entries(m.stateTimeMs).map(([key,v])=>key+'='+number(v)).join(', ')}; unobserved=${number(m.unobservedTimeMs)}.`);}
    for(const id of ['P2','P3','P4'] as const)for(const segment of ['rightUpperArm','rightForearm'] as const){const m=s.anatomical[id][segment];lines.push(`  ${id} ${segment}: median ${number(m.lengthMm.median)} mm; SD ${number(m.lengthMm.stdDev)} mm; MAD ${number(m.lengthMm.mad)} mm; deviation threshold exceeded in ${number(m.exceedingThresholdPercent)}% of ${m.framesWithReference} reference-available cycles.`);}
    lines.push(`  Shared processing duration: median ${number(s.performance.processingDurationMs.median)} ms, p95 ${number(s.performance.processingDurationMs.p95)} ms. This is not camera exposure-to-output latency.`, '');
  }
  const activations=report.events.filter(e=>e.kind==='correction_activation');
  lines.push(`Observed activation events (${activations.length}):`);
  for(const e of activations.slice(0,30))lines.push(`  ${e.controller}, frame ${e.index}, t=${number(e.timeMs)} ms: ${e.reason??'reason unavailable'}. ${e.latencyInterpretation}`);
  if(activations.length>30)lines.push('  Additional events are available in the JSON report.');
  lines.push('','Annotated comparative analysis:',...report.comparative.phases.map(p=>`${p.annotation.label} (${p.kind}): ${p.selectedCycles} selected cycles, ${p.durationMs??'unknown'} ms; joint ${report.comparative.joint}. Stationary means remain separate.`),...report.comparative.warnings);
  for(const phase of report.comparative.phases){
    lines.push(`${phase.annotation.label} (${phase.kind}), ${phase.selectedCycles} selected cycles, ${phase.durationMs??'unavailable'} ms:`);
    for(const id of PIPELINE_IDS){const m=phase.representations.native.independent[id],normalized=phase.representations.common2d.independent[id];lines.push(`  ${id}: native ${m.units}, valid ${m.validSamples}, dispersion RMS ${number(m.rms)}, median/p95 step ${number(m.displacement.median)}/${number(m.displacement.p95)}, path ${number(m.pathLength)}, amplitude ${number(m.amplitude)}; common image-plane RMS ${number(normalized.rms)} body widths (${normalized.validSamples} samples).`);}
    for(const pair of phase.representations.native.pairs.filter(p=>p.available))lines.push(`  ${pair.pipelines.join('/')}: common N=${pair.commonSamples}; coordinate disagreement mean=${number(pair.coordinateDifference.mean)} mm; amplitude ratio=${number(pair.amplitudeRatio)}; relative delay=${number(pair.delay.lagMs)} ms (${pair.delay.matchedSamples} matches). ${pair.delay.reason}`);
  }
  lines.push('','Interpretation: availability differences describe retained pose output, not proven positional accuracy. Segment consistency can be imposed by kinematic constraints. Displacements and speeds can reflect intentional motion. P1 normalized image XY is not metrically equivalent to P2-P4 3D coordinates.','', 'Data quality and limitations:',...report.warnings.map(w=>'- '+w));
  return lines.join('\n')+'\n';
}
export function evaluationSidecar(report:EvaluationReport):string {
  return JSON.stringify({schemaVersion:'1.0.0-evaluation-sidecar',sessionId:report.source.sessionId,sourceFingerprint:report.source.fingerprint,config:report.config},null,2);
}
