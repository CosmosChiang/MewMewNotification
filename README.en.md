# MewMewNotification

[![CI/CD Pipeline](https://github.com/CosmosChiang/MewMewNotification/actions/workflows/ci.yml/badge.svg)](https://github.com/CosmosChiang/MewMewNotification/actions/workflows/ci.yml)
[![Test Coverage](https://codecov.io/gh/CosmosChiang/MewMewNotification/branch/main/graph/badge.svg)](https://codecov.io/gh/CosmosChiang/MewMewNotification)

![MewMewNotification Logo](icons/icon128.png)

MewMewNotification is a simple, multi-language Chrome extension that instantly notifies you of Redmine issue updates, with flexible notification management and project filtering features.

## Screenshots

Below are screenshots of the main MewMewNotification interfaces:

![Options Page](docs/images/options.png)
![Popup Window](docs/images/popup.png)

## Main Features

- Real-time Redmine issue updates with customizable check interval (1-60 minutes)
- Desktop notifications and sound alerts, never miss important info
- 30-second connection timeout protection to prevent hanging connections
- Secure API key storage in local extension storage only, without cross-device sync
- One-click mark all notifications as read or clear all notifications
- Multi-language interface (Traditional Chinese, Simplified Chinese, Japanese, English; easily extensible)
- Direct links to Redmine issue pages for quick tracking
- Project filter: show only issues assigned to you, or include watched issues
- Auto-detect issue updates with intelligent notification management
- Badge counter for unread notification count

## Installation & Setup

1. Install from Chrome Web Store or load unpacked extension manually.
2. Right-click the MewMewNotification icon in the browser toolbar and select "Options", or click the settings button in the popup window.
3. Enter your Redmine server URL and API Key in the settings page.
   - API Key can be found in your Redmine account settings page.
   - HTTPS is recommended; if you use HTTP, the extension will still connect but show a red insecure-connection warning.
4. Set notification check interval, max notification count, language, project filter, etc.
5. Save settings and click "Test Connection" to verify.
   - If you upgraded from an older release, save the Redmine settings again once so the extension can request the new per-origin host permission.

## Notification Management

- Supports "Mark all as read" and "Clear all notifications":
  - **Mark all as read**: Marks all notifications as read, keeps history for later review.
  - **Clear all notifications**: Deletes all notifications, clears the list, cannot be undone.
  - Both actions are one-click and update status instantly.
- Manual refresh supported
- Retry on notification failure and error prompts

## Multi-Language Support

- Built-in: Traditional Chinese, Simplified Chinese, Japanese, English
- Easily add new languages via [Multi-Language Support Guide](docs/LANGUAGE_GUIDE.md)
- Language menu auto-generated from manifest and _locales folder

## Developer Installation & Packaging

1. Download or fork this repository.
2. Run `npm install` in the project root (if package.json is present).
3. For development, load the extension as unpacked:
   - Go to chrome://extensions/
   - Enable "Developer mode"
   - Click "Load unpacked" and select the project folder
4. After making changes, simply refresh the extension.
5. To package for release:
    - Create a ZIP that only contains the files required to run the extension, such as `manifest.json`, the HTML files, `background.js`, `scripts/`, `styles/`, `icons/`, and `_locales/`
    - Upload to Chrome Web Store or distribute manually

## Testing & CI/CD

- `npm test`: run the full Jest suite and generate a coverage report
- `npm run test:local`: run the faster local test flow
- `npm run test:ci`: run the CI-aligned test suite
- `npm run test:coverage`: regenerate the coverage report
- `npm run audit:high`: fail on high / critical dependency vulnerabilities
- GitHub Actions runs multi-version Node.js tests, validation, and extension packaging for pushes to `main` and PRs targeting `main`
- GitHub Actions runs `npm run audit:high` in the Node.js `20.x` job to block high-severity dependency issues
- Pushing a `v*` tag creates a GitHub Release with the packaged ZIP attached
- See the [CI/CD Testing Guide](docs/CI_TESTING_GUIDE.md) for the full workflow details

## How to Contribute

1. Fork the repository and create a new branch.
2. Commit your changes (please include explanations and test cases if possible).
3. Submit a Pull Request describing your changes.
4. Maintainers will review and merge your contribution.

## FAQ

### Q: How do I get my API Key?

A: Log in to Redmine, click "My Account" in the top right, and find the API Key at the bottom of the page.

### Q: Why am I not receiving notifications?

A: Check that your Redmine URL and API Key are correct, and that the extension has host access for the configured Redmine origin. You can click "Test Connection" to verify your settings.
If you upgraded from an older release, open Options and save the Redmine settings again.

### Q: How do I only see issues assigned to me?

A: Enable "Show only issues assigned to me" in the Notifications tab of the settings page.

### Q: How do I include issues I'm watching?

A: Enable "Include issues I'm watching" in the Notifications tab of the settings page.

### Q: How do I add a new language?

A: See the [Multi-Language Support Guide](docs/LANGUAGE_GUIDE.md).

### Q: Why does connection timeout?

A: The extension has a 30-second connection timeout protection. If your Redmine server responds slowly, check your network connection or contact your administrator.

### Q: Is my API key secure?

A: Your API key is stored only in local extension storage and is not synced across devices. We implement multiple layers of security:

- Strict input validation and filtering
- XSS and injection attack protection
- Content Security Policy (CSP)
- Separate storage for sensitive credentials and synced preferences

### Q: How does the extension protect against security threats?

A: MewMewNotification implements comprehensive security measures:

- **XSS Protection**: Uses safe DOM operations and escapes all user input
- **Input Validation**: Strictly validates all URLs, API keys, and config parameters
- **API Security**: Whitelists accessible Redmine API endpoints
- **Transport Security**: Strongly recommends HTTPS and clearly warns when a server is configured over HTTP
- **Least Privilege**: Requests host access only for the configured Redmine origin
- **Secure Storage**: Sensitive data is stored in local extension storage only

## License

This project is licensed under the [MIT License](LICENSE).

© 2025 MewMewNotification
