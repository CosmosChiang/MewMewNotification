#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const workflowPath = path.join(__dirname, '.github', 'workflows', 'ci.yml');
const content = fs.readFileSync(workflowPath, 'utf8');
const workflow = yaml.load(content, { schema: yaml.JSON_SCHEMA });
const fail = message => { throw new Error(message); };

if (!workflow?.name || !workflow.on || !workflow.jobs) fail('Workflow requires name, triggers, and jobs');
for (const name of ['quality', 'integration', 'package', 'release']) {
  if (!workflow.jobs[name]?.steps?.length) fail(`Missing workflow job or steps: ${name}`);
}
const matrix = workflow.jobs.quality.strategy?.matrix?.['node-version'] || [];
if (!matrix.includes('22.x') || !matrix.includes('24.x') || matrix.some(version => /^1[8-9]|^20/.test(String(version)))) {
  fail(`Unsupported Node matrix: ${matrix.join(',')}`);
}
const mutableUses = [...content.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)]
  .map(match => match[1]).filter(reference => !/@[a-f0-9]{40}$/.test(reference));
if (mutableUses.length) fail(`Mutable GitHub Actions references: ${mutableUses.join(', ')}`);
if (workflow.permissions?.contents !== 'read') fail('Top-level permissions must remain contents: read');
if (workflow.jobs.release.permissions?.contents !== 'write') fail('Release contents: write must be job-scoped');
const requiredCommands = [
  'npm run lint', 'npm run locale:check', 'npm run test:ci', 'npm run test:integration',
  'npm run test:smoke', 'npm run audit:high', 'npm run openspec:check',
  'npm run package:validate', 'npm run version:check'
];
for (const command of requiredCommands) if (!content.includes(command)) fail(`Missing CI gate: ${command}`);
process.stdout.write(`Workflow policy OK: ${Object.keys(workflow.jobs).join(', ')}; Node ${matrix.join('/')}\n`);
