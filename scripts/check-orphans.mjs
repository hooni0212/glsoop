#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = [
  'public',
  'routes',
  'utils',
  'middleware',
  'services',
  'scripts',
  'tests',
];
const SCAN_FILES = ['server.js', 'playwright.config.js'];

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'tmp',
  'playwright-report',
  'test-results',
]);

function toPosix(value) {
  return value.split(path.sep).join('/');
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function walk(dirPath, exts, output = []) {
  if (!(await exists(dirPath))) return output;

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walk(absolutePath, exts, output);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (exts.has(extension)) {
      output.push(absolutePath);
    }
  }

  return output;
}

async function loadScanSources() {
  const extSet = new Set(['.js', '.mjs', '.cjs', '.html', '.css']);
  const files = [];

  for (const relative of SCAN_DIRS) {
    const absolute = path.join(ROOT, relative);
    await walk(absolute, extSet, files);
  }

  for (const relative of SCAN_FILES) {
    const absolute = path.join(ROOT, relative);
    if (await exists(absolute)) files.push(absolute);
  }

  const textByFile = new Map();
  await Promise.all(
    files.map(async (absolutePath) => {
      try {
        const text = await fs.readFile(absolutePath, 'utf8');
        textByFile.set(toPosix(path.relative(ROOT, absolutePath)), text);
      } catch (_error) {
        // ignore unreadable files
      }
    })
  );

  return textByFile;
}

function hasReference(targetRelativePath, patterns, textByFile) {
  for (const [relativePath, text] of textByFile.entries()) {
    if (relativePath === targetRelativePath) continue;
    if (patterns.some((pattern) => pattern && text.includes(pattern))) {
      return true;
    }
  }
  return false;
}

function makeClientJsPatterns(relativePath) {
  const relFromPublicJs = relativePath.replace(/^public\/js\//, '');
  const base = path.posix.basename(relFromPublicJs);

  return [
    `/js/${relFromPublicJs}`,
    `js/${relFromPublicJs}`,
    `./${base}`,
    `../${base}`,
  ];
}

function makeClientCssPatterns(relativePath) {
  const relFromPublicCss = relativePath.replace(/^public\/css\//, '');
  const base = path.posix.basename(relFromPublicCss);

  return [
    `/css/${relFromPublicCss}`,
    `css/${relFromPublicCss}`,
    `./${base}`,
    `../${base}`,
  ];
}

function makeServerModulePatterns(relativePath) {
  const noExt = relativePath.replace(/\.js$/, '');
  return [
    `'./${noExt}'`,
    `"./${noExt}"`,
    `'../${noExt}'`,
    `"../${noExt}"`,
    `'${noExt}'`,
    `"${noExt}"`,
  ];
}

async function collectFiles(relativeDir, exts) {
  const absolute = path.join(ROOT, relativeDir);
  const paths = await walk(absolute, new Set(exts));
  return paths.map((absolutePath) => toPosix(path.relative(ROOT, absolutePath))).sort();
}

function listOrphans(files, textByFile, patternFactory) {
  return files.filter((relativePath) => {
    const patterns = patternFactory(relativePath);
    return !hasReference(relativePath, patterns, textByFile);
  });
}

function collectDuplicateBasenames(files) {
  const map = new Map();

  for (const relativePath of files) {
    const base = path.posix.basename(relativePath);
    const bucket = map.get(base) || [];
    bucket.push(relativePath);
    map.set(base, bucket);
  }

  return Array.from(map.entries())
    .filter(([, matches]) => matches.length > 1)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, matches]) => ({ name, matches }));
}

function printSection(title, items) {
  console.log(`\n[${title}]`);
  if (!items.length) {
    console.log('- none');
    return;
  }
  items.forEach((item) => console.log(`- ${item}`));
}

async function main() {
  const textByFile = await loadScanSources();

  const clientJsFiles = await collectFiles('public/js', ['.js']);
  const clientCssFiles = await collectFiles('public/css', ['.css']);
  const serverModuleFiles = (
    await Promise.all([
      collectFiles('routes', ['.js']),
      collectFiles('utils', ['.js']),
      collectFiles('middleware', ['.js']),
      collectFiles('services', ['.js']),
    ])
  ).flat();

  const orphanClientJs = listOrphans(clientJsFiles, textByFile, makeClientJsPatterns);
  const orphanClientCss = listOrphans(clientCssFiles, textByFile, makeClientCssPatterns);
  const orphanServerModules = listOrphans(serverModuleFiles, textByFile, makeServerModulePatterns);

  const duplicateBasenames = collectDuplicateBasenames([
    ...clientJsFiles,
    ...serverModuleFiles,
  ]);

  console.log('glsoop orphan/duplicate check (heuristic)');
  console.log(`- scanned text files: ${textByFile.size}`);
  console.log(`- client js files: ${clientJsFiles.length}`);
  console.log(`- client css files: ${clientCssFiles.length}`);
  console.log(`- server modules: ${serverModuleFiles.length}`);

  printSection('Orphan Candidate: public/js', orphanClientJs);
  printSection('Orphan Candidate: public/css', orphanClientCss);
  printSection('Orphan Candidate: server modules', orphanServerModules);

  console.log('\n[Duplicate Basenames]');
  if (!duplicateBasenames.length) {
    console.log('- none');
  } else {
    duplicateBasenames.forEach((entry) => {
      console.log(`- ${entry.name}`);
      entry.matches.forEach((match) => console.log(`  - ${match}`));
    });
  }

  const totalOrphans = orphanClientJs.length + orphanClientCss.length + orphanServerModules.length;
  console.log(`\nsummary: orphan candidates=${totalOrphans}, duplicate basename groups=${duplicateBasenames.length}`);
}

main().catch((error) => {
  console.error('[check-orphans] failed:', error);
  process.exitCode = 1;
});
