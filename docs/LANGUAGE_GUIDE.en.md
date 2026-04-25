# Multi-Language Support Guide

> This project supports a multi-language interface and can be easily extended as needed. All language files follow the Chrome extension standard format, and the language menu is generated dynamically.

## Steps to Add a New Language

### Create the Language File

Create a new folder and file at `_locales/{language_code}/messages.json`, for example:

```text
_locales/
├── en/
├── zh_TW/
├── zh_CN/
├── ja/
└── {new_language_code}/
    └── messages.json
```

### Copy and Translate Content

Copy the contents of `en/messages.json` to the new language file, and translate all `message` fields to the target language.

### Update the Language Menu

Add a new option to the `<select id="languageSelect">` in `options.html`:

```html
<option value="{new_language_code}">{language_display_name}</option>
```

### Add Language Name Translation

Add the new language name translation to all language files:

```json
"language_{new_language_code}": {
  "message": "{localized_language_name}",
  "description": "{language_name} language option"
}
```

### Automatic Handling by Script

`options.js` will automatically:

- Scan the `_locales` directory and dynamically generate the language menu
- Display the corresponding language name based on the current language
- Show the original name if translation is missing

## Example: Add French (fr) Support

1. Create `_locales/fr/messages.json`
2. Copy and translate `en/messages.json`
3. Add to the language menu:

   ```html
   <option value="fr">Français</option>
   ```

4. Add to all language files:

   ```json
   "language_fr": {
     "message": "Français",
     "description": "French language option"
   }
   ```

## Advanced: Programmatically Add Languages

Use `OptionsManager.addLanguageOption('fr', 'Français')` to dynamically add a language option. It will automatically check for duplicates and sort the menu.

## Notes

- **Language Code**: Use standard language/region codes (e.g., `en`, `zh_TW`, `fr-CA`)
- **Manifest**: `default_locale` in `manifest.json` must be correct
- **Completeness**: Each language file must contain all translation keys
- **Testing**: Fully test the interface and features after adding a new language

## Maintenance Tips

- Regularly check for new translation keys and sync to all languages
- Use automation tools to compare language file structures
- Use a JSON linter or translation tool to validate format

## Latest Features & Multi-Language Support

- Built-in: Traditional Chinese, Simplified Chinese, Japanese, English
- Project filter (show only issues assigned to me)
- Include watched issues option
- 30-second connection timeout protection
- Secure API key storage
- Language menu and names can be managed automatically

### Example Translation for Project Filter

```json
"onlyMyProjects": {
  "message": "只顯示分配給我的議題",    // zh_TW
  "message": "只显示分配给我的问题",    // zh_CN
  "message": "自分に割り当てられた課題のみ表示", // ja
  "message": "Only show issues assigned to me", // en
  "description": "Only my projects filter option"
}
```

## Tips

- The language menu is auto-generated from manifest and _locales structure, no need to manually maintain the list
- After adding a new language, test thoroughly in each language environment
- For new features, update all language files accordingly
