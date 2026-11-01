import "./MarkdownEmbed.css";

import type VanillaCodeMirror from "@triliumnext/codemirror";
import moveVerticalIcon from "boxicons/svg/regular/bx-move-vertical.svg?raw";
import clsx from "clsx";
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { CommandNames } from "../../../components/app_context";
import type FAttachment from "../../../entities/fattachment";
import FNote from "../../../entities/fnote";
import type { MenuItem } from "../../../menus/context_menu";
import type { ContentEditor } from "../../../services/content_renderer";
import { isDesktop } from "../../../services/utils";
import { useNoteCodeSettings } from "../../layout/code_menus";
import { useDebouncedValue } from "../../react/hooks";
import { SaveStatus, useEmbedLines, useSavedContent } from "../code/CodeEmbed";
import { EmbedSourcePane } from "../code/CodeEmbedEditor";
import { resolveDisplayMode } from "../helpers/split_editor_mode";
import { SplitLayout, useMountedPanes } from "../helpers/SplitEditor";
import { registerContentEmbedTools, useContentEmbedDisplayMode } from "../text/content_embed_tools";
import { EmbedPreview, useEditableEmbed, useEmbedPreview } from "../text/editable_embed";
import {
    renderWithSourceLines, useMarkdownKeymap, useNoteLinkChips, useSyncedHighlight,
    useSyncedScrolling
} from "./Markdown";

interface MarkdownEmbedProps {
    entity: FNote | FAttachment;
    /** Saves the changes to `entity`, or `undefined` where the content is read-only. */
    editor: ContentEditor | undefined;
    /** The Markdown shown first. */
    content: string;
    /** The rendering of `content`. */
    preview: HTMLElement;
    /** Renders Markdown as `preview` shows it. */
    renderPreview: (content: string) => Promise<HTMLElement>;
}

/**
 * A Markdown note or file in an embed, laid out as the split editor of a Markdown note: its source
 * in CodeMirror, its rendering, or both side by side, as the display mode of the embed picks. The
 * source can be edited while the Editable toggle of the embed is on.
 */
export default function MarkdownEmbed({
    entity, editor, content: initialContent, preview, renderPreview
}: MarkdownEmbedProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<VanillaCodeMirror>(null);
    const [ view, setView ] = useState<VanillaCodeMirror | null>(null);
    const note = entity instanceof FNote ? entity : null;
    const { canEdit, isEditing } = useEditableEmbed(rootRef, {
        editor, note, tools: null, focusTarget: ".cm-content"
    });
    const lines = useEmbedLines(rootRef, note);
    useDisplayModeTools(rootRef, canEdit, lines.menuItems);
    const mode = resolveDisplayMode(useContentEmbedDisplayMode(rootRef), !isEditing);
    const isSourceShown = mode !== "preview";
    const { editorMounted, previewMounted } = useMountedPanes(mode);
    const { tabWidth, useTabs } = useNoteCodeSettings(note);

    const [ content, setContent ] = useState(initialContent);
    useSavedContent(entity, editor, setContent, rootRef);
    const renderedContent = useDebouncedValue(content, PREVIEW_DELAY);
    const shownPreview = useEmbedPreview(
        preview, renderedContent, () => renderPreview(renderedContent)
    );

    const shownView = isSourceShown ? view : null;
    const previewElement = shownPreview instanceof HTMLDivElement ? shownPreview : null;
    useSyncedScrolling(shownView, previewElement);
    useSyncedHighlight(shownView, previewElement, renderedContent);
    useNoteLinkChips(shownView);
    useMarkdownKeymap(isEditing ? shownView : null);

    return (
        <div
            ref={rootRef}
            className={clsx(
                "markdown-embed-content", isSourceShown && "with-source include-note-box-height"
            )}
        >
            <SplitLayout
                mode={mode}
                orientation={isDesktop() ? "horizontal" : "vertical"}
                editor={(
                    <EmbedSourcePane
                        rootRef={rootRef}
                        isEditing={isEditing}
                        isSourceShown={isSourceShown}
                        note={note}
                        ownerNote={entity instanceof FNote ? entity : entity.getNote()}
                        editor={editor}
                        content={content}
                        mime={MARKDOWN_MIME}
                        tabWidth={tabWidth}
                        useTabs={useTabs}
                        wrapLines={lines.wrapLines}
                        hasLineNumbers={lines.hasLineNumbers}
                        viewRef={viewRef}
                        onContentChange={setContent}
                        onReady={setView}
                    />
                )}
                isEditorMounted={editorMounted.current}
                isPreviewMounted={previewMounted.current}
                previewContent={<EmbedPreview element={shownPreview} />}
            />
            {editor && <SaveStatus rootRef={rootRef} editor={editor} isShown={isEditing} />}
        </div>
    );
}

/** The HTML of the Markdown `source`, as the preview of a Markdown note renders it. */
export function renderMarkdownHtml(source: string) {
    return renderWithSourceLines(source).html;
}

/**
 * Offers the display modes of the content in `rootRef` on its embed and its box size as an icon,
 * and the Editable toggle and `menuItems` while `canEdit`.
 */
function useDisplayModeTools(
    rootRef: RefObject<HTMLElement | null>,
    canEdit: boolean,
    menuItems: MenuItem<CommandNames>[]
) {
    const menuItemsRef = useRef(menuItems);
    menuItemsRef.current = menuItems;

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        return registerContentEmbedTools(root, {
            hasEditableFlag: canEdit,
            hasDisplayModes: true,
            boxSizeIcon: moveVerticalIcon,
            getTools: () => [],
            execute: () => {},
            subscribe: () => () => {},
            getMenuItems: () => (canEdit ? menuItemsRef.current : [])
        });
    }, [ rootRef, canEdit ]);
}

/** The language of the source pane. */
const MARKDOWN_MIME = "text/x-markdown";
/** How long the source has to stay unchanged before the preview renders again, in milliseconds. */
const PREVIEW_DELAY = 300;
