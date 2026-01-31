import fs from 'node:fs';
import path from 'node:path';

const SNAPSHOT_ROOT = path.join(process.cwd(), 'test-results', 'ui-snapshots');
const OUTPUT_PATH = path.join(SNAPSHOT_ROOT, 'index.html');

const toPosix = (value) => value.split(path.sep).join('/');

const readManifestEntries = (dirPath) => {
  const manifestPath = path.join(dirPath, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (Array.isArray(data)) return data;
    } catch (error) {
      console.warn(`[gallery] Failed to read manifest: ${manifestPath}`);
    }
  }

  const pngFiles = fs
    .readdirSync(dirPath)
    .filter((entry) => entry.toLowerCase().endsWith('.png'))
    .sort();
  return pngFiles.map((file) => ({ key: path.basename(file, '.png'), file }));
};

const gatherSnapshots = () => {
  if (!fs.existsSync(SNAPSHOT_ROOT)) return [];

  return fs
    .readdirSync(SNAPSHOT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const projectName = entry.name;
      const projectDir = path.join(SNAPSHOT_ROOT, projectName);
      const modes = fs
        .readdirSync(projectDir, { withFileTypes: true })
        .filter((modeEntry) => modeEntry.isDirectory())
        .map((modeEntry) => {
          const modeName = modeEntry.name;
          const modeDir = path.join(projectDir, modeName);
          const manifest = readManifestEntries(modeDir);
          const images = manifest.map((item) => {
            const filePath = path.join(modeDir, item.file);
            return {
              ...item,
              src: toPosix(path.relative(SNAPSHOT_ROOT, filePath)),
            };
          });
          return { modeName, images };
        });

      return { projectName, modes };
    });
};

const buildHtml = (projects) => {
  const sections = projects
    .map((project) => {
      const modeSections = project.modes
        .map((mode) => {
          const cards = mode.images
            .map(
              (image) => `
              <a class="shot" href="${image.src}" target="_blank" rel="noopener">
                <img loading="lazy" src="${image.src}" alt="${image.key}">
                <span>${image.key}</span>
              </a>`
            )
            .join('');

          return `
          <section class="mode">
            <h3>${mode.modeName}</h3>
            <div class="grid">${cards || '<p class="empty">No snapshots found.</p>'}</div>
          </section>`;
        })
        .join('');

      return `
      <section class="project">
        <h2>${project.projectName}</h2>
        ${modeSections}
      </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>UI Snapshot Gallery</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        font-family: system-ui, sans-serif;
        margin: 24px;
        background: #0f1115;
        color: #f5f5f5;
      }
      h1, h2, h3 {
        margin: 0 0 12px;
      }
      .project {
        margin-bottom: 48px;
      }
      .mode {
        margin-bottom: 24px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 16px;
      }
      .shot {
        display: flex;
        flex-direction: column;
        gap: 8px;
        text-decoration: none;
        color: inherit;
        background: rgba(255, 255, 255, 0.04);
        padding: 12px;
        border-radius: 12px;
      }
      .shot img {
        width: 100%;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      .shot span {
        font-size: 13px;
        opacity: 0.8;
      }
      .empty {
        opacity: 0.7;
      }
      @media (prefers-color-scheme: light) {
        body {
          background: #f6f7fb;
          color: #111;
        }
        .shot {
          background: #fff;
        }
      }
    </style>
  </head>
  <body>
    <h1>UI Snapshot Gallery</h1>
    ${sections || '<p>No snapshots found.</p>'}
  </body>
</html>`;
};

const projects = gatherSnapshots();
const html = buildHtml(projects);

if (!fs.existsSync(SNAPSHOT_ROOT)) {
  fs.mkdirSync(SNAPSHOT_ROOT, { recursive: true });
}

fs.writeFileSync(OUTPUT_PATH, html);
console.log(`[gallery] Wrote ${OUTPUT_PATH}`);
