import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const dbPath = process.env.DB_PATH
  ? path.resolve(repoRoot, process.env.DB_PATH)
  : path.join(repoRoot, 'tmp', 'e2e_playwright.sqlite');
const seedReadyFile = path.join(path.dirname(dbPath), '.ui-snapshots-seed-ready');

const ensureDir = (target) => {
  fs.mkdirSync(target, { recursive: true });
};

ensureDir(path.dirname(dbPath));
ensureDir(path.join(repoRoot, 'tmp'));

try {
  fs.rmSync(seedReadyFile, { force: true });
} catch (error) {
  // no-op: stale seed marker cleanup is best effort
}
