import type { CKTextEditor } from "@triliumnext/ckeditor5";
import { type ComponentChildren, createContext, type RefObject } from "preact";
import { Suspense } from "preact/compat";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import type { ContentEditor } from "../../../services/content_renderer";
import options from "../../../services/options";
import { useNoteLabelBoolean } from "../../react/hooks";
import {
    type ContentEmbedToolProvider, registerContentEmbedTools, useIsContentEmbedEditable
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
    /** The rendered content, shown while the content is not edited. */
    preview: HTMLElement;
    /** The editor, loaded on demand, which replaces the preview while `isEditing`. */
    children: ComponentChildren;
}

/** The content of an embed: its preview, replaced by its editor while it is edited. */
export function EditableEmbedContent({
    rootRef, className, isEditing, preview, children
}: EditableEmbedContentProps) {
    const previewView = <EmbedPreview element={preview} />;

    return (
        <div ref={rootRef} className={className}>
            {isEditing ? <Suspense fallback={previewView}>{children}</Suspense> : previewView}
        </div>
    );
}

/**
 * The preview of the content of an embed: `initial` while `key` has its first value, otherwise
 * what `render` returns for the current key. The previous preview stays until the next is ready.
 */
export function useEmbedPreview(
    initial: HTMLElement,
    key: string,
    render: () => Promise<HTMLElement>
) {
    const [ preview, setPreview ] = useState(initial);
    const initialKeyRef = useRef(key);

    useEffect(() => {
        if (key === initialKeyRef.current) {
            setPreview(initial);
            return;
        }

        let isCurrent = true;
        render().then((element) => {
            if (isCurrent) {
                setPreview(element);
            }
        });
        return () => {
            isCurrent = false;
        };
    }, [ key ]);

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

/** The editable root of a text editor, which CKEditor gives a reference to the editor. */
type EditorRootElement = HTMLElement & { ckeditorInstance?: CKTextEditor };

const EDITOR_ROOT_SELECTOR = ".ck-editor__editable:not(.ck-editor__nested-editable)";

const EDITABLE_FLAG_TOOLS: ContentEmbedToolProvider = {
    hasEditableFlag: true,
    getTools: () => [],
    execute: () => {},
    subscribe: () => () => {}
};

function EmbedPreview({ element }: { element: HTMLElement }) {
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
