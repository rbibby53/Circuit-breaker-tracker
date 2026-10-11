#!/usr/bin/env node
// Prepare a release: `pnpm release patch|minor|major|<version>`.
// Sets the version in every package.json and moves the Unreleased notes in CHANGELOG.md under a
// heading for it. Merging that to main releases it (see "Releasing" in CONTRIBUTING.md).

import { readFileSync, writeFileSync } from 'node:fs';

const PACKAGES = ['package.json', 'apps/server/package.json', 'apps/web/package.json', 'packages/core/package.json'];
const CHANGELOG = 'CHANGELOG.md';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

/** The next version after `current` for a bump, or an exact version given in full. */
function nextVersion(current, bump) {
  const m = SEMVER.exec(current);
  if (!m) fail(`package.json has version "${current}", which is not x.y.z`);
  const [major, minor, patch] = m.slice(1, 4).map(Number);
  const pre = Boolean(m[4]);
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      // 1.1.0-rc.1 → 1.1.0: finishing a pre-release.
      return pre ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`;
    default:
      if (!SEMVER.test(bump ?? '')) fail('usage: pnpm release patch|minor|major|<version, e.g. 1.2.0>');
      return bump;
  }
}

/** Move the notes under "## Unreleased" to a new "## <version> — <date>" section below it. */
function moveUnreleased(changelog, version, date) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Unreleased');
  if (start === -1) fail(`${CHANGELOG} has no "## Unreleased" heading`);
  if (lines.some((l) => l === `## ${version}` || l.startsWith(`## ${version} `))) {
    fail(`${CHANGELOG} already has a section for ${version}`);
  }
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end === -1) end = lines.length;
  const notes = lines.slice(start + 1, end);
  if (!notes.some((l) => l.trim())) fail(`nothing under "## Unreleased" in ${CHANGELOG}: add the notes first`);
  while (notes.length && !notes[0].trim()) notes.shift();
  while (notes.length && !notes[notes.length - 1].trim()) notes.pop();
  return [
    ...lines.slice(0, start + 1),
    '',
    `## ${version} — ${date}`,
    '',
    ...notes,
    ...(end < lines.length ? [''] : []),
    ...lines.slice(end),
  ].join('\n');
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const current = JSON.parse(readFileSync(PACKAGES[0], 'utf8')).version;
const version = nextVersion(current, process.argv[2]);
if (version === current) fail(`already at ${version}`);

writeFileSync(CHANGELOG, moveUnreleased(readFileSync(CHANGELOG, 'utf8'), version, today()));
for (const file of PACKAGES) {
  const text = readFileSync(file, 'utf8');
  // Edit the field in place so the rest of the file keeps its order and formatting.
  const updated = text.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
  if (updated === text && !text.includes(`"version": "${version}"`)) fail(`no "version" field in ${file}`);
  writeFileSync(file, updated);
}

console.log(`Version ${current} → ${version}. Changed: ${[CHANGELOG, ...PACKAGES].join(', ')}.`);
console.log(`Open a pull request with these changes; merging it to main releases v${version}.`);
