import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { decodePng } from './chart-validation/png.mjs';
import { measureChart } from './chart-validation/measure.mjs';

const usage = 'Usage: node scripts/validate-chart-color.mjs exported-srgb.png chart-reference.json [new-report.json]';
try {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.length > 3) throw new Error(usage);
  const [imagePath,manifestPath,outputPath] = args.map(path=>resolve(path));
  const samePath = (a,b) => process.platform==='win32' ? a.toLowerCase()===b.toLowerCase() : a===b;
  if (outputPath && (samePath(outputPath,imagePath) || samePath(outputPath,manifestPath))) throw new Error('Report must not overwrite input image or manifest');
  if (statSync(imagePath).size > 300*1024*1024) throw new Error('Input PNG exceeds 300 MiB file limit');
  if (statSync(manifestPath).size > 4*1024*1024) throw new Error('Reference manifest exceeds 4 MiB limit');
  const bytes=readFileSync(imagePath),manifestBytes=readFileSync(manifestPath);
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  const report=measureChart(decodePng(bytes),manifest);
  report.input={imagePath,manifestPath,sha256:createHash('sha256').update(bytes).digest('hex'),
    manifestSha256:createHash('sha256').update(manifestBytes).digest('hex')};
  report.generatedAt=new Date().toISOString();
  report.validationScope='Measures this exported image against supplied references; numeric regression does not establish physical camera color accuracy.';
  report.clippingDefinition='Any ROI RGB channel at exactly 0 or the maximum sample code; this flags export endpoint saturation and does not prove sensor clipping.';
  report.percentileMethod='Linear interpolation at (patchCount - 1) * 0.95, including clipped patches';
  const json=JSON.stringify(report,null,2)+'\n';
  if (outputPath) {
    writeFileSync(outputPath,json,{flag:'wx'});
    console.log(`Chart report: ${outputPath}`);
    console.log(JSON.stringify(report.summary));
  } else process.stdout.write(json);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode=1;
}
