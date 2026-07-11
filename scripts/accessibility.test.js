const fs = require('node:fs');
const path = require('node:path');

describe('locale and accessibility contracts', () => {
  test('all locale files have identical message keys', () => {
    const localeRoot = path.join(__dirname, '..', '_locales');
    const locales = fs.readdirSync(localeRoot);
    const keySets = locales.map(locale => Object.keys(JSON.parse(
      fs.readFileSync(path.join(localeRoot, locale, 'messages.json'), 'utf8')
    )).sort());
    keySets.slice(1).forEach(keys => expect(keys).toEqual(keySets[0]));
  });

  test('popup and options expose complete tab and live-region semantics', () => {
    const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
    const options = fs.readFileSync(path.join(__dirname, '..', 'options.html'), 'utf8');
    expect(popup).toContain('id="syncHealthStatus"');
    expect(popup).toContain('aria-live="polite"');
    expect(popup.match(/role="tab"/g)).toHaveLength(3);
    expect(popup.match(/aria-controls="notificationsPanel"/g)).toHaveLength(3);
    expect(options.match(/role="tab"/g)).toHaveLength(4);
    expect(options.match(/role="tabpanel"/g)).toHaveLength(4);
  });

  test('popup and options styles honor reduced motion', () => {
    for (const file of ['popup.css', 'options.css']) {
      const css = fs.readFileSync(path.join(__dirname, '..', 'styles', file), 'utf8');
      expect(css).toContain('@media (prefers-reduced-motion: reduce)');
      expect(css).toContain('animation-duration: 0.01ms');
    }
  });

  test('fixed-height notification virtualization has been removed', () => {
    const source = fs.readFileSync(path.join(__dirname, 'popup.js'), 'utf8');
    expect(source).not.toContain('virtualScrollConfig');
    expect(source).not.toContain("addEventListener('scroll'");
  });
});
