import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString('utf8').split('\0').filter(Boolean);
const publishable = new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString('utf8').split('\0').filter(Boolean));
const rawExtensions = new Set(JSON.parse(await readFile(path.join(root, 'src/config/rawFormats.json'), 'utf8')));
const syntheticRawFixture = 'tests/fixtures/sample.dng';
const files = [...publishable].filter(file => file.endsWith('.md') && (!file.includes('/') || /^(?:docs|tests|resources|integration|artifacts|scripts)\//.test(file))).map(file => path.join(root, file));

let links = 0;
for (const file of files) {
  const markdown = (await readFile(file, 'utf8')).replace(/```[\s\S]*?```/g, '');
  for (const match of markdown.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
    const href = match[1] || match[2];
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(href)) continue;
    const target = decodeURIComponent(href.split(/[?#]/, 1)[0]);
    if (!target) continue;
    links++;
    const location = path.resolve(path.dirname(file), target);
    try {
      const metadata = await stat(location);
      const relative = path.relative(root, location).split(path.sep).join('/');
      const published = metadata.isDirectory()
        ? [...publishable].some(entry => entry.startsWith(relative ? `${relative}/` : ''))
        : publishable.has(relative);
      if (!published) failures.push(`${path.relative(root, file)}: link target excluded from source ${href}`);
    }
    catch { failures.push(`${path.relative(root, file)}: missing link target ${href}`); }
  }
  for (const match of markdown.matchAll(/<img\s[^>]*src="([^"]+)"/g)) {
    if (/^[a-z][a-z\d+.-]*:/i.test(match[1])) continue;
    links++;
    try {
      const location = path.resolve(path.dirname(file), match[1]);
      await stat(location);
      const relative = path.relative(root, location).split(path.sep).join('/');
      if (!publishable.has(relative)) failures.push(`${path.relative(root, file)}: image excluded from source ${match[1]}`);
    }
    catch { failures.push(`${path.relative(root, file)}: missing image ${match[1]}`); }
  }
}

let totalBytes = 0;
const forbidden = /^(?:node_modules|dist|dist-ssr|target|build-cache|generated-test-output|runtime-cache|reference-source|\.superpowers|\.codex|\.claude|\.agents|\.gemini|\.antigravity|\.cache|\.history|logs|sessions|transcripts|recordings)(?:\/|$)|^src-tauri\/(?:target|gen\/schemas)(?:\/|$)|^artifacts\/(?!README\.md$)|^docs\/(?:verification|superpowers)\/|^docs\/technical\/.*_DESIGN\.md$|(?:^|\/)\.env(?:\.|$)|\.(?:exe|onnx|pth|pt|safetensors|pdb|obj|tsbuildinfo|log|tmp|jsonl|sqlite|sqlite3)$/i;
for (const file of tracked) {
  if (file === '.env.example') continue;
  if (forbidden.test(file)) failures.push(`Tracked generated or private file: ${file}`);
  if (rawExtensions.has(path.extname(file).slice(1).toLowerCase()) && file !== syntheticRawFixture) {
    failures.push(`Tracked camera original: ${file}; keep camera samples outside the repository.`);
  }
  try {
    const metadata = await stat(path.join(root, file));
    totalBytes += metadata.size;
    if (metadata.size > 20 * 1024 * 1024) failures.push(`Tracked file exceeds 20 MiB: ${file}`);
  } catch { failures.push(`Index references a missing file: ${file}; stage the cleanup first.`); }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Repository checks passed: ${files.length} Markdown files, ${links} local links, ${tracked.length} tracked files (${(totalBytes / 1048576).toFixed(2)} MiB).`);
}
