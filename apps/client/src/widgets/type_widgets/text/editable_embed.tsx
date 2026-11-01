import type { CKTextEditor, EmbedEdge } from "@triliumnext/ckeditor5";
import { type ComponentChildren, createContext, type RefObject } from "preact";
import { Suspense } from "preact/compat";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import type { ContentEditor } from "../../../services/content_renderer";
import options from "../../../services/options";
import { useNoteLabelBoolean } from "../../react/hooks";
import {
    type ContentEmbedToolProvider, registerContentEmbedTools, registerEmbedCaretTarget,
    useIsContentEmbedEditable
} from "./content_embed_tools";

/**
 * Whether the content renders inside the editor of an embed. Its own embeds then stay read-only,
 * so that editors nest one level deep at most.
 */
export const NestedEmbedContext = createContext(false);

/**
 * The editors that a host passes to its embeds, such as its `AttachmentEditor`: none for a host
 * nested in an embed.
 */
export function useEmbedEditors<T extends object>(editors: T): Partial<T> {
    return useContext(NestedEmbedContext) ? {} : editors;
}

export interface EditableEmbedOptions {
    /** Saves the changes, or `undefined` where the content is read-only. */
    editor: ContentEditor | undefined;
    /** The note shown, whose `#readOnly` label keeps it read-only. `null` for an attachment. */
    note: FNote | null;
    /**
     * The buttons that the content adds to the toolbar of its embed while it can be edited, with
     * `hasEditableFlag` set. The Editable toggle alone when left out, and `null` for content that
     * adds its own.
     */
    tools?: ContentEmbedToolProvider | null;
    /** Selects the element of the content that takes the focus when the embed box does. */
    focusTarget?: string;
}

/**
 * The editable mode of the content of an embed: `canEdit` while `editor` can save the content, and
 * `isEditing` while the Editable toggle of the embed is on as well.
 */
export function useEditableEmbed(
    rootRef: RefObject<HTMLElement | null>,
    { editor, note, tools, focusTarget }: EditableEmbedOptions
) {
    const [ isNoteReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const canEdit = !!editor?.canEdit() && !isNoteReadOnly && !options.is("databaseReadonly");
    const isToggledOn = useIsContentEmbedEditable(rootRef);
    const provider = tools === undefined ? EDITABLE_FLAG_TOOLS : tools;

    useEffect(() => {
        const root = rootRef.current;
        if (!root || !canEdit || !provider) return;

        return registerContentEmbedTools(root, provider);
    }, [ rootRef, canEdit, provider ]);
    useFocusFromEmbedBox(rootRef, focusTarget);

    return { canEdit, isEditing: canEdit && isToggledOn };
}

interface EditableEmbedContentProps {
    rootRef: RefObject<HTMLDivElement | null>;
    className: string;
    isEditing: boolean;
    /**
     * Whether the arrow keys move the caret between the editor and the text editor around the
     * embed. The editor opts in with `useEmbedCaretNavigation()`.
     */
    hasCaretNavigation?: boolean;
    /** The rendered content, shown while the content is not edited. */
    preview: HTMLElement;
    /** The editor, loaded on demand, which replaces the preview while `isEditing`. */
    children: ComponentChildren;
}

/** The content of an embed: its preview, replaced by its editor while it is edited. */
export function EditableEmbedContent({
    rootRef, className, isEditing, hasCaretNavigation, preview, children
}: EditableEmbedContentProps) {
    const previewView = <EmbedPreview element={preview} />;

    return (
        <div ref={rootRef} className={className}>
            {isEditing ? (
                <CaretNavigationContext.Provider value={hasCaretNavigation ? rootRef : null}>
                    <Suspense fallback={previewView}>{children}</Suspense>
                </CaretNavigationContext.Provider>
            ) : previewView}
        </div>
    );
}

/**
 * An editor in an embed that the caret enters from the text editor around the embed, and leaves,
 * with the arrow keys. The `ContentEmbedCaret` plugin of a text editor and `CodeMirror` are ones.
 */
export interface EmbeddedCaretEditor {
    /** Focuses the editor with the caret at `edge` of its content. */
    focusAt(edge: EmbedEdge): void;
    /**
     * The edge of the content that the arrow key of `event` moves the caret past, or `null` for
     * any other key, while the caret stays in the content and while a list of the editor, such as
     * its completions, takes the key.
     */
    getEdgeLeftBy(event: KeyboardEvent): EmbedEdge | null;
    /** Runs before the caret leaves the editor past an edge, while the editor has the focus. */
    prepareToLeave?(): void;
}

/**
 * Lets the arrow keys move the caret between `getEditor()`, the editor of an embed, and the text
 * editor around the embed, while its `EditableEmbedContent` has `hasCaretNavigation`.
 * `getEditor()` returns `null` while the editor is not ready.
 */
export function useEmbedCaretNavigation(
    getEditor: () => EmbeddedCaretEditor | null | undefined
) {
    const rootRef = useContext(CaretNavigationContext);
    const getEditorRef = useRef(getEditor);
    getEditorRef.current = getEditor;

    useEffect(() => {
        const root = rootRef?.current;
        if (!root) return;

        // The capture phase runs before the editor handles the key.
        const onKeyDown = (event: KeyboardEvent) => {
            const editor = getEditorRef.current();
            const edge = editor?.getEdgeLeftBy(event);
            if (!editor || !edge) return;

            editor.prepareToLeave?.();
            if (leaveContentEmbed(root, edge)) {
                event.preventDefault();
                event.stopPropagation();
            }
        };
        root.addEventListener("keydown", onKeyDown, { capture: true });
        const unregister = registerEmbedCaretTarget(root, {
            enter(edge) {
                const editor = getEditorRef.current();
                // A collapsed Expandable embed hides its content, so the caret steps over it.
                if (!editor || root.closest("[hidden]")) return false;

                editor.focusAt(edge);
                return true;
            }
        });

        return () => {
            root.removeEventListener("keydown", onKeyDown, { capture: true });
            unregister();
        };
    }, [ rootRef ]);
}

/**
 * The preview of the content of an embed: `initial` while `key` has its first value, otherwise
 * what `render` returns for the current key. The previous preview stays until the next is ready.
 * While `isPaused`, as while the content is edited, no preview renders.
 */
export function useEmbedPreview(
    initial: HTMLElement,
    key: string,
    render: () => Promise<HTMLElement>,
    isPaused = false
) {
    const [ preview, setPreview ] = useState(initial);
    const initialKeyRef = useRef(key);
    const shownKeyRef = useRef(key);

    useEffect(() => {
        if (isPaused || key === shownKeyRef.current) return;

        if (key === initialKeyRef.current) {
            shownKeyRef.current = key;
            setPreview(initial);
            return;
        }

        let isCurrent = true;
        render().then((element) => {
            if (isCurrent) {
                shownKeyRef.current = key;
                setPreview(element);
            }
        });
        return () => {
            isCurrent = false;
        };
    }, [ key, isPaused ]);

    return preview;
}

/**
 * The text editor nested in the split of `ntxId`, such as the editor of an included note, while it
 * holds the focus, for the formatting toolbar to show its buttons. `null` once the editor of the
 * note takes the focus, or the nested editor goes away. Focus elsewhere, such as in the toolbar,
 * changes nothing.
 */
export function useNestedEditor(ntxId: string | null | undefined) {
    const [ editor, setEditor ] = useState<CKTextEditor | null>(null);

    useEffect(() => {
        setEditor(null);
        if (!ntxId) return;

        let stopWatching: (() => void) | undefined;
        const onFocusIn = (event: FocusEvent) => {
            const editable = event.target instanceof Element
                ? event.target.closest<EditorRootElement>(EDITOR_ROOT_SELECTOR)
                : null;
            if (editable?.closest<HTMLElement>("[data-ntx-id]")?.dataset.ntxId !== ntxId) return;

            stopWatching?.();
            stopWatching = undefined;
            const focused = editable.ckeditorInstance;
            if (!focused || !editable.parentElement?.closest(EDITOR_ROOT_SELECTOR)) {
                setEditor(null);
                return;
            }

            const release = () => setEditor(null);
            focused.on("destroy", release);
            stopWatching = () => focused.off("destroy", release);
            setEditor(focused);
        };

        document.addEventListener("focusin", onFocusIn);
        return () => {
            document.removeEventListener("focusin", onFocusIn);
            stopWatching?.();
        };
    }, [ ntxId ]);

    return editor;
}

/**
 * The element in the title row of the embed around `rootRef` that holds the badges of its content,
 * such as the save status of an included note, or `null`. `null` while not `isShown` as well:
 * content mounts before its embed box takes it in, so it looks for the element once it shows.
 */
export function useEmbedBadgeSlot(rootRef: RefObject<HTMLElement | null>, isShown = true) {
    const [ slot, setSlot ] = useState<HTMLElement | null>(null);

    useEffect(() => {
        const wrapper = isShown ? rootRef.current?.closest(".include-note-wrapper") : null;
        setSlot(wrapper?.querySelector<HTMLElement>(
            ":scope > .include-note-title-row > .include-note-badges"
        ) ?? null);
    }, [ rootRef, isShown ]);

    return slot;
}

/**
 * Whether the text editor around `element` shows its buttons in a fixed formatting toolbar,
 * rather than in a floating one.
 */
export function hasFixedToolbarAround(element: HTMLElement | null) {
    return !!findTextEditorAround(element)?.ui.view.toolbar;
}

/** The text editor whose editable root contains `element`, as the editor around an embed. */
export function findTextEditorAround(element: HTMLElement | null) {
    return element?.closest<EditorRootElement>(EDITOR_ROOT_SELECTOR)?.ckeditorInstance;
}

/** The text editor whose editable root is in `element`, as the editor of an included note. */
export function findTextEditorIn(element: HTMLElement | null) {
    return element?.querySelector<EditorRootElement>(EDITOR_ROOT_SELECTOR)?.ckeditorInstance;
}

/** The editable root of a text editor, which CKEditor gives a reference to the editor. */
type EditorRootElement = HTMLElement & { ckeditorInstance?: CKTextEditor };

const EDITOR_ROOT_SELECTOR = ".ck-editor__editable:not(.ck-editor__nested-editable)";

/**
 * The root of the content of an embed whose editor has caret navigation, or `null`. Set by
 * `EditableEmbedContent` for `hasCaretNavigation`, and by content that lays out its own editor,
 * such as `MarkdownEmbed`.
 */
export const CaretNavigationContext = createContext<RefObject<HTMLElement | null> | null>(null);

const EDITABLE_FLAG_TOOLS: ContentEmbedToolProvider = {
    hasEditableFlag: true,
    getTools: () => [],
    execute: () => {},
    subscribe: () => () => {}
};

/**
 * Puts the caret of the text editor around `element` beside its embed, past `edge`. Returns
 * `false` when `element` is in no embed of a text editor.
 */
function leaveContentEmbed(element: HTMLElement, edge: EmbedEdge) {
    const editor = findTextEditorAround(element);
    return !!editor?.plugins.has("ContentEmbedCaret")
        && editor.plugins.get("ContentEmbedCaret").leaveEmbed(element, edge);
}

/** Shows `element`, the rendered content of an embed. */
export function EmbedPreview({ element }: { element: HTMLElement }) {
    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        containerRef.current?.replaceChildren(element);
    }, [ element ]);

    return <div ref={containerRef} className="editable-embed-preview" />;
}

/**
 * Moves the focus to the element that `selector` matches when the embed box around `rootRef`
 * holds it, including when that element renders after the box took the focus.
 */
function useFocusFromEmbedBox(rootRef: RefObject<HTMLElement | null>, selector?: string) {
    useEffect(() => {
        const root = rootRef.current;
        const box = root?.closest<HTMLElement>(".include-note-content");
        if (!root || !box || !selector) return;

        const forwardFocus = () => {
            if (document.activeElement === box) {
                root.querySelector<HTMLElement>(selector)?.focus();
            }
        };
        const observer = new MutationObserver(forwardFocus);
        observer.observe(root, { childList: true, subtree: true });
        box.addEventListener("focus", forwardFocus);
        forwardFocus();
        return () => {
            observer.disconnect();
            box.removeEventListener("focus", forwardFocus);
        };
    }, [ rootRef, selector ]);
}
