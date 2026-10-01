// Outlined lettering keeps the cover identical without embedding a font.
const wordmark = `<g fill="none" stroke="#e5e7e5" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0 0V88H54M78 30V64Q78 88 101 88Q124 88 124 64V30M152 88V30M152 45Q155 28 173 28Q192 28 192 48V88M192 45Q197 28 214 28Q234 28 234 48V88M263 30V88M341 34C330 26 303 25 300 43C296 64 344 51 344 72C344 91 313 94 298 82M374 59H426C426 17 373 19 373 58C373 91 405 94 425 81M509 30V114M509 58C509 17 456 19 456 58C456 98 509 98 509 58"/>
    <path d="M263 9V9.1" stroke-width="6"/>
  </g>`;

export function readmeBanner(markSvg) {
  const mark = markSvg.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="380" viewBox="0 0 1200 380" role="img" aria-labelledby="title desc">
  <title id="title">Lumiseq</title>
  <desc id="desc">The approved flowing L and s signature beside a custom silver line wordmark. Photography, layers and intelligence, on a graphite workspace.</desc>
  <rect width="1200" height="380" fill="#202224"/>
  <g transform="translate(219 81) scale(1.75)">${mark}</g>
  <g transform="translate(442 131) scale(1)">${wordmark}</g>
  <text x="600" y="302" fill="#b5bdc0" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="27">Photography. Layers. Intelligence.</text>
  <path d="M88 348H1112" stroke="#42474a"/>
</svg>\n`;
}

export function readmeArchitecture(dark = false) {
  const ink = dark ? '#e5e7e5' : '#24292f';
  const secondary = dark ? '#a7b0b4' : '#57606a';
  const line = dark ? '#89979d' : '#6e7e86';
  const muted = dark ? '#424a50' : '#d0d7de';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="672" viewBox="0 0 800 672" role="img" aria-labelledby="title desc">
  <title id="title">Lumiseq shared editing architecture</title>
  <desc id="desc">Workspace operations and AI or MCP canonical tools converge on CommandBus and DocumentManager. Documents feed rendering, assets and project persistence; native services provide RAW decoding, files and secure storage. AI observation and verification reuse document rendering.</desc>
  <defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1L7 4L1 7" fill="none" stroke="${line}" stroke-width="1.2"/></marker></defs>
  <g fill="none" stroke="${line}" stroke-width="1.5" marker-end="url(#arrow)">
    <path d="M136 94V132Q136 148 152 148H212Q228 148 228 164V190"/>
    <path d="M400 94V132Q400 148 416 148H552Q568 148 568 164V190"/>
    <path d="M664 94V132Q664 148 648 148H584Q568 148 568 164V190"/>
    <path d="M228 239V259Q228 277 246 277H382Q400 277 400 295V307"/>
    <path d="M568 239V259Q568 277 550 277H418Q400 277 400 295V307"/>
    <path d="M400 351V395"/>
    <path d="M400 439V459Q400 477 382 477H154Q136 477 136 495V511"/>
    <path d="M400 439V511"/>
    <path d="M400 439V459Q400 477 418 477H646Q664 477 664 495V511"/>
  </g>
  <g font-family="Arial,Helvetica,sans-serif" text-anchor="middle" fill="${ink}" font-size="30">
    <text x="136" y="52">Workspace</text>
    <text x="400" y="52">API / Agent</text>
    <text x="664" y="52">MCP</text>
    <text x="228" y="224">Operations</text>
    <text x="568" y="224">Canonical Tools</text>
    <text x="400" y="340">CommandBus</text>
    <text x="400" y="428">DocumentManager</text>
    <text x="136" y="545">Render</text>
    <text x="400" y="545">Assets</text>
    <text x="664" y="545">Project</text>
    <text x="400" y="622">Tauri / Rust</text>
  </g>
  <g font-family="Arial,Helvetica,sans-serif" text-anchor="middle" fill="${secondary}" font-size="21">
    <text x="136" y="82">React UI</text>
    <text x="400" y="82">Runtime + harness</text>
    <text x="664" y="82">AgentBridge</text>
    <text x="136" y="575">Preview + export</text>
    <text x="400" y="575">Source resources</text>
    <text x="664" y="575">Save + recovery</text>
    <text x="400" y="654">LibRaw · Filesystem · Secure storage</text>
  </g>
  <path d="M64 592H736" stroke="${muted}"/>
</svg>\n`;
}
