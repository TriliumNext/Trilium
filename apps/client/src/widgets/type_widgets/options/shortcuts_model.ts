export function parseShortcutInput(shortcutInput: string) {
    return shortcutInput
        .replaceAll("+,", "+Comma")
        .split(",")
        .map((shortcut) => shortcut.replaceAll("+Comma", "+,").trim())
        .filter((shortcut) => !!shortcut);
}

export function getShortcutOptionValue(shortcutInput: string) {
    return JSON.stringify(parseShortcutInput(shortcutInput));
}
