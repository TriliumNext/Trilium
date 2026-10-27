import { isFullWidthNoteType } from "@triliumnext/commons";

import type { EventData } from "../components/app_context.js";
import type NoteContext from "../components/note_context.js";
import type FNote from "../entities/fnote.js";
import attributeService from "../services/attributes.js";
import utils from "../services/utils.js";
import { isContentRightToLeft } from "../utils/formatters.js";
import type BasicWidget from "./basic_widget.js";
import FlexContainer from "./containers/flex_container.js";

export default class NoteWrapperWidget extends FlexContainer<BasicWidget> {

    private noteContext?: NoteContext;

    constructor() {
        super("column");

        this.css("flex-grow", "1").collapsible();
    }

    doRender() {
        super.doRender();
        // Adds `note-split` before the note context arrives: `resizer.ts` selects the panes by it.
        this.refresh();
    }

    setNoteContextEvent({ noteContext }: EventData<"setNoteContext">) {
        this.noteContext = noteContext;
        this.refresh();
    }

    noteSwitchedAndActivatedEvent({ noteContext }: EventData<"setNoteContext">) {
        this.noteContext = noteContext;
        this.refresh();
    }

    noteSwitchedEvent({ noteContext }: EventData<"setNoteContext">) {
        this.noteContext = noteContext;
        this.refresh();
    }

    activeContextChangedEvent({ noteContext }: EventData<"setNoteContext">) {
        this.noteContext = noteContext;
        this.refresh();
    }

    refresh() {
        const classes = new Set(this.getClasses().join(" ").split(/[\t\n\f\r ]+/).filter(Boolean));

        // Only the difference is applied: a class change on the split restyles the whole note.
        const classList = this.$widget[0].classList;
        for (const cls of [ ...classList ]) {
            if (!classes.has(cls)) {
                classList.remove(cls);
            }
        }
        for (const cls of classes) {
            if (!classList.contains(cls)) {
                classList.add(cls);
            }
        }

        // `bgfx` can change here without SplitNoteContainer refreshing.
        const container = this.$widget[0].parentElement;
        if (container) {
            markVisibleSplits(container);
        }
    }

    /** The classes of the split, each entry holding one or more class names split by whitespace. */
    private getClasses() {
        // These are owned by SplitNoteContainer, not by the note, so they are kept as they are.
        const classes = CONTAINER_OWNED_CLASSES.filter((cls) => this.$widget.hasClass(cls));
        classes.push(this.isHiddenExt() ? "hidden-ext" : "visible", "component", "note-split");

        const note = this.noteContext?.note;
        if (!note) {
            classes.push("bgfx", "empty-note");
            return classes;
        }

        classes.push(
            note.getCssClass(),
            utils.getNoteTypeClass(note.type),
            utils.getMimeTypeClass(note.mime),
            `view-mode-${this.noteContext?.viewScope?.viewMode ?? "default"}`,
            note.getColorClass()
        );
        if (isFullWidthNote(note)) classes.push("full-content-width");
        if (note.isOptions()) classes.push("options");
        if (hasBackgroundEffects(note)) classes.push("bgfx");
        if (note.isProtected) classes.push("protected");
        // Resolved rather than read straight off the label: a note with no language of its own
        // still follows the default content language.
        if (isContentRightToLeft(note.getLabelValue("language"))) classes.push("rtl");

        return classes;
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        // listening on changes of note.type and CSS class
        const LABELS_CAUSING_REFRESH = ["cssClass", "language", "viewType", "color", "fullContentWidth"];
        const noteId = this.noteContext?.noteId;
        if (
            loadResults.isNoteReloaded(noteId) ||
            // The direction of a note carrying no `#language` comes from this option, so a change to it
            // has to repaint the `rtl` class the same way a change to the label would.
            loadResults.isOptionReloaded("defaultContentLanguage") ||
            loadResults.getAttributeRows().find((attr) => attr.type === "label" && LABELS_CAUSING_REFRESH.includes(attr.name ?? "") && attributeService.isAffecting(attr, this.noteContext?.note))
        ) {
            this.refresh();
        }
    }
}

/** Classes set on the split by `SplitNoteContainer`, based on the split's position among its siblings. */
const CONTAINER_OWNED_CLASSES = [ "active", "last-visible" ];

/**
 * Marks the rightmost visible split of `container` with `last-visible`, and the container with
 * `multiple-splits` while it shows more than one. Sets `first-split-bgfx` and `last-split-bgfx` on
 * `body` while the outer visible splits are translucent, for the peek buttons on either side of
 * `#center-pane`. Reads the DOM order, since `SplitNoteContainer` reorders the splits in place.
 */
export function markVisibleSplits(container: HTMLElement) {
    const splits = [ ...container.children ]
        .filter((child) => child.classList.contains("note-split"));
    const visibleSplits = splits.filter((split) => !split.classList.contains("hidden-ext"));
    const firstVisible = visibleSplits.at(0);
    const lastVisible = visibleSplits.at(-1);
    for (const split of splits) {
        split.classList.toggle("last-visible", split === lastVisible);
    }

    const bodyClasses = document.body.classList;
    container.classList.toggle("multiple-splits", visibleSplits.length > 1);
    bodyClasses.toggle("first-split-bgfx", !!firstVisible?.classList.contains("bgfx"));
    bodyClasses.toggle("last-split-bgfx", !!lastVisible?.classList.contains("bgfx"));
}

/**
 * Whether the split should be translucent (`bgfx`), letting the window background effect show through.
 * This suits notes that render their content on a bare background (media, option pages, and the
 * collections whose own surface is only what they lay out on it); notes that paint their own
 * background stay opaque. Exported as a pure function for
 * unit testing.
 */
export function hasBackgroundEffects(note: FNote): boolean {
    const MIME_TYPES_WITH_BACKGROUND_EFFECTS = [
        "application/pdf"
    ];

    const COLLECTIONS_WITH_BACKGROUND_EFFECTS = [
        "grid",
        "list",
        "board"
    ];

    if (note.isOptions()) {
        return true;
    }

    if (note.type === "image") {
        return true;
    }

    if (note.type === "file" && (MIME_TYPES_WITH_BACKGROUND_EFFECTS.includes(note.mime) || note.mime.startsWith("audio/"))) {
        return true;
    }

    if (note.type === "book" && COLLECTIONS_WITH_BACKGROUND_EFFECTS.includes(note.getLabelValue("viewType") ?? "none")) {
        return true;
    }

    return false;
}

/**
 * Whether a note is full width purely because of its type (e.g. canvas, collections, media),
 * irrespective of the `fullContentWidth` label. For these notes the label has no effect, so the
 * UI toggle is hidden. Exported as a pure function for unit testing.
 */
export function isAlwaysFullWidthByType(note: FNote) {
    // Icon packs render a full-pane glyph grid; `code`-type ones are already covered below, this also
    // catches the `file`-type packs (distributable zips).
    if (note.isIconPack()) {
        return true;
    }

    if (isFullWidthNoteType(note.type, note.mime)) {
        return true;
    }

    if (note.type === "search" && ![ "grid", "list" ].includes(note.getLabelValue("viewType") ?? "list")) {
        return true;
    }

    return false;
}

/**
 * Whether a note should occupy the full available content width. Some note types are always
 * full width by nature (see {@link isAlwaysFullWidthByType}), while regular notes opt in via the
 * `fullContentWidth` label. Exported as a pure function for unit testing.
 */
export function isFullWidthNote(note: FNote) {
    return isAlwaysFullWidthByType(note) || !!note?.isLabelTruthy("fullContentWidth");
}
