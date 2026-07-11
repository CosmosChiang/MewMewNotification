const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const AdmZip = require('adm-zip');

(async () => {
  const root = path.resolve(__dirname, '..');
  const zipPath = path.join(root, 'dist', 'mewmew-notification-extension.zip');
  if (!fs.existsSync(zipPath)) throw new Error('Run npm run package before the Chromium smoke test');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mewmew-smoke-'));
  const extensionPath = path.join(temp, 'extension');
  const profilePath = path.join(temp, 'profile');
  fs.mkdirSync(extensionPath);
  new AdmZip(zipPath).extractAllTo(extensionPath, true);
  let context;
  try {
    context = await chromium.launchPersistentContext(profilePath, {
      headless: true,
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = new URL(worker.url()).host;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.waitForSelector('#redmineUrl');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForSelector('#notificationsList', { state: 'attached' });
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));
    if (!manifest.optional_host_permissions?.includes('https://*/*')) throw new Error('Optional Redmine host permission is missing');
    process.stdout.write(`Chromium smoke OK: ${extensionId}; options/popup loaded; permissions validated\n`);
  } finally {
    await context?.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
