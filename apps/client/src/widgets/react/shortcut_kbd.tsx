import { formatShortcut, joinShortcut } from "../../services/keyboard_shortcut_display";
import { isMac } from "../../services/utils";
import { joinElements } from "./react_utils";

/**
 * Renders a single stored shortcut as `<kbd>` element(s). On macOS the glyphs are concatenated inside
 * one `<kbd>` (native convention: `⇧⌘J`); elsewhere each token gets its own `<kbd>`, joined by `+`.
 */
export function renderShortcutKbds(shortcut: string) {
    const tokens = formatShortcut(shortcut);
    if (isMac()) {
        return <kbd>{joinShortcut(tokens)}</kbd>;
    }
    return joinElements(tokens.map((key, index) => <kbd key={index}>{key}</kbd>), "+");
}
