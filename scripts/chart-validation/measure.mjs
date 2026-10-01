import { deltaE00, srgbToLabD50, D50_WHITE_XYZ } from './color-math.mjs';
const text = value => typeof value === 'string' && value.trim().length > 0;
const median = values => {
  values.sort((a,b) => a-b);
  const n = values.length;
  return n % 2 ? values[(n-1)/2] : (values[n/2-1]+values[n/2])/2;
};

export function measureChart(image, manifest) {
  if (manifest?.schemaVersion !== 1 || manifest.inputColorSpace !== 'sRGB'
    || !text(manifest.capture) || !text(manifest.exportSettings)
    || !text(manifest.reference?.chart) || !text(manifest.reference?.source)
    || !text(manifest.reference?.illuminant) || manifest.reference?.white !== 'D50'
    || manifest.reference?.observer !== '2deg' || !Array.isArray(manifest.patches) || !manifest.patches.length) {
    throw new Error('Manifest requires sRGB, capture/export provenance, chart/source/illuminant and D50/2deg reference Lab');
  }
  const {width,height,channels,bitDepth,maxSample,samples} = image;
  if (![width,height].every(v=>Number.isSafeInteger(v) && v>0) || ![3,4].includes(channels)
    || ![8,16].includes(bitDepth) || maxSample !== (bitDepth===16?65535:255)
    || samples?.length !== width*height*channels) throw new Error('Invalid decoded image');
  const ids = new Set();
  const patches = manifest.patches.map(patch => {
    if (!text(patch.id) || ids.has(patch.id)) throw new Error('Patch IDs must be nonempty and unique');
    ids.add(patch.id);
    if (!Array.isArray(patch.lab) || patch.lab.length !== 3 || !patch.lab.every(Number.isFinite)
      || patch.lab[0] < 0 || patch.lab[0] > 100) throw new Error(`Invalid reference Lab: ${patch.id}`);
    const roi = patch.roi;
    if (!Array.isArray(roi) || roi.length !== 4 || !roi.every(Number.isSafeInteger)) throw new Error(`Invalid ROI: ${patch.id}`);
    const [x,y,w,h] = roi;
    if (x<0 || y<0 || w<=0 || h<=0 || x+w>width || y+h>height || w*h>1000000) throw new Error(`ROI out of bounds or exceeds 1M pixels: ${patch.id}`);
    const values=[[],[],[]], lowChannels=[0,0,0], highChannels=[0,0,0];
    let clippedPixels = 0;
    for (let yy=y; yy<y+h; yy++) for (let xx=x; xx<x+w; xx++) {
      const i = (yy*width+xx)*channels;
      if (channels===4 && samples[i+3]!==maxSample) throw new Error(`ROI must be opaque: ${patch.id}`);
      let clipped = false;
      for (let channel=0; channel<3; channel++) {
        const sample=samples[i+channel];
        if (!Number.isInteger(sample) || sample<0 || sample>maxSample) throw new Error('Invalid image sample');
        values[channel].push(sample);
        if (sample===0) {lowChannels[channel]++;clipped=true;}
        if (sample===maxSample) {highChannels[channel]++;clipped=true;}
      }
      if (clipped) clippedPixels++;
    }
    const medianRgb=values.map(v=>median(v)/maxSample), lab=srgbToLabD50(medianRgb);
    return {id:patch.id,roi:[...roi],pixels:w*h,medianRgb,measuredLab:lab,referenceLab:[...patch.lab],
      deltaE00:deltaE00(lab,patch.lab),clipping:{lowChannels,highChannels,pixels:clippedPixels,fraction:clippedPixels/(w*h)}};
  });
  const errors = patches.map(p=>p.deltaE00).sort((a,b)=>a-b);
  const position=(errors.length-1)*0.95, lower=Math.floor(position), upper=Math.ceil(position);
  return {schemaVersion:1,measurement:'channel median sRGB -> XYZ D65 -> Bradford -> Lab D50; CIEDE2000 kL=kC=kH=1',
    inputColorSpace:'sRGB',capture:manifest.capture,exportSettings:manifest.exportSettings,reference:{...manifest.reference},
    referenceWhiteXyz:[...D50_WHITE_XYZ],image:{width,height,channels,bitDepth},patches,
    summary:{count:errors.length,mean:errors.reduce((a,b)=>a+b,0)/errors.length,
      p95:errors[lower]+(errors[upper]-errors[lower])*(position-lower),max:errors.at(-1),
      clippedPatches:patches.filter(p=>p.clipping.pixels>0).length}};
}
