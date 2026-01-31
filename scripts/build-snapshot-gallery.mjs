import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const snapshotRoot = path.join(repoRoot, 'test-results', 'ui-snapshots');
const indexPath = path.join(snapshotRoot, 'index.html');

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
      file: toPosix(path.relative(snapshotRoot, path.join(dirPath, entry))),
    }));
};

const projects = fs.existsSync(snapshotRoot)
  ? fs
      .readdirSync(snapshotRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  : [];

const sections = [];

for (const project of projects) {
  const projectPath = path.join(snapshotRoot, project);
  const modes = fs
    .readdirSync(projectPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const modeSections = [];

  for (const mode of modes) {
    const modePath = path.join(projectPath, mode);
    const manifest = readManifest(path.join(modePath, 'manifest.json'));
    const entries = manifest?.length ? manifest : listSnapshots(modePath);

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
  <p>Generated from Playwright screenshots in <code>test-results/ui-snapshots</code>.</p>
  ${sections.length ? sections.join('\n') : '<p class="empty">No snapshots found.</p>'}
</body>
</html>`;

fs.mkdirSync(snapshotRoot, { recursive: true });
fs.writeFileSync(indexPath, html, 'utf8');
console.log(`Snapshot gallery written to ${indexPath}`);
