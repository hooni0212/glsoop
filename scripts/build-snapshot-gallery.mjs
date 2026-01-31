import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const snapshotRoot = process.env.GLSOOP_SNAPSHOT_ROOT
  ? path.resolve(repoRoot, process.env.GLSOOP_SNAPSHOT_ROOT)
  : path.join(repoRoot, 'test-results', 'ui-snapshots');

const parseRunId = () => {
  const args = process.argv.slice(2);
  const runFlagIndex = args.findIndex((arg) => arg === '--run' || arg === '-r');
  if (runFlagIndex !== -1 && args[runFlagIndex + 1]) {
    return args[runFlagIndex + 1];
  }
  return process.env.GLSOOP_SNAPSHOT_RUN_ID || null;
};

const runId = parseRunId();
const galleryRoot = runId
  ? path.join(snapshotRoot, 'runs', runId)
  : path.join(snapshotRoot, 'latest');

const indexPath = path.join(galleryRoot, 'index.html');
const rootIndexPath = path.join(snapshotRoot, 'index.html');

const toPosix = (value) => value.split(path.sep).join('/');

const readManifest = (manifestPath) => {
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : null;
  } catch (error) {
    return null;
  }
};

const listSnapshots = (dirPath) => {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith('.png'))
    .sort()
    .map((entry) => ({
      key: entry.replace(/\.png$/, ''),
      file: toPosix(path.relative(galleryRoot, path.join(dirPath, entry))),
    }));
};

const projects = fs.existsSync(galleryRoot)
  ? fs
      .readdirSync(galleryRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  : [];

const sections = [];

for (const project of projects) {
  const projectPath = path.join(galleryRoot, project);
  const modes = fs
    .readdirSync(projectPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const modeSections = [];

  for (const mode of modes) {
    const modePath = path.join(projectPath, mode);
    const manifest = readManifest(path.join(modePath, 'manifest.json'));
    const entries = manifest?.length
      ? manifest.map((entry) => ({
          ...entry,
          file: entry.file
            ? toPosix(path.relative(galleryRoot, path.join(snapshotRoot, entry.file)))
            : entry.file,
        }))
      : listSnapshots(modePath);

    const cards = entries
      .map((entry) => {
        const label = entry.label || entry.key;
        const url = entry.url
          ? `<div class="meta"><a href="${entry.url}" target="_blank" rel="noreferrer">open</a></div>`
          : '';
        return `
        <figure class="card">
          <a href="${entry.file}" target="_blank" rel="noreferrer">
            <img src="${entry.file}" alt="${label}">
          </a>
          <figcaption>
            <div class="label">${label}</div>
            ${url}
          </figcaption>
        </figure>`;
      })
      .join('\n');

    modeSections.push(`
      <section class="mode">
        <h3>${mode}</h3>
        <div class="grid">${cards || '<p class="empty">No snapshots found.</p>'}</div>
      </section>`);
  }

  sections.push(`
    <section class="project">
      <h2>${project}</h2>
      ${modeSections.join('\n')}
    </section>`);
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>UI Snapshot Gallery</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 24px; color: #222; }
    h1 { margin-top: 0; }
    h2 { margin-top: 32px; }
    h3 { margin: 16px 0 8px; }
    .project { margin-bottom: 32px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
    .card { background: #fff; border-radius: 12px; overflow: hidden; border: 1px solid #ddd; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
    .card img { width: 100%; display: block; object-fit: cover; }
    .card figcaption { padding: 8px 12px; font-size: 13px; }
    .label { font-weight: 600; margin-bottom: 4px; }
    .meta a { color: #2b6cb0; text-decoration: none; font-size: 12px; }
    .empty { color: #777; font-size: 13px; }
  </style>
</head>
<body>
  <h1>UI Snapshot Gallery</h1>
  <p>Generated from Playwright screenshots in <code>${toPosix(galleryRoot)}</code>.</p>
  ${sections.length ? sections.join('\n') : '<p class="empty">No snapshots found.</p>'}
</body>
</html>`;

fs.mkdirSync(galleryRoot, { recursive: true });
fs.writeFileSync(indexPath, html, 'utf8');

if (!runId) {
  const redirectTarget = 'latest/index.html';
  const rootHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=${redirectTarget}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>UI Snapshot Gallery</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; }
    a { color: #2b6cb0; text-decoration: none; }
  </style>
</head>
<body>
  <h1>UI Snapshot Gallery</h1>
  <p>Latest gallery: <a href="${redirectTarget}">${redirectTarget}</a></p>
  <p>If you are not redirected automatically, open <a href="${redirectTarget}">${redirectTarget}</a>.</p>
</body>
</html>`;

  fs.writeFileSync(rootIndexPath, rootHtml, 'utf8');
}
console.log(`Snapshot gallery written to ${indexPath}`);
