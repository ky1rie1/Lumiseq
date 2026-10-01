import { ribbon } from './flow.mjs';
import { sharedSignature } from './signature.mjs';

export const path = sharedSignature([
  [[48, 29], [46, 43], [40, 59], [36, 71]],
  [[36, 71], [30, 89], [40, 94], [56, 89]],
], 8, 70, 74, { lowerX: 80, tipX: 91, tailRise: 5 });

const refinedEndPath = path.map(segment => segment.map(point => [...point]));
refinedEndPath.at(-1)[1] = [79, 54];
refinedEndPath.at(-1)[2] = [84, 54.5];
refinedEndPath.at(-1)[3] = [88, 55.5];

const smoothRange = (t, a, b) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const refinedEndPressure = t => 1 - .35 * smoothRange(t, .84, 1);

const transition = t => {
  const u = Math.min(1, Math.max(0, (t - .21) / .2));
  return u * u * (3 - 2 * u);
};
const offset = t => 4.9 - 1.3 * transition(t);
const mainWidth = t => (5.3 + 1.25 * Math.sin(Math.PI * t)) * (1 - .24 * transition(t));
const fineWidth = t => (3.0 + .9 * Math.sin(Math.PI * t)) * (1 - .24 * transition(t));

function mark(mono = false, opticalSize = 512) {
  const single = '#e5e7e5';
  const activePath = refinedEndPath;
  const pressure = refinedEndPressure;
  const primaryWidth = t => mainWidth(t) * pressure(t);
  const secondaryWidth = t => fineWidth(t) * pressure(t);
  const main = color => ribbon(activePath, { widthAt: primaryWidth, offsetAt: t => -offset(t), roundCaps: true, color });
  const fine = color => ribbon(activePath, { widthAt: secondaryWidth, offsetAt: offset, roundCaps: true, color });
  if (mono) return `<g transform="translate(3 0)">${fine(single)}${main(single)}</g>`;
  if (opticalSize <= 64) {
    // Preserve the approved curves while keeping the two ribbons readable at taskbar sizes.
    const weight = opticalSize <= 24 ? 1.28 : opticalSize <= 32 ? 1.16 : 1.07;
    const scale = opticalSize <= 24 ? 1.1 : opticalSize <= 32 ? 1.05 : 1;
    const smallMain = ribbon(activePath, { widthAt: t => primaryWidth(t) * weight, offsetAt: t => -offset(t), roundCaps: true, color: '#e8eeeb' });
    const smallFine = ribbon(activePath, { widthAt: t => secondaryWidth(t) * weight, offsetAt: offset, roundCaps: true, color: '#bacdce' });
    return `<g transform="translate(64 64) scale(${scale}) translate(-61 -64)">${smallFine}${smallMain}</g>`;
  }
  const artwork = `<defs>
    <linearGradient id="lit-ribbon" gradientUnits="userSpaceOnUse" x1="32" y1="27" x2="84" y2="94">
      <stop stop-color="#c9dfe5"/><stop offset=".18" stop-color="#fffef6"/>
      <stop offset=".43" stop-color="#d6e9ec"/><stop offset=".57" stop-color="#a6c2cc"/>
      <stop offset=".76" stop-color="#edfaff"/><stop offset="1" stop-color="#94b0bd"/>
    </linearGradient>
    <linearGradient id="lit-companion" gradientUnits="userSpaceOnUse" x1="32" y1="28" x2="84" y2="94">
      <stop stop-color="#b6cfd7"/><stop offset=".22" stop-color="#ddebf0"/>
      <stop offset=".58" stop-color="#829eac"/><stop offset=".83" stop-color="#bfd9e0"/>
      <stop offset="1" stop-color="#718d9b"/>
    </linearGradient>
    <linearGradient id="lit-edge" gradientUnits="userSpaceOnUse" x1="44" y1="27" x2="70" y2="94">
      <stop stop-color="white" stop-opacity=".85"/><stop offset=".38" stop-color="white" stop-opacity=".15"/>
      <stop offset=".7" stop-color="#f5ffff" stop-opacity=".65"/><stop offset="1" stop-color="white" stop-opacity=".1"/>
    </linearGradient>
    <radialGradient id="lit-hotspot" gradientUnits="userSpaceOnUse" cx="49" cy="32" r="13">
      <stop stop-color="#fffef8" stop-opacity=".7"/><stop offset="1" stop-color="#fffef8" stop-opacity="0"/>
    </radialGradient>
    <filter id="lit-bloom" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.15"/></filter>
    <filter id="lit-shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".55"/></filter>
    <clipPath id="lit-main-clip">${main('white')}</clipPath>
  </defs>
  <g transform="translate(3 0)">
    <g transform="translate(0 .7)" opacity=".35" filter="url(#lit-shadow)">${fine('#070e16')}${main('#070e16')}</g>
    <g opacity=".13" filter="url(#lit-bloom)">${main('#d9f3ff')}</g>
    ${fine('url(#lit-companion)')}${main('url(#lit-ribbon)')}
    <g clip-path="url(#lit-main-clip)">${ribbon(activePath, { widthAt: t => (.45 + .18 * (1 - transition(t))) * pressure(t), offsetAt: t => -offset(t) + primaryWidth(t) * .23, roundCaps: true, color: 'url(#lit-edge)' })}</g>
    <rect x="20" y="20" width="90" height="85" fill="url(#lit-hotspot)" clip-path="url(#lit-main-clip)"/>
  </g>`;
  return artwork
    .replaceAll('#c9dfe5', '#d8e2e1').replaceAll('#fffef6', '#fffdf5')
    .replaceAll('#d6e9ec', '#e1e9e7').replaceAll('#a6c2cc', '#bac8cb')
    .replaceAll('#edfaff', '#f3f5f0').replaceAll('#94b0bd', '#a5b7bd')
    .replaceAll('#b6cfd7', '#b7c8cc').replaceAll('#ddebf0', '#d7e2e1')
    .replaceAll('#829eac', '#8ca2a9').replaceAll('#bfd9e0', '#c5d5d5')
    .replaceAll('#718d9b', '#849da5').replaceAll('opacity=".13"', 'opacity=".065"')
    .replaceAll('stop-opacity=".85"', 'stop-opacity=".52"')
    .replaceAll('stop-opacity=".65"', 'stop-opacity=".4"')
    .replaceAll('stop-opacity=".7"', 'stop-opacity=".5"');
}

export function icon(mono = false, opticalSize = 512) {
  const base = `<defs>
    <linearGradient id="lit-tile" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2a3035"/><stop offset="1" stop-color="#171b20"/></linearGradient>
    <radialGradient id="lit-surface" cx=".31" cy=".17" r=".84"><stop stop-color="#c5d9de" stop-opacity=".075"/><stop offset="1" stop-color="#c5d9de" stop-opacity="0"/></radialGradient>
    <linearGradient id="lit-border" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d9e8e9" stop-opacity=".25"/><stop offset=".6" stop-color="#a8bdc8" stop-opacity=".06"/><stop offset="1" stop-color="#aec9d3" stop-opacity=".15"/></linearGradient>
  </defs>
  <rect x="3" y="3" width="122" height="122" rx="27" fill="url(#lit-tile)"/>
  <rect x="3" y="3" width="122" height="122" rx="27" fill="url(#lit-surface)"/>
  <rect x="3.5" y="3.5" width="121" height="121" rx="26.5" fill="none" stroke="url(#lit-border)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opticalSize}" height="${opticalSize}" viewBox="0 0 128 128" role="img" aria-label="Lumiseq 微光 LS 自然收尾与银白光感">${mono ? '' : base}${mark(mono, opticalSize)}</svg>`;
}
