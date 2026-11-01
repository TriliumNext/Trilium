import {
    addKeyboardHandlingForGrid,
    type ButtonView,
    FocusTracker,
    KeystrokeHandler,
    type Locale,
    View,
    type ViewCollection
} from "ckeditor5";

import "../theme/tile_row.css";

/**
 * Groups of square buttons on one row, 20px apart, styled and navigated with the arrow keys as
 * CKEditor's list style grid.
 */
export default class TileRowView extends View {

    public readonly tiles: ViewCollection<ButtonView>;
    public readonly focusTracker = new FocusTracker();
    public readonly keystrokes = new KeystrokeHandler();

    constructor(locale: Locale, groups: ButtonView[][], ariaLabel: string) {
        super(locale);
        const tiles = groups.flat();
        for (const [first] of groups.slice(1)) {
            first.extendTemplate({ attributes: { class: "ck-tile-row__group-start" } });
        }
        this.tiles = this.createCollection(tiles);
        this.tiles.delegate("execute").to(this);
        addKeyboardHandlingForGrid({
            keystrokeHandler: this.keystrokes,
            focusTracker: this.focusTracker,
            gridItems: this.tiles,
            numberOfColumns: tiles.length,
            uiLanguageDirection: locale.uiLanguageDirection
        });

        this.setTemplate({
            tag: "div",
            attributes: {
                class: ["ck", "ck-list-styles-list", "ck-tile-row"],
                style: { gridTemplateColumns: `repeat(${tiles.length}, auto)` },
                "aria-label": ariaLabel
            },
            children: this.tiles
        });
    }

    public override render(): void {
        super.render();
        for (const tile of this.tiles) {
            this.focusTracker.add(tile);
        }
        /* v8 ignore next -- super.render() has just built this view's element */
        if (this.element) {
            this.keystrokes.listenTo(this.element);
        }
    }

    /** Focuses the tile that is on, or the first one. */
    public focus(): void {
        (this.tiles.find(tile => tile.isOn) ?? this.tiles.first)?.focus();
    }

    public override destroy(): void {
        super.destroy();
        this.focusTracker.destroy();
        this.keystrokes.destroy();
    }
}
