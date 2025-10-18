import Modal from "../react/Modal";
import Button from "../react/Button";
import NoteAutocomplete from "../react/NoteAutocomplete";
import { t } from "../../services/i18n";
import { useRef, useState } from "preact/hooks";
import note_autocomplete, { CreateMode, Suggestion } from "../../services/note_autocomplete.js";
import appContext from "../../components/app_context";
import commandRegistry from "../../services/command_registry";
import { refToJQuerySelector } from "../react/react_utils";
import { useTriliumEvent } from "../react/hooks";
import shortcutService from "../../services/shortcuts";

const KEEP_LAST_SEARCH_FOR_X_SECONDS = 120;

enum Mode {
    LastSearch,
    RecentNotes,
    Commands,
}

export default function JumpToNoteDialogComponent() {
    const [ mode, setMode ] = useState<Mode>();
    const [ lastOpenedTs, setLastOpenedTs ] = useState<number>(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const autocompleteRef = useRef<HTMLInputElement>(null);
    const [ isCommandMode, setIsCommandMode ] = useState(mode === Mode.Commands);
    const [ initialText, setInitialText ] = useState(isCommandMode ? "> " : "");
    const actualText = useRef<string>(initialText);
    const [ shown, setShown ] = useState(false);

    async function openDialog(requestedMode: Mode) {
        let newMode: Mode;
        let initialText = "";

        switch (requestedMode) {
            case Mode.Commands:
                newMode = Mode.Commands;
                initialText = ">";
                break;

            case Mode.LastSearch:
                // if you open the Jump To dialog soon after using it previously, it can often mean that you
                // actually want to search for the same thing (e.g., you opened the wrong note at first try)
                // so we'll keep the content.
                // if it's outside of this time limit, then we assume it's a completely new search and show recent notes instead.
                if (Date.now() - lastOpenedTs <= KEEP_LAST_SEARCH_FOR_X_SECONDS * 1000 && actualText.current) {
                    newMode = Mode.LastSearch;
                    initialText = actualText.current;
                } else {
                    newMode = Mode.RecentNotes;
                }
                break;

            // Mode.RecentNotes intentionally falls through to default:
            // both represent the "normal open" behavior, where we decide between
            // showing recent notes or restoring the last search depending on timing.
            case Mode.RecentNotes:
            default:
                if (Date.now() - lastOpenedTs <= KEEP_LAST_SEARCH_FOR_X_SECONDS * 1000 && actualText.current) {
                    newMode = Mode.LastSearch;
                    initialText = actualText.current;
                } else {
                    newMode = Mode.RecentNotes;
                }
                break;
        }

        if (mode !== newMode) {
            setMode(newMode);
        }

        setInitialText(initialText);
        setShown(true);
        setLastOpenedTs(Date.now());
    }

    useTriliumEvent("jumpToNote", () => openDialog(Mode.RecentNotes));
    useTriliumEvent("commandPalette", () => openDialog(Mode.Commands));

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
            case Mode.LastSearch:
                break;
            case Mode.RecentNotes:
                note_autocomplete.showRecentNotes($autoComplete);
                break;
            case Mode.Commands:
                note_autocomplete.showAllCommands($autoComplete);
                break;
        }

        $autoComplete
            .trigger("focus")
            .trigger("select");

        // Add keyboard shortcut for full search
        shortcutService.bindElShortcut($autoComplete, "ctrl+return", () => {
            if (!isCommandMode) {
                showInFullSearch();
            }
        });
    }

    async function showInFullSearch() {
        try {
            setShown(false);
            const searchString = actualText.current?.trim();
            if (searchString && !searchString.startsWith(">")) {
                await appContext.triggerCommand("searchNotes", {
                    searchString
                });
            }
        } catch (error) {
            console.error("Failed to trigger full search:", error);
        }
    }

    return (
        <Modal
            className="jump-to-note-dialog"
            size="lg"
            title={<NoteAutocomplete
                placeholder={t("jump_to_note.search_placeholder")}
                inputRef={autocompleteRef}
                container={containerRef}
                text={initialText}
                opts={{
                    createMode: CreateMode.CreateOnly,
                    hideGoToSelectedNoteButton: true,
                    allowJumpToSearchNotes: true,
                    isCommandPalette: true
                }}
                onTextChange={(text) => {
                    actualText.current = text;
                    setIsCommandMode(text.startsWith(">"));
                }}
                onChange={onItemSelected}
                />}
            onShown={onShown}
            onHidden={() => setShown(false)}
            footer={!isCommandMode && <Button
                className="show-in-full-text-button"
                text={t("jump_to_note.search_button")}
                keyboardShortcut="Ctrl+Enter"
                onClick={showInFullSearch}
            />}
            show={shown}
        >
            <div className="algolia-autocomplete-container jump-to-note-results" ref={containerRef}></div>
        </Modal>
    );
}
