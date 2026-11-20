import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {evaluateSession} from '../src/app/evaluation/metrics';
import {evaluationCsv,evaluationSidecar,evaluationSummary} from '../src/app/evaluation/exports';
import {object,at} from '../src/app/evaluation/statistics';
import type {EvaluationConfig} from '../src/app/evaluation/types';

const args=process.argv.slice(2),input=args[0];
if(!input||input.startsWith('--'))throw new Error('Usage: node --import tsx scripts/evaluate-comparison.ts recording.json [--config sidecar-or-config.json] [--outdir output-directory]');
const option=(name:string)=>{const at=args.indexOf(name);if(at<0)return null;if(!args[at+1]||args[at+1].startsWith('--'))throw new Error(name+' requires a path');return args[at+1];};
for(let i=1;i<args.length;i+=2)if(!['--config','--outdir'].includes(args[i]))throw new Error('Unknown argument: '+args[i]);
const inputPath=resolve(input),bytes=readFileSync(inputPath),source=JSON.parse(bytes.toString('utf8'));
let config:Partial<EvaluationConfig>={};const configPath=option('--config');
if(configPath){
  const value=object(JSON.parse(readFileSync(resolve(configPath),'utf8')));
  if(value.schemaVersion==='1.0.0-evaluation-sidecar'){
    const initial=evaluateSession(source);
    if(value.sessionId!==initial.source.sessionId||at(value,'sourceFingerprint','value')!==initial.source.fingerprint.value)throw new Error('Sidecar does not match this session/source fingerprint.');
    config=object(value.config) as Partial<EvaluationConfig>;
  }else config=value as Partial<EvaluationConfig>;
}
const report=evaluateSession(source,config),summary=evaluationSummary(report),outputDirectory=option('--outdir');
const sha256=createHash('sha256').update(bytes).digest('hex');
if(outputDirectory){
  const directory=resolve(outputDirectory),name='evaluation_'+report.source.sessionId.replace(/[^a-zA-Z0-9_-]/g,'_');
  const outputs:[string,string][]=[[name+'.json',JSON.stringify({...report,source:{...report.source,fileSha256:sha256}},null,2)],
    [name+'.csv',evaluationCsv(report)],[name+'_summary.txt',summary],[name+'_config.json',evaluationSidecar(report)]];
  if(outputs.some(([file])=>join(directory,file).toLowerCase()===inputPath.toLowerCase()))throw new Error('Refusing to overwrite the original input recording.');
  mkdirSync(directory,{recursive:true});for(const [file,content] of outputs)writeFileSync(join(directory,file),content,'utf8');
  console.log('Wrote report JSON, metrics CSV, Results summary and configuration sidecar to '+directory);
}
if(createHash('sha256').update(readFileSync(inputPath)).digest('hex')!==sha256)throw new Error('Source changed during evaluation; rerun against a stable file.');
console.log(summary);
console.log('Original source SHA-256 (unchanged): '+sha256);
