import "./editable_embed.css";

import type { CKTextEditor, EmbedEdge } from "@triliumnext/ckeditor5";
import clsx from "clsx";
import { type ComponentChildren, createContext, type RefObject } from "preact";
import { Suspense } from "preact/compat";
import {
    useCallback, useContext, useEffect, useLayoutEffect, useRef, useState
} from "preact/hooks";

import type FNote from "../../../entities/fnote";
import { type ContentEditor, disposeInteractiveContent } from "../../../services/content_renderer";
import options from "../../../services/options";
import { useNoteLabelBoolean } from "../../react/hooks/note";
import {
    type ContentEmbedToolProvider, registerContentEmbedTools, registerEmbedCaretTarget,
    useIsContentEmbedEditable, whenInPage
} from "./content_embed_tools";
import { EDITOR_ROOT_SELECTOR, type EditorRootElement } from "./nested_editor";

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
    /**
     * The editor, loaded on demand, which replaces the preview while `isEditing`, once it calls
     * the callback of `EmbedEditorShownContext`.
     */
    children: ComponentChildren;
}

/**
 * The content of an embed: its preview, replaced by its editor while it is edited. The editor
 * loads out of sight while the preview keeps its place, so that the box keeps its size.
 */
export function EditableEmbedContent({
    rootRef, className, isEditing, hasCaretNavigation, preview, children
}: EditableEmbedContentProps) {
    const [ isEditorShown, setIsEditorShown ] = useState(false);
    const showEditor = useCallback(() => setIsEditorShown(true), []);
    useLayoutEffect(() => {
        if (!isEditing) setIsEditorShown(false);
    }, [ isEditing ]);

    return (
        <div ref={rootRef} className={className}>
            {isEditing && (
                <div className={clsx("editable-embed-editor", !isEditorShown && "loading")}>
                    <CaretNavigationContext.Provider value={hasCaretNavigation ? rootRef : null}>
                        <EmbedEditorShownContext.Provider value={showEditor}>
                            <Suspense fallback={null}>{children}</Suspense>
                        </EmbedEditorShownContext.Provider>
                    </CaretNavigationContext.Provider>
                </div>
            )}
            {/* Hidden while the editor shows: unmounting it disposes of its embed boxes. */}
            <EmbedPreview element={preview} isHidden={isEditing && isEditorShown} />
        </div>
    );
}

/** Called by the editor in an `EditableEmbedContent` once it shows the content. */
export const EmbedEditorShownContext = createContext<() => void>(() => {});

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
    /**
     * The edge of the content that Enter in `event` leaves past, as it leaves a code block, or
     * `null` while the caret stays in the content.
     */
    getEdgeLeftByEnter?(event: KeyboardEvent): EmbedEdge | null;
    /** Removes the blank lines that Enter leaves past at `edge`. */
    removeBlankLinesAt?(edge: EmbedEdge): void;
    /** Whether `event` is Backspace in empty content, which turns a code block into a paragraph. */
    isBackspaceOnEmpty?(event: KeyboardEvent): boolean;
    /** Whether the changes of the editor are steps of the undo stack of the text editor. */
    readonly hasSharedHistory?: boolean;
}

/**
 * Lets the arrow keys move the caret between `getEditor()`, the editor of an embed, and the text
 * editor around the embed, while its `EditableEmbedContent` has `hasCaretNavigation`. With
 * `hasCodeBlockKeys`, Enter and Backspace act as in a code block: Enter past blank lines at an
 * edge of the content starts a paragraph beside the embed, and Backspace in empty content turns
 * the embed into a paragraph. `getEditor()` returns `null` while the editor is not ready.
 */
export function useEmbedCaretNavigation(
    getEditor: () => EmbeddedCaretEditor | null | undefined,
    hasCodeBlockKeys = false
) {
    const rootRef = useContext(CaretNavigationContext);
    const getEditorRef = useRef(getEditor);
    getEditorRef.current = getEditor;
    const hasCodeBlockKeysRef = useRef(hasCodeBlockKeys);
    hasCodeBlockKeysRef.current = hasCodeBlockKeys;

    useEffect(() => {
        const root = rootRef?.current;
        if (!root) return;

        // The capture phase runs before the editor handles the key.
        const onKeyDown = (event: KeyboardEvent) => {
            const editor = getEditorRef.current();
            if (editor && hasCodeBlockKeysRef.current && editor.isBackspaceOnEmpty?.(event)) {
                if (replaceContentEmbedWithParagraph(root, editor)) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }

            const enterEdge = hasCodeBlockKeysRef.current && editor?.getEdgeLeftByEnter?.(event);
            if (editor && enterEdge) {
                if (insertParagraphBesideContentEmbed(root, enterEdge, editor)) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }

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
 * The preview of the content of an embed: `initial` until `key` changes, then what `render`
 * returns for the current key. The previous preview stays until the next is ready. While
 * `isPaused`, as while the content is edited, no preview renders. A preview that is no longer
 * current when it is ready is disposed of; `EmbedPreview` disposes of the ones it showed.
 */
export function useEmbedPreview(
    initial: HTMLElement,
    key: string,
    render: () => Promise<HTMLElement>,
    isPaused = false
) {
    const [ preview, setPreview ] = useState(initial);
    const shownKeyRef = useRef(key);

    useEffect(() => {
        if (isPaused || key === shownKeyRef.current) return;

        let isCurrent = true;
        render().then((element) => {
            if (isCurrent) {
                shownKeyRef.current = key;
                setPreview(element);
            } else {
                disposeInteractiveContent($(element));
            }
        });
        return () => {
            isCurrent = false;
        };
    }, [ key, isPaused ]);

    return preview;
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

/**
 * Whether the text note around `ref` is in Vim mode, which follows it as it turns on and off.
 * `false` in read-only text and until the content is in the page, `undefined` outside a text note.
 */
export function useTextNoteVimMode(ref: RefObject<HTMLElement | null>) {
    const [ isOn, setIsOn ] = useState<boolean | undefined>(false);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        let stopListening: (() => void) | undefined;
        const stopWaiting = whenInPage(element, () => {
            const editor = findTextEditorAround(element);
            if (!editor) {
                setIsOn(element.closest(READ_ONLY_TEXT_SELECTOR) ? false : undefined);
                return;
            }
            if (!editor.plugins.has("TriliumVim")) {
                setIsOn(false);
                return;
            }

            const vim = editor.plugins.get("TriliumVim");
            // `isActive` is still false while a new session sets its first status.
            const update = () => setIsOn(!!vim.status.mode);
            vim.on("change:status", update);
            stopListening = () => vim.off("change:status", update);
            update();
        });
        return () => {
            stopWaiting();
            stopListening?.();
        };
    }, [ ref ]);

    return isOn;
}

/** The text editor whose editable root contains `element`, as the editor around an embed. */
export function findTextEditorAround(element: HTMLElement | null) {
    return element?.closest<EditorRootElement>(EDITOR_ROOT_SELECTOR)?.ckeditorInstance;
}

/** The text editor whose editable root is in `element`, as the editor of an included note. */
export function findTextEditorIn(element: HTMLElement | null) {
    return element?.querySelector<EditorRootElement>(EDITOR_ROOT_SELECTOR)?.ckeditorInstance;
}

/**
 * The root of the content of an embed whose editor has caret navigation, or `null`. Set by
 * `EditableEmbedContent` for `hasCaretNavigation`, and by content that lays out its own editor,
 * such as `MarkdownEmbed`.
 */
export const CaretNavigationContext = createContext<RefObject<HTMLElement | null> | null>(null);

/** The content of a read-only text note, as `ReadOnlyText` renders it. */
const READ_ONLY_TEXT_SELECTOR = ".note-detail-readonly-text-content";

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

/**
 * Removes the blank lines of `embedEditor` at `edge` and puts the caret of the text editor around
 * `element` in a new paragraph beside its embed, in one undo step. Returns `false`, before any
 * change, when no text editor with `ContentEmbedCaret` is around `element`.
 */
function insertParagraphBesideContentEmbed(
    element: HTMLElement, edge: EmbedEdge, embedEditor: EmbeddedCaretEditor
) {
    const editor = findTextEditorAround(element);
    if (!editor?.plugins.has("ContentEmbedCaret")) {
        return false;
    }

    embedEditor.removeBlankLinesAt?.(edge);
    embedEditor.prepareToLeave?.();
    return editor.plugins.get("ContentEmbedCaret")
        .insertParagraphBeside(element, edge, !!embedEditor.hasSharedHistory);
}

/**
 * Puts the caret of the text editor around `element` in an empty paragraph that replaces its
 * embed. Returns `false`, before any change, when no text editor with `ContentEmbedCaret` is
 * around `element`.
 */
function replaceContentEmbedWithParagraph(element: HTMLElement, embedEditor: EmbeddedCaretEditor) {
    const editor = findTextEditorAround(element);
    if (!editor?.plugins.has("ContentEmbedCaret")) {
        return false;
    }

    embedEditor.prepareToLeave?.();
    return editor.plugins.get("ContentEmbedCaret").replaceWithParagraph(element);
}

/**
 * Shows `element`, the rendered content of an embed, and disposes of it once it shows another
 * element or unmounts.
 */
export function EmbedPreview({ element, isHidden = false }: {
    element: HTMLElement;
    isHidden?: boolean;
}) {
    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        containerRef.current?.replaceChildren(element);
        // The embed boxes of the preview are standalone roots, which a parent unmount misses.
        return () => disposeInteractiveContent($(element));
    }, [ element ]);

    return <div ref={containerRef} className="editable-embed-preview" hidden={isHidden} />;
}

/**
 * Moves the focus to the element that `selector` matches when the embed box around `rootRef`
 * holds it, including when that element renders after the box took the focus. The root names
 * `selector` in `data-embed-focus-target`, which `ContentEmbed` focuses as the box mounts.
 * Content rendered apart, such as inline source, finds its box once it joins the page.
 */
function useFocusFromEmbedBox(rootRef: RefObject<HTMLElement | null>, selector?: string) {
    // A layout effect: inline source mounts its embed box right after it renders.
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root || !selector) return;

        root.dataset.embedFocusTarget = selector;
        let stopForwarding: (() => void) | undefined;
        const stopWaiting = whenInPage(root, () => {
            const box = root.closest<HTMLElement>(".include-note-content");
            if (!box) return;

            const forwardFocus = () => {
                if (document.activeElement === box) {
                    root.querySelector<HTMLElement>(selector)?.focus();
                }
            };
            const observer = new MutationObserver(forwardFocus);
            observer.observe(root, { childList: true, subtree: true });
            box.addEventListener("focus", forwardFocus);
            forwardFocus();
            stopForwarding = () => {
                observer.disconnect();
                box.removeEventListener("focus", forwardFocus);
            };
        });
        return () => {
            stopWaiting();
            stopForwarding?.();
            delete root.dataset.embedFocusTarget;
        };
    }, [ rootRef, selector ]);
}
