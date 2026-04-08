#!/usr/bin/env node
/**
 * Post-install script: sync steering files to AI tool config directories.
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const steeringDir = join(__dirname, '..', 'steering');

if (!existsSync(steeringDir)) process.exit(0);

const files = readdirSync(steeringDir).filter(f => f.endsWith('.md'));
if (files.length === 0) process.exit(0);

const targets = [
  { dir: join(homedir(), '.kiro', 'steering'), name: 'Kiro (global)' },
  { file: join(homedir(), '.cursorrules'), name: 'Cursor (global)', single: true },
];

let synced = 0;
for (const target of targets) {
  try {
    if (target.single) {
      // Single file targets: append/overwrite
      const content = files.map(f => readFileSync(join(steeringDir, f), 'utf-8')).join('\n\n');
      writeFileSync(target.file, content);
      synced++;
      console.error(`[kyuubi-mcp] ✅ Synced steering to ${target.name}: ${target.file}`);
    } else {
      // Directory targets: copy each file
      mkdirSync(target.dir, { recursive: true });
      for (const file of files) {
        copyFileSync(join(steeringDir, file), join(target.dir, file));
        synced++;
      }
      console.error(`[kyuubi-mcp] ✅ Synced steering to ${target.name}: ${target.dir}`);
    }
  } catch {
    // skip if no permission
  }
}

if (synced > 0) {
  console.error(`[kyuubi-mcp] ${files.length} steering file(s) synced.`);
}
