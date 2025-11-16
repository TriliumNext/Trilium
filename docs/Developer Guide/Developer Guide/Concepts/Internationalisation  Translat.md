# Internationalisation / Translations
During the initial development of Trilium Notes, internationalisation was not considered as it was meant to be an English-only product.

As the application and the user base grows, it makes sense to be able to reach out as many people as possible by providing translations in their native language.

The library used is [i18next](https://www.i18next.com/).

## Where are the translations?

The translations are formatted as JSON files and they are located in `src/public/translations`. For every supported locale, there is a subdirectory in which there is a `translation.json` file (e.g. `src/public/translations/en/translation.json`).

### Message keys

One important aspect is the fact that we are using a key-based approach. This means that each message is identified by an ID rather than a natural-language message (such as the default approach in gettext).

The key-based approach allows a hierarchical structure. For example, a key of `about.title` would be added in `translation.json` as follows:

```json
{
	"about": {
		"title": "About Trilium Notes"
	}
} 
```

Follow the <a class="reference-link" href="Internationalisation%20%20Translations/Guidelines.md">Guidelines</a> when creating a new message.

### Adding a new locale

See <a class="reference-link" href="Internationalisation%20%20Translations/Adding%20a%20new%20locale.md">Adding a new locale</a>.

### Changing the language

Since the internationalisation process is in its early stages, there is no user-facing way to switch the language.

To change the language manually, edit `src/public/app/services/i18n.js` and look for the line containing `lng: "en"`. Replace `en` with the desired language code (from the ones available in `src/public/translations`).

## Client-side translations

### Component-level translations

Most of the client translations are present in the various widgets and layouts.

Translation support has to be added manually for every file.

The first step is to add the translation import with a relative import. For example, if we are in the `src/public/app/widgets/dialogs` directory, the import would look as follows:

```javascript
import { t } from "../../services/i18n.js";
```

Afterwards, simply replace the hard-coded message with:

```javascript
${t("msgid")}
```

where `msgid` is the key of the message being translated.

### Variables

In the translation, enclose the variables with `{{` and `}}`:

```
{
    "key": "{{what}} is {{how}}"
}
```

Then pass the arguments when reading the translation:

```
t('key', { what: 'i18next', how: 'great' })
```

### Template-level translations

Templates are `.ejs` files present in `src/views`, these are used to prepare the root layout for desktop, mobile applications as well as setup (onboarding) and the shared notes view.

Due to using a different approach, it is not possible yet to translate those files.

## Server-side translations

Currently the server-side messages are not translatable. They will be added as a separate step.

## Locale/language selection

The language is stored as an option which is synchronized across all devices and the user is able to adjust it via Options → Appearance → Locale.

The options shown to the user are currently hard-coded in `src/routes/api/options.ts`, where there is a `getSupportedLocales()` function. The `id` field must match the corresponding directory in `src/public/translations` and the `name` must be the localized name of the language (so the name must be in that language, not in English).