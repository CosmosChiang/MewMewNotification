# MewMewNotification

![MewMewNotification Logo](icons/icon128.png)

MewMewNotification is a simple, multi-language Chrome extension that instantly notifies you of Redmine issue updates, with flexible notification management and project filtering features.

---

## Screenshots

Below are screenshots of the main MewMewNotification interfaces:

![Options Page](docs/images/options.png)
![Popup Window](docs/images/popup.png)

---

## 🚀 Main Features

- Real-time Redmine issue updates with customizable check interval (1-60 minutes)
- Desktop notifications and sound alerts, never miss important info
- 30-second connection timeout protection to prevent hanging connections
- Secure API key storage in browser's sync storage
- One-click mark all notifications as read or clear all notifications
- Multi-language interface (Traditional Chinese, Simplified Chinese, Japanese, English; easily extensible)
- Direct links to Redmine issue pages for quick tracking
- Project filter: show only issues assigned to you, or include watched issues
- Auto-detect issue updates with intelligent notification management
- Badge counter for unread notification count

---

## 🛠 Installation & Setup

1. Install from Chrome Web Store or load unpacked extension manually.
2. Right-click the MewMewNotification icon in the browser toolbar and select "Options", or click the settings button in the popup window.
3. Enter your Redmine server URL and API Key in the settings page.
   - API Key can be found in your Redmine account settings page.
4. Set notification check interval, max notification count, language, project filter, etc.
5. Save settings and click "Test Connection" to verify.

---

## 🔔 Notification Management

- Supports "Mark all as read" and "Clear all notifications":
  - **Mark all as read**: Marks all notifications as read, keeps history for later review.
  - **Clear all notifications**: Deletes all notifications, clears the list, cannot be undone.
  - Both actions are one-click and update status instantly.
- Manual refresh supported
- Retry on notification failure and error prompts

---

## 🌐 Multi-Language Support

- Built-in: Traditional Chinese, Simplified Chinese, Japanese, English
- Easily add new languages via [Multi-Language Support Guide](docs/LANGUAGE_GUIDE.md)
- Language menu auto-generated from manifest and _locales folder

---

## 🧑‍💻 Developer Installation & Packaging

1. Download or fork this repository.
2. Run `npm install` in the project root (if package.json is present).
3. For development, load the extension as unpacked:
   - Go to chrome://extensions/
   - Enable "Developer mode"
   - Click "Load unpacked" and select the project folder
4. After making changes, simply refresh the extension.
5. To package for release:
   - Zip the project folder
   - Upload to Chrome Web Store or distribute manually

---

## 🤝 How to Contribute

1. Fork the repository and create a new branch.
2. Commit your changes (please include explanations and test cases if possible).
3. Submit a Pull Request describing your changes.
4. Maintainers will review and merge your contribution.

---

## ❓ FAQ

### Q: How do I get my API Key?

A: Log in to Redmine, click "My Account" in the top right, and find the API Key at the bottom of the page.

### Q: Why am I not receiving notifications?

A: Check that your Redmine URL and API Key are correct, and that your browser allows notifications for this extension. You can click "Test Connection" to verify your settings.

### Q: How do I only see issues assigned to me?

A: Enable "Show only issues assigned to me" in the Notifications tab of the settings page.

### Q: How do I include issues I'm watching?

A: Enable "Include issues I'm watching" in the Notifications tab of the settings page.

### Q: How do I add a new language?

A: See the [Multi-Language Support Guide](docs/LANGUAGE_GUIDE.md).

### Q: Why does connection timeout?

A: The extension has a 30-second connection timeout protection. If your Redmine server responds slowly, check your network connection or contact your administrator.

### Q: Is my API key secure?

A: Yes, your API key is stored securely in your browser's sync storage and supports cross-device sync. We implement multiple layers of security:

- Strict input validation and filtering
- XSS and injection attack protection
- Content Security Policy (CSP)
- Secure storage in browser's sync storage

### Q: How does the extension protect against security threats?

A: MewMewNotification implements comprehensive security measures:

- **XSS Protection**: Uses safe DOM operations and escapes all user input
- **Input Validation**: Strictly validates all URLs, API keys, and config parameters
- **API Security**: Whitelists accessible Redmine API endpoints
- **Transport Security**: Strongly recommends HTTPS, rejects unsafe connections in production
- **Secure Storage**: Sensitive data is stored securely in browser's sync storage

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

© 2025 MewMewNotification
