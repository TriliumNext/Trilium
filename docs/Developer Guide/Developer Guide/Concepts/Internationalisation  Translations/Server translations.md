# Server translations
*   Server-side translations are managed by the same library as the client, i18next.
*   The translation files reside in the `/translations` directory, following the same convention as the client (`translations/{{lng}}/{{ns}}.json`), where the namespace is `server.json`. So for the Spanish translations we have `translations/es/server.json`.
*   Loading of translations is managed by [i18next-fs-backend](https://github.com/i18next/i18next-fs-backend) which loads the translations directly from the file system (unlike HTTP requests like the client), at the path mentioned previously (relative to `package.json`).

## How to translate a string

Unlike the client which uses a dedicated client service, the i18next library on the server is used directly, as such:

```javascript
import { t } from "i18next";

const translatedString = t("message.id");
```

## What should be translated

*   Avoid translating server-side logs, as those are supposed to be for debugging and as such there is no benefit in translating them.
*   Translate any user-facing message that comes from the server, such as error messages shown in the Electron application, or information such as keyboard shortcuts, note titles, etc.