/**
 * Trilium-authored editor strings, and the bridge that gets them translated.
 *
 * Plugins localize with CKEditor's own `editor.t`, passing the English text itself as the message
 * id — no host configuration, no translation keys in plugin code. When nothing supplies a
 * dictionary (a test, a standalone editor), the message id is what gets rendered, so the UI is
 * always correct English rather than a raw key.
 *
 * To actually translate those strings, the host builds a message dictionary and `i18n.ts` appends
 * it to the editor's `translations` config. The i18next key is *derived* from the English text by
 * {@link slugify}, so there is no message-id-to-key mapping to maintain, and there is no list of
 * messages either: the English catalog under `text-editor.ck` **is** the registry, and
 * {@link buildMessageDictionary} turns it into the dictionary CKEditor wants. Adding a string means
 * writing it at the call site and adding its English entry — nothing else, and the client's
 * `i18n.spec.ts` fails if the entry is missing, because it gathers the translation calls from this
 * package's source.
 *
 * The same mechanism can reword CKEditor's own strings: an entry whose English text matches an
 * upstream message id overrides the built-in translation for every locale, because our dictionary
 * is merged after the core one.
 */

/** Prefix for the i18next keys this package's messages resolve to. */
export const MESSAGE_KEY_PREFIX = "text-editor.ck.";

/**
 * Derive the i18next key for a message id: lowercase, with every run of non-alphanumeric
 * characters collapsed into a single dash. Punctuation that would otherwise be significant in an
 * i18next key (`.` separates key paths) or awkward in a catalog (`"`, `%0`) disappears, so message
 * ids can be written as natural English.
 *
 * `"Insert a table."` becomes `text-editor.ck.insert-a-table`.
 */
export function slugify(message: string): string {
    return message
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        // The collapse above leaves at most one dash at each end, so trimming a single one is
        // enough — and matching `-+$` instead would rescan the whole string from every position.
        .replace(/^-|-$/g, "");
}

/**
 * CKEditor's own strings that Trilium renames, mapping the upstream message id to the English
 * wording we show instead. Trilium calls CKEditor's bookmarks "anchors", so every string the
 * upstream `Bookmark` plugin renders is relabelled here.
 *
 * This is the one case where a message id and its English text differ, which is why the pairs are
 * declared rather than discovered: the dictionary has to be keyed by the *upstream* id for CKEditor
 * to find it, while the text shown comes from our catalog entry for the replacement. Both halves of
 * a pair therefore live here, and the replacement needs its own English entry like any other
 * message — which is what makes the rename translatable per locale instead of English-only.
 *
 * A plugin Trilium owns never belongs here: rename its message id at the call site instead.
 */
export const MESSAGE_OVERRIDES: Record<string, string> = {
    "Bookmark": "Anchor",
    "Bookmarks": "Anchors",
    "Bookmark name": "Anchor name",
    "Bookmark must not be empty.": "Anchor name must not be empty.",
    "Bookmark name already exists.": "Anchor name already exists.",
    "Bookmark name cannot contain space characters.": "Anchor name cannot contain space characters.",
    "Edit bookmark": "Edit anchor",
    "Remove bookmark": "Remove anchor",
    "Enter the bookmark name without spaces.": "Enter the anchor name without spaces.",
    "Bookmark toolbar": "Anchor toolbar",
    "bookmark widget": "anchor widget",
    "No bookmarks available.": "No anchors available.",
    "Scroll to bookmark": "Scroll to anchor"
};

/**
 * Build the CKEditor dictionary from the host's English catalog and translator.
 *
 * @param englishMessages the `text-editor.ck` section of the English catalog, mapping each derived
 *                        key to the English text — which is the message id plugins pass to the
 *                        editor's translation function.
 * @param translate resolves a full i18next key to the localized string.
 */
export function buildMessageDictionary(
    englishMessages: Record<string, string>,
    translate: (key: string) => string
): Record<string, string> {
    const dictionary: Record<string, string> = {};

    for (const [ derivedKey, message ] of Object.entries(englishMessages)) {
        const key = MESSAGE_KEY_PREFIX + derivedKey;
        const translated = translate(key);
        // i18next echoes the key back for a missing entry; that would render `text-editor.ck.…` at
        // the user, where falling back to the message id renders correct English.
        if (translated && translated !== key) {
            dictionary[message] = translated;
        }
    }

    // Renames are applied last, so an upstream id resolves to our wording rather than CKEditor's.
    // Unlike a translation, a rename applies even when the locale has no entry: the English
    // replacement is itself the point, so it stands in until a translator supplies the rest.
    for (const [ upstreamMessage, replacement ] of Object.entries(MESSAGE_OVERRIDES)) {
        dictionary[upstreamMessage] = dictionary[replacement] ?? replacement;
    }

    return dictionary;
}

/**
 * Translate a single message id outside an editor, for code that builds editor content before an
 * editor exists — the slash-command definitions, for instance. Inside a plugin use the editor's own
 * translation function instead; this is the same lookup, minus the editor.
 *
 * Falls back to the message id, which is the English text, so a missing entry renders English
 * rather than a raw key.
 *
 * @param values substituted for the `%0`, `%1`, … placeholders, as {@link interpolate} describes.
 */
export function translateMessage(
    translate: (key: string) => string,
    message: string,
    values: readonly string[] = []
): string {
    const key = MESSAGE_KEY_PREFIX + slugify(message);
    const translated = translate(key);
    return interpolate(translated && translated !== key ? translated : message, values);
}

/**
 * Substitute `%0`, `%1`, … in a translated message, which is how CKEditor's own translation function
 * interpolates. A message therefore reads the same whether it was translated by the editor or by
 * {@link translateMessage}, and translators see one placeholder convention.
 *
 * A placeholder with no corresponding value is left as written, rather than blanked.
 */
function interpolate(message: string, values: readonly string[]): string {
    return message.replace(/%(\d+)/g, (placeholder, index) => values[Number(index)] ?? placeholder);
}
