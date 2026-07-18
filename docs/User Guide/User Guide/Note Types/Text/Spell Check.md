# Spell Check
Trilium supports spell checking for your notes. How it works depends on whether you're using the **desktop application** (Electron) or accessing Trilium through a **web browser**.

## Desktop

The desktop app uses Chromium's built-in spellchecker. You can configure it from _Options_ → _Spell Check_.

### Enabling spell check

Toggle _Check spelling_ to enable or disable the spellchecker. A restart is required for changes to take effect — use the restart button at the bottom of the section.

### Choosing languages

When spell check is enabled, a _Spell Check Languages_ section appears listing all languages available on your system. Select one or more languages by checking the boxes. The spellchecker will accept words that are valid in _any_ of the selected languages.

The available languages depend on your operating system's installed language packs. For example, on Windows you can add languages through _Options_ → _Time & Language_ → _Language & Region_ → _Add a language_.

> [!NOTE]
> The changes take effect only after restarting the application.

### Custom dictionary

> [!TIP]
> This function is available starting with Trilium v0.103.0.

Words you add to the dictionary (e.g. via the right-click context menu → "Add to dictionary") are stored in a **synced note** inside Trilium. This means your custom dictionary automatically syncs across all your devices.

You can view and edit the dictionary directly from _Settings_ → _Spell Check_ → _Custom Dictionary_ → _Edit dictionary_. This opens the underlying note, which contains one word per line. You can add, remove, or modify entries as you like.

> [!NOTE]
> Changes to the custom dictionary (whether from the editor or the context menu) take effect after restarting the application.

#### How the custom dictionary works

*   When you right-click a misspelled word and choose "Add to dictionary", the word is saved both to Electron's local spellchecker and to the synced dictionary note.
*   On startup, Trilium loads all words from the dictionary note into the spellchecker session.
*   If Trilium detects words in Electron's local dictionary but the dictionary note is empty (e.g. on first use), it performs a **one-time import** of those words into the note.
*   Words that are in Electron's local dictionary but _not_ in the note (e.g. you removed them manually) are cleaned up from the local dictionary on startup.

#### Known limitations

On Windows and macOS, Electron delegates "Add to dictionary" to the operating system's user dictionary. This means:

*   Words added via the context menu are also written to the OS-level dictionary (e.g. `%APPDATA%\Microsoft\Spelling\<language>\default.dic` on Windows).
*   **Removing a word** from the Trilium dictionary note prevents it from being loaded into the spellchecker on next startup, but does _not_ remove it from the OS dictionary. The word may still be accepted by the OS spellchecker until you remove it from the OS dictionary manually.

## Web browser

When accessing Trilium through a web browser, spell checking is handled entirely by the browser itself. Trilium does not control the browser's spellchecker — language selection, dictionaries, and all other settings are managed through your browser's preferences.

The Spell Check settings page in Trilium will indicate that these options apply only to desktop builds.

## Frequently asked questions

### Do I need to restart after every change?

Yes. Spell check language selection and the custom dictionary are loaded once at startup. Any changes require a restart to take effect.

### Can I use multiple spell check languages at the same time?

Yes. Select as many languages as you need from the checklist. The spellchecker will accept words from any of the selected languages.

### My custom words disappeared after syncing to a new device — what happened?

On the first launch of a new device, Trilium may import existing local dictionary words into the note. If the note already has words from another device (via sync), those are preserved. Make sure sync completes before restarting the application on a new device.

### I removed a word from the dictionary note but it's still accepted

This is likely due to the OS-level dictionary retaining the word (see [Known limitations](#known-limitations) above). You can manually remove it from your operating system's user dictionary.