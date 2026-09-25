import type { FieldEditor } from "@triliumnext/codemirror/src/field_editor";
import clsx from "clsx";
import type { MutableRef } from "preact/hooks";
import { useEffect, useRef } from "preact/hooks";

import { t } from "../../services/i18n";
import type { ShortcutHintDefinition } from "../../services/shortcut_hints";
import { useContextualShortcutHints } from "../react/hooks";
import { createSearchFieldEditor, SEARCH_FIELD_EDITOR_CLASS } from "../search_field_editor";

interface SearchStringEditorProps {
    currentValue: string;
    /** The note `currentValue` belongs to. A change to it replaces the document. */
    noteId: string;
    placeholder?: string;
    /** Names the field where the placeholder is a hint rather than a name for it. */
    ariaLabel?: string;
    className?: string;
    autoFocus?: boolean;
    /** Whether the query is held to one line, for a field laid out as an input. */
    singleLine?: boolean;
    /** Handed the editor once built, for a caller that has to focus or select what it holds. */
    editorRef?: MutableRef<FieldEditor | undefined>;
    onChange(newValue: string): void;
    /** Runs when Enter is pressed, which the editor treats as "run this search". */
    onEnter(): void;
    /**
     * Runs on Escape, once the completion popup has passed the key on. Returns whether the field
     * took it; `false` leaves it to whatever the field sits in.
     */
    onEscape?(): boolean;
}

// The keys the field answers, for the contextual shortcut pane (Alt+F1). CodeMirror binds
// Ctrl-Space on every platform, so it is a literal key list rather than a rebindable action.
const SEARCH_STRING_HINTS: ShortcutHintDefinition = [
    {
        titleKey: "search_string.hints.title",
        hints: [
            { keys: ["Ctrl+Space"], labelKey: "search_string.hints.completions" },
            { keys: ["Shift+Enter"], labelKey: "search_string.hints.new_line" },
            { keys: ["Enter"], labelKey: "search_string.hints.run_search" }
        ]
    }
];

/** The same, less the line break a one-line field does not take. */
const SINGLE_LINE_HINTS: ShortcutHintDefinition = [
    {
        titleKey: "search_string.hints.title",
        hints: [
            { keys: ["Ctrl+Space"], labelKey: "search_string.hints.completions" },
            { keys: ["Enter"], labelKey: "search_string.hints.run_search" }
        ]
    }
];

/**
 * A search query in a CodeMirror editor, with the highlighting, linting and completions the syntax
 * carries. Enter runs the search; Shift-Enter starts a new line, so a long query can be laid out
 * over several of them, unless `singleLine` holds the field to one.
 *
 * Written to edit the `#searchString` of a saved search, and used for a collection filter too.
 */
export default function SearchStringEditor({ currentValue, noteId, placeholder, ariaLabel, className, autoFocus, singleLine, editorRef: exposedRef, onChange, onEnter, onEscape }: SearchStringEditorProps) {
    const parentRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<FieldEditor>();
    // The editor is built once, so it reaches the current props through a ref rather than
    // through the closure of the render that created it.
    const propsRef = useRef({ currentValue, onChange, onEnter, onEscape });
    propsRef.current = { currentValue, onChange, onEnter, onEscape };
    // Set while the effect below writes `currentValue` into the document, so `onChange` does not
    // report it as an edit the user made.
    const isAdopting = useRef(false);

    useContextualShortcutHints(singleLine ? SINGLE_LINE_HINTS : SEARCH_STRING_HINTS);

    useEffect(() => {
        if (!parentRef.current) {
            return;
        }

        const editor = createSearchFieldEditor({
            parent: parentRef.current,
            doc: propsRef.current.currentValue,
            placeholder,
            ariaLabel,
            singleLine,
            onChange: (value) => {
                if (!isAdopting.current) {
                    propsRef.current.onChange(value);
                }
            },
            onEnter: () => propsRef.current.onEnter(),
            onEscape: () => propsRef.current.onEscape?.() ?? false
        });
        editorRef.current = editor;
        if (exposedRef) {
            exposedRef.current = editor;
        }

        if (autoFocus) {
            editor.focus();
        }

        return () => {
            editor.destroy();
            editorRef.current = undefined;
            if (exposedRef) {
                exposedRef.current = undefined;
            }
        };
        // Builds the editor once; `placeholder` and `autoFocus` are read at that point.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Follows a value that changed outside the editor. Under the same `noteId` a focused editor
    // keeps its document, since the debounced save echoes the typed text back and replacing the
    // document would drop the caret to the end.
    const shownNoteId = useRef(noteId);
    useEffect(() => {
        const editor = editorRef.current;
        const switchedNote = shownNoteId.current !== noteId;
        shownNoteId.current = noteId;

        if (!editor || editor.state.doc.toString() === currentValue || (editor.hasFocus && !switchedNote)) {
            return;
        }

        isAdopting.current = true;
        try {
            editor.dispatch({
                changes: { from: 0, to: editor.state.doc.length, insert: currentValue }
            });
        } finally {
            isAdopting.current = false;
        }
    }, [ currentValue, noteId ]);

    return <div ref={parentRef} className={clsx(SEARCH_FIELD_EDITOR_CLASS, "form-control tn-input-field", className)} />;
}
