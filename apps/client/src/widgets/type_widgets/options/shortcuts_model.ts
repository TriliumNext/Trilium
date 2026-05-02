export function parseShortcutInput(shortcutInput: string) {
    return shortcutInput
        .replace(/\+\s*,/g, "+Comma")
        .split(",")
        .map((shortcut) => shortcut.replace(/\+Comma/g, "+,").trim())
        .filter((shortcut) => !!shortcut);
}

export function getShortcutOptionValue(shortcutInput: string) {
    return JSON.stringify(parseShortcutInput(shortcutInput));
}
