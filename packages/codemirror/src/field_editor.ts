import { autocompletion, type Completion, completionStatus, type CompletionSource } from "@codemirror/autocomplete";
import { history, historyKeymap, standardKeymap } from "@codemirror/commands";
import { ChangeSet, type ChangeSpec, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";

/**
 * The types a consumer needs to write a {@link FieldEditorConfig.completionSource}, re-exported
 * so it does not have to depend on `@codemirror/autocomplete` itself.
 */
export type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";

export interface FieldEditorConfig {
    parent: HTMLElement;
    /** Text the editor starts with. */
    doc?: string;
    placeholder?: string;
    /** Names the field for assistive technology, where a placeholder is a hint rather than a name. */
    ariaLabel?: string;
    /** Extra extensions, such as a highlighter for whatever syntax the value holds. */
    extensions?: Extension[];
    /** Completions to offer as the value is typed. Without one, the editor has no autocompletion. */
    completionSource?: CompletionSource;
    /**
     * The icon classes a completion is drawn with, such as `bx bx-hash`. Completions it answers
     * nothing for are drawn without one; supplying it at all replaces CodeMirror's own icons.
     */
    completionIcon?(completion: Completion): string | undefined;
    /**
     * Whether picking a completion reopens the popup on what follows it, for one that inserts an
     * opening rather than a finished value.
     */
    activateOnCompletion?(completion: Completion): boolean;
    /**
     * Whether the value is confined to one line, the way an input is: Shift-Enter does nothing and
     * a line break in inserted text becomes a space. Long values scroll sideways instead of
     * wrapping, since `lineWrapping` would grow the field.
     */
    singleLine?: boolean;
    /** Runs after every document change, with the whole text. */
    onChange?(value: string): void;
    /** Runs when Enter is pressed; Shift-Enter inserts a line break, unless {@link singleLine}. */
    onEnter?(): void;
    /**
     * Runs when ArrowDown is pressed and no completion is open or pending, for a field whose
     * results are listed below it. Returns whether the key was taken; `false` moves the caret.
     */
    onArrowDown?(): boolean;
    /** Runs when Escape is pressed and no completion is open or pending. Returns as {@link onArrowDown}. */
    onEscape?(): boolean;
}

/** The editor {@link createFieldEditor} returns. */
export type FieldEditor = EditorView;

/**
 * Builds a CodeMirror editor for a form field's value: text editing, undo history and wrapped
 * display, and nothing else — no gutter and no language. Highlighting and completion are the
 * consumer's to supply, through `extensions` and `completionSource`.
 *
 * Enter runs `onEnter` instead of inserting a line break, so the field answers the key the way an
 * input does. Shift-Enter, which `standardKeymap` binds to `insertNewlineAndIndent`, breaks the
 * line and keeps its indentation, for a value the user lays out over several of them; `singleLine`
 * holds the value to one line instead.
 *
 * `onArrowDown` and `onEscape` run only while no completion is open or pending, so a key the popup
 * drops does not move focus out of the editor instead. An IME keeps Enter for as long as it is
 * composing.
 *
 * It sits apart from the editor in `index.ts` so a consumer that wants a plain input does not
 * load the language, theme and completion machinery a code note needs.
 */
export function createFieldEditor(config: FieldEditorConfig): FieldEditor {
    const extensions: Extension[] = [
        history(),
        keymap.of([
            {
                key: "Enter",
                run: (view) => {
                    if (view.composing) {
                        return false;
                    }

                    config.onEnter?.();
                    return true;
                }
            },
            // Swallowed rather than left to `insertNewlineAndIndent`, whose line break and
            // indentation `flattenToOneLine` would otherwise turn into stray spaces.
            ...(config.singleLine ? [ { key: "Shift-Enter", run: () => true } ] : []),
            { key: "ArrowDown", run: (view) => keyBelongsToField(view) && !!config.onArrowDown?.() },
            { key: "Escape", run: (view) => keyBelongsToField(view) && !!config.onEscape?.() },
            ...standardKeymap,
            ...historyKeymap
        ]),
        EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                config.onChange?.(update.state.doc.toString());
            }
        }),
        ...(config.singleLine ? [ flattenToOneLine ] : [ EditorView.lineWrapping ]),
        ...(config.extensions ?? [])
    ];

    if (config.placeholder) {
        extensions.push(placeholder(config.placeholder));
    }

    if (config.ariaLabel) {
        extensions.push(EditorView.contentAttributes.of({ "aria-label": config.ariaLabel }));
    }

    if (config.completionSource) {
        const icon = config.completionIcon;

        // The completion keymap is registered at the highest precedence, so Enter picks the
        // selected option while the popup is open and reaches `onEnter` the rest of the time.
        extensions.push(autocompletion({
            override: [ config.completionSource ],
            activateOnTyping: true,
            activateOnCompletion: config.activateOnCompletion,
            icons: !icon,
            addToOptions: icon ? [ { position: ICON_POSITION, render: (completion) => renderIcon(icon(completion)) } ] : []
        }));
    }

    return new EditorView({
        parent: config.parent,
        doc: config.doc ?? "",
        extensions
    });
}

/**
 * Keeps the document on one line, for a field laid out as an input. A line break in inserted text
 * becomes a space, so pasting several lines still puts their text in the field.
 */
const flattenToOneLine = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.newDoc.lines === 1) {
        return tr;
    }

    const flattened: ChangeSpec[] = [];
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        flattened.push({ from: fromA, to: toA, insert: inserted.toString().replace(/\r\n?|\n/g, " ") });
    });

    const changes = ChangeSet.of(flattened, tr.startState.doc.length);

    return {
        changes,
        // Mapped with assoc 1, so the caret lands after the inserted text as it otherwise would.
        selection: tr.startState.selection.map(changes, 1),
        scrollIntoView: tr.scrollIntoView
    };
});

/**
 * Whether a navigation key the completion popup declined belongs to the field. The popup drops
 * ArrowDown and Escape for `interactionDelay` after it opens, and a key dropped that way must not
 * reach {@link FieldEditorConfig.onArrowDown}, which moves focus out of the editor entirely.
 */
function keyBelongsToField(view: EditorView) {
    return !view.composing && completionStatus(view.state) === null;
}

/** Where CodeMirror draws its own icons, which {@link FieldEditorConfig.completionIcon} takes over. */
const ICON_POSITION = 20;

function renderIcon(classes: string | undefined) {
    if (!classes) {
        return null;
    }

    const element = document.createElement("span");
    element.className = `cm-completion-glyph ${classes}`;
    // The label beside it already says what the icon repeats.
    element.setAttribute("aria-hidden", "true");

    return element;
}
