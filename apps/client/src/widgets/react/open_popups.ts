/** The functions that close the popups and menus open now; see {@link closeOpenPopups}. */
const openPopups = new Set<() => void>();

/** Registers `close` for {@link closeOpenPopups} until the returned function runs. */
export function registerOpenPopup(close: () => void) {
    openPopups.add(close);
    return () => {
        openPopups.delete(close);
    };
}

/**
 * Closes every open popup and the context menu, for something that takes over the screen, such as
 * a dialog opened by a keyboard shortcut.
 */
export function closeOpenPopups() {
    for (const close of [ ...openPopups ]) close();
}
