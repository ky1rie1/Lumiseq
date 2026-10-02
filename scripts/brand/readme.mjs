import { typefaces } from './readme-type.mjs';

function alphabet(name, text) {
  return [...new Set(text)].map(char => {
    const glyph = typefaces[name][char];
    if (!glyph) throw new Error(`Missing README glyph: ${name}/${char}`);
    return `<path id="${name}-${char.codePointAt(0)}" d="${glyph.path}"/>`;
  }).join('');
}

function lettering(name, text, x, y, size, fill, centered = false) {
  const glyphs = [...text].map(char => {
    const glyph = typefaces[name][char];
    if (!glyph) throw new Error(`Missing README glyph: ${name}/${char}`);
    return { char, ...glyph };
  });
  const scale = size / 1000;
  const width = glyphs.reduce((sum, glyph) => sum + glyph.advance, 0);
  let cursor = 0;
  const uses = glyphs.map(glyph => {
    const use = `<use href="#${name}-${glyph.char.codePointAt(0)}" x="${cursor.toFixed(2)}"/>`;
    cursor += glyph.advance;
    return use;
  }).join('');
  return `<g fill="${fill}" transform="translate(${centered ? (x - width * scale / 2).toFixed(2) : x} ${y}) scale(${scale})" aria-hidden="true">${uses}</g>`;
}

export function readmeBanner(markSvg) {
  const mark = markSvg.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320" viewBox="0 0 1200 320" role="img" aria-labelledby="title desc">
  <title id="title">Lumiseq</title>
  <desc id="desc">The silver LS signature, optically aligned with the compact Lumiseq wordmark on graphite. A desktop photo editor.</desc>
  <defs>${alphabet('manrope', 'LumiseqPhoto editor')}</defs>
  <rect width="1200" height="320" fill="#202224"/>
  <g transform="translate(239 45) scale(1.8)">${mark}</g>
  ${lettering('manrope', 'Lumiseq', 465, 192, 104, '#e5e7e5')}
  ${lettering('manrope', 'Photo editor', 469, 239, 25, '#aab3b7')}
</svg>\n`;
}

export function readmeArchitecture(dark = false) {
  const ink = dark ? '#e5e7e5' : '#24292f';
  const line = dark ? '#a7b0b4' : '#647079';
  const nodes = [
    ['Editor', 135, 66, 38], ['AI / Agent', 450, 66, 38], ['MCP', 765, 66, 38],
    ['Operations', 200, 172, 34], ['Canonical tools', 620, 172, 34],
    ['CommandBus', 450, 266, 36], ['DocumentManager', 450, 347, 36],
    ['Render', 165, 444, 34], ['Assets', 450, 444, 34], ['Project', 735, 444, 34],
    ['Tauri / Rust + LibRaw', 450, 522, 28],
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="550" viewBox="0 0 900 550" role="img" aria-labelledby="title desc">
  <title id="title">Lumiseq editing architecture</title>
  <desc id="desc">Editor operations and AI or MCP tools converge on the command bus and document manager. Rendering, assets and project persistence consume document state. Tauri, Rust and LibRaw provide native services. Handwritten labels use outlined Caveat lettering.</desc>
  <defs>${alphabet('caveat', nodes.map(node => node[0]).join(''))}<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M1 1Q5 3 8 5Q5 7 1 9" fill="none" stroke="${line}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
  <g fill="none" stroke="${line}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrow)">
    <path d="M135 82C132 112 163 118 187 124Q201 130 200 141"/>
    <path d="M450 82C450 120 559 112 602 125Q621 131 620 141"/>
    <path d="M765 82C767 119 675 109 640 126Q623 133 622 141"/>
    <path d="M200 184C200 224 370 199 432 224Q449 229 449 237"/>
    <path d="M620 184C619 218 505 208 465 224Q452 229 452 237"/>
    <path d="M450 281Q446 297 450 315"/>
    <path d="M450 361C448 400 225 376 182 402Q163 408 165 415"/>
    <path d="M450 361Q453 386 450 415"/>
    <path d="M450 361C452 400 675 376 718 402Q737 408 735 415"/>
  </g>
  ${nodes.map(([text, x, y, size]) => lettering('caveat', text, x, y, size, ink, true)).join('\n  ')}
  <path d="M120 478Q450 475 780 478" fill="none" stroke="${line}" stroke-opacity=".45" stroke-linecap="round"/>
</svg>\n`;
}
