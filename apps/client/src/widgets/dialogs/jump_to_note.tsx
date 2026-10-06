import "./jump_to_note.css";

import clsx from "clsx";
import { useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import type FNote from "../../entities/fnote";
import commandRegistry from "../../services/command_registry";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import type { Suggestion } from "../../services/note_autocomplete";
import { isMobile } from "../../services/utils";
import { NoteAttributes, NoteContent } from "../collections/legacy/ListOrGridView";
import { useMediaQuery, useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import Modal from "../react/Modal";
import NoteAutocomplete, { type NoteAutocompleteHandle } from "../react/NoteAutocomplete";
import { refToJQuerySelector } from "../react/react_utils";

const KEEP_LAST_SEARCH_FOR_X_SECONDS = 120;
/** How long the highlight rests on a row before the preview renders it, so arrowing past skips it. */
export const PREVIEW_DELAY_MS = 150;
/** Wide enough for the results and the preview side by side. */
const PREVIEW_MEDIA_QUERY = "(min-width: 1100px)";

type Mode = "last-search" | "recent-notes" | "commands";

export default function JumpToNoteDialogComponent() {
    const [ mode, setMode ] = useState<Mode>();
    const [ lastOpenedTs, setLastOpenedTs ] = useState<number>(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const autocompleteRef = useRef<HTMLInputElement>(null);
    const handleRef = useRef<NoteAutocompleteHandle>(null);
    const [ initialText, setInitialText ] = useState("");
    const actualText = useRef<string>(initialText);
    const [ shown, setShown ] = useState(false);
    const [ highlighted, setHighlighted ] = useState<Suggestion>();
    // The command palette lists commands, which have no content to preview.
    const [ isCommandQuery, setCommandQuery ] = useState(false);
    // The dialog keeps the preview's width while the command palette leaves it out, so it does not
    // resize as `>` is typed and erased.
    const isWide = useMediaQuery(PREVIEW_MEDIA_QUERY) && !isMobile();
    const showsPreview = isWide && !isCommandQuery;

    async function openDialog(commandMode: boolean) {
        let newMode: Mode;
        let initialText = "";

        if (commandMode) {
            newMode = "commands";
            initialText = ">";
        } else if (Date.now() - lastOpenedTs <= KEEP_LAST_SEARCH_FOR_X_SECONDS * 1000 && actualText.current) {
            // if you open the Jump To dialog soon after using it previously, it can often mean that you
            // actually want to search for the same thing (e.g., you opened the wrong note at first try)
            // so we'll keep the content.
            // if it's outside of this time limit, then we assume it's a completely new search and show recent notes instead.
            newMode = "last-search";
            initialText = actualText.current;
        } else {
            newMode = "recent-notes";
        }

        if (mode !== newMode) {
            setMode(newMode);
        }

        setInitialText(initialText);
        setShown(true);
        setLastOpenedTs(Date.now());
    }

    useTriliumEvent("jumpToNote", () => openDialog(false));
    useTriliumEvent("commandPalette", () => openDialog(true));

    async function onItemSelected(suggestion?: Suggestion | null) {
        if (!suggestion) {
            return;
        }

        setShown(false);
        if (suggestion.notePath) {
            appContext.tabManager.getActiveContext()?.setNote(suggestion.notePath);
        } else if (suggestion.commandId) {
            await commandRegistry.executeCommand(suggestion.commandId);
        }
    }

    function onShown() {
        const $autoComplete = refToJQuerySelector(autocompleteRef);
        switch (mode) {
            case "last-search":
                break;
            case "recent-notes":
                handleRef.current?.showRecentNotes();
                break;
            case "commands":
                handleRef.current?.showAllCommands();
                break;
        }

        $autoComplete.trigger("focus");

        if (mode === "commands") {
            // In command mode, place caret at end instead of selecting all text
            // This preserves the ">" prefix when the user starts typing
            const input = autocompleteRef.current;
            if (input) {
                const len = input.value.length;
                input.setSelectionRange(len, len);
            }
        } else {
            $autoComplete.trigger("select");
        }
    }

    return (
        <Modal
            className={clsx("jump-to-note-dialog", isWide && "wide", showsPreview && "with-preview")}
            size="lg"
            title={<>
                {!isMobile() && <Icon icon="bx bx-search" className="jump-to-note-search-icon" />}
                <NoteAutocomplete
                    placeholder={t("jump_to_note.search_placeholder")}
                    inputRef={autocompleteRef}
                    handleRef={handleRef}
                    container={containerRef}
                    text={initialText}
                    opts={{
                        allowCreatingNotes: true,
                        hideGoToSelectedNoteButton: true,
                        allowJumpToSearchNotes: true,
                        isCommandPalette: true
                    }}
                    onTextChange={(text) => {
                        actualText.current = text;
                        setCommandQuery(text.startsWith(">"));
                    }}
                    onChange={onItemSelected}
                    searchFooter
                    onHighlight={showsPreview ? setHighlighted : undefined}
                />
            </>}
            onShown={onShown}
            onHidden={() => setShown(false)}
            show={shown}
        >
            <div className="jump-to-note-results" ref={containerRef} />
            {showsPreview && <JumpToNotePreview suggestion={shown ? highlighted : undefined} />}
        </Modal>
    );
}

/**
 * The note a row of the results stands for, previewed beside them: its path, title, attributes and
 * the start of its content. A row that is no note, such as a command or a creation row, leaves it
 * empty, so the layout keeps still.
 */
export function JumpToNotePreview({ suggestion }: { suggestion: Suggestion | undefined }) {
    // The path is kept with the note it was loaded for, so the card never pairs one note's content
    // with the next one's path while that one loads.
    const [ previewed, setPreviewed ] = useState<{ note: FNote; parentPath: string } | null>(null);
    const notePath = !suggestion?.action ? suggestion?.notePath : undefined;
    // The path the row shows, as the server spelled it out: branch prefixes included, and ancestors
    // that froca has not loaded.
    const parentPathHtml = suggestion?.highlightedParentPathTitle ?? "";

    useEffect(() => {
        if (!notePath) {
            setPreviewed(null);
            return;
        }

        let cancelled = false;
        const timeout = setTimeout(async () => {
            const note = await froca.getNote(notePath.split("/").at(-1) ?? "", true);
            if (!cancelled) setPreviewed(note ? { note, parentPath: htmlToText(parentPathHtml) } : null);
        }, PREVIEW_DELAY_MS);
        return () => {
            cancelled = true;
            clearTimeout(timeout);
        };
    }, [ notePath, parentPathHtml ]);

    const { note, parentPath } = previewed ?? {};

    return (
        <div className="jump-to-note-preview">
            {note && <div key={note.noteId} className="jump-to-note-preview-card">
                {parentPath && <div className="jump-to-note-preview-path">{parentPath}</div>}
                <h4 className="jump-to-note-preview-title">
                    <Icon icon={note.getIcon()} />
                    <span>{note.title}</span>
                </h4>
                <NoteAttributes note={note} />
                <NoteContent note={note} trim highlightedTokens={null} includeArchivedNotes={false} />
            </div>}
        </div>
    );
}

/**
 * The text of a highlighted path from the server, its `<b>` marks and entities resolved. Parsed in
 * a `<template>`, whose content runs no script and loads nothing.
 */
function htmlToText(html: string) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.textContent ?? "";
}
