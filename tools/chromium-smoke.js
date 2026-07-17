const fs = require('node:fs');
const http = require('node:http');
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
  let server;
  try {
    server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><title>Redmine issue smoke target</title>');
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const issueUrl = `http://127.0.0.1:${server.address().port}/issues/123`;

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
    if (manifest.permissions?.includes('activeTab')) throw new Error('activeTab must not be packaged');
    if (manifest.permissions?.some(permission => ['downloads', 'clipboardRead', 'clipboardWrite'].includes(permission))) {
      throw new Error('Diagnostics must not add downloads or clipboard permissions');
    }

    const getDiagnostics = () => options.evaluate(() => chrome.runtime.sendMessage({
      action: 'getDiagnostics'
    }));
    const disabledDiagnostics = await getDiagnostics();
    if (
      disabledDiagnostics?.success !== true
      || disabledDiagnostics.diagnostics?.diagnostics?.enabled !== false
      || disabledDiagnostics.diagnostics?.events?.length !== 0
    ) {
      throw new Error('Disabled diagnostic snapshot smoke failed');
    }
    await options.evaluate(() => chrome.storage.local.set({ diagnosticsEnabledV1: true }));
    await options.waitForFunction(async () => {
      const response = await chrome.runtime.sendMessage({ action: 'getDiagnostics' });
      return response?.success === true && response.diagnostics?.diagnostics?.enabled === true;
    });
    const enabledDiagnostics = await getDiagnostics();
    if (enabledDiagnostics?.diagnostics?.diagnostics?.enabled !== true) {
      throw new Error('Enabled diagnostic snapshot smoke failed');
    }

    const openIssueFrom = async pageOrWorker => {
      const openedPagePromise = context.waitForEvent('page', { timeout: 10000 });
      await pageOrWorker.evaluate(url => chrome.tabs.create({ url }), issueUrl);
      const openedPage = await openedPagePromise;
      await openedPage.waitForLoadState('domcontentloaded');
      if (openedPage.url() !== issueUrl) {
        throw new Error(`Unexpected issue tab URL: ${openedPage.url()}`);
      }
      await openedPage.close();
    };

    await openIssueFrom(popup);
    await openIssueFrom(worker);
    process.stdout.write(`Chromium smoke OK: ${extensionId}; options/popup loaded; diagnostics disabled/enabled snapshots passed; popup/desktop issue tabs opened without activeTab\n`);
  } finally {
    await context?.close();
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
