import "./Markdown.css";
import "./MarkdownCommons.css";

import { revealTab } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";
import VanillaCodeMirror from "@triliumnext/codemirror";
import {
    findWikilinkNoteIds, triliumNoteChips
} from "@triliumnext/codemirror/src/extensions/trilium_note_chips";
import { stripBlockMarkers } from "@triliumnext/commons/src/lib/block_reference";
import {
    CustomMarkdownRenderer, renderToHtml
} from "@triliumnext/commons/src/lib/markdown_renderer";
import { countLineBreaks, walkBlockTokens } from "@triliumnext/commons/src/lib/markdown_source";
import {
    createBlockMarkerExtensions, createLiteralTildeExtension, createTabsExtensions
} from "@triliumnext/commons/src/lib/marked_extensions";
import DOMPurify from "dompurify";
import { Marked, type Token, type Tokens } from "marked";
import { createContext, type RefObject } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import { consumeBlockReference } from "../../../services/block_reference";
import { consumeBookmark } from "../../../services/bookmark_jump";
import keyboard_actions from "../../../services/keyboard_actions";
import note_create from "../../../services/note_create";
import { removeIndividualBinding } from "../../../services/shortcuts";
import { isDesktop } from "../../../services/utils";
import { useTriliumEvent } from "../../react/hooks/events";
import { useLegacyImperativeHandlers } from "../../react/hooks/legacy";
import { useLinkTargetLanding } from "../../react/hooks/note_context";
import {
    extractHighlightsFromStaticHtml, type RawHighlight
} from "../../sidebar/highlights_extract";
import type { HeadingLinks } from "../../sidebar/TableOfContents";
import SplitEditor from "../helpers/SplitEditor";
import { ReadOnlyTextContent } from "../text/ReadOnlyText";
import { TypeWidgetProps } from "../type_widget";
import {
    getMarkdownHeadingTarget, getSavedMarkdownHeadingTarget, revealInSource, useBlockMarkers
} from "./editor_block_references";
import {
    insertDateTime, insertText, replaceSelection, resolveWikilinkChip, showEditLinkDialog,
    showIncludeNoteDialog, uploadImageAndInsert
} from "./editor_utils";

const marked = new Marked({ breaks: true, gfm: true });
// Headings in the outline are rendered by this instance rather than by `renderToHtml`, so it needs
// the same single-tilde handling to stay consistent with the preview body. `renderWithSourceLines`
// pairs its top-level tokens with the rendered blocks, so it also needs every block extension.
marked.use({
    extensions: [
        ...createBlockMarkerExtensions(), createLiteralTildeExtension(), ...createTabsExtensions()
    ]
});

/**
 * The default {@link CustomMarkdownRenderer} falls back to
 * `language-text-x-trilium-auto` on unlabeled fences, which drives
 * `syntax_highlight.ts` into `highlightAuto` — that dynamic-imports every hljs
 * language bundle on first render and runs detection on each block, which is
 * both slow and often wrong on short snippets. For the live preview we instead
 * emit unlabeled fences without a `language-` class so the highlighter skips
 * them entirely.
 */
class MarkdownPreviewRenderer extends CustomMarkdownRenderer {
    override code(token: Tokens.Code): string {
        const html = super.code(token);
        if (token.lang) return html;
        return html.replace(`class="language-text-x-trilium-auto"`, `class="language-text-plain"`);
    }
}

export interface MarkdownTocHeading {
    id: string;
    level: number;
    text: string;
    line: number;
}

/** A formatted run of the rendered note, carrying the source line it came from. */
export interface MarkdownHighlight extends RawHighlight {
    line: number;
}

/** The content last loaded into the widget. */
interface LoadedContent {
    /** The note of `content`, absent before any content loads. */
    noteId?: string;
    content: string;
    /** The blob of `content`, when it was read from the note rather than edited. */
    blobId?: string;
}

interface MarkdownContextValue {
    html: string;
    headings: MarkdownTocHeading[];
    setEditorView: (view: VanillaCodeMirror | null) => void;
    setPreviewEl: (el: HTMLDivElement | null) => void;
}

const MarkdownContext = createContext<MarkdownContextValue | null>(null);

function useMarkdownContext() {
    const ctx = useContext(MarkdownContext);
    if (!ctx) throw new Error("useMarkdownContext must be used within a Markdown component");
    return ctx;
}

export default function Markdown(props: TypeWidgetProps) {
    const [ content, setContent ] = useState("");
    const [ editorView, setEditorView ] = useState<VanillaCodeMirror | null>(null);
    const [ previewEl, setPreviewEl ] = useState<HTMLDivElement | null>(null);
    const { html, headings, highlights } = useMemo(() => renderWithSourceLines(content), [ content ]);
    // The note whose content `content` is: an editor reused for another note keeps the content
    // of the previous one until the new one loads.
    const loadedRef = useRef<LoadedContent>({ content: "" });
    const onContentChanged = useCallback((text: string, blobId?: string) => {
        loadedRef.current = { noteId: props.note.noteId, content: text, blobId };
        setContent(text);
    }, [ props.note.noteId ]);
    const recordHooks = useBlockMarkers(editorView, {
        getNote: () => props.note,
        getNotePath: () => props.noteContext?.notePath,
        getPreview: () => previewEl
    });
    useRevealLinkTarget(props, editorView, previewEl, html, loadedRef);
    const headingLinks = useHeadingLinks(props, editorView, content, loadedRef);

    // Bind text-detail shortcuts (e.g. Ctrl+L for the edit link dialog) to CodeMirror's contentDOM,
    // since the outer `dom` only receives events after CodeMirror has already handled them.
    useEffect(() => {
        if (!editorView || !props.parentComponent) return;
        const $el = $(editorView.contentDOM);
        const bindingPromise = keyboard_actions.setupActionsForElement("text-detail", $el, props.parentComponent, props.ntxId);
        return () => {
            bindingPromise.then(bindings => {
                for (const binding of bindings) {
                    removeIndividualBinding(binding);
                }
            });
        };
    }, [editorView, props.parentComponent, props.ntxId]);

    useSyncedScrolling(editorView, previewEl);
    useSyncedHighlight(editorView, previewEl, html);
    usePublishToc(props.noteContext, editorView, previewEl, headings, props.note, headingLinks);
    usePublishHighlights(props.noteContext, editorView, previewEl, highlights, props.note);
    useImageDrop(props.note, editorView);
    useTextCommands(editorView, () => ({
        noteId: props.note.noteId,
        notePath: props.noteContext?.notePath ?? props.note.getBestNotePathString()
    }));
    useNoteLinkChips(editorView);
    useMarkdownKeymap(editorView);

    const ctx = useMemo<MarkdownContextValue>(
        () => ({ html, headings, setEditorView, setPreviewEl }),
        [ html, headings ]
    );

    return (
        <MarkdownContext.Provider value={ctx}>
            <SplitEditor
                noteType="code"
                {...props}
                editorRef={setEditorView}
                onContentChanged={onContentChanged}
                onDataTaken={recordHooks.onDataTaken}
                dataSaved={recordHooks.dataSaved}
                resolveConflict={recordHooks.resolveConflict}
                previewContent={<MarkdownPreview ntxId={props.ntxId} />}
                forceOrientation={isDesktop() ? "horizontal" : "vertical"}
                allowKeyboardSuggestions
            />
        </MarkdownContext.Provider>
    );
}

function MarkdownPreview({ ntxId }: { ntxId: TypeWidgetProps["ntxId"] }) {
    const { html, setPreviewEl } = useMarkdownContext();
    return (
        <ReadOnlyTextContent
            html={html}
            ntxId={ntxId}
            className="markdown-preview"
            contentRef={setPreviewEl}
            isChanging
        />
    );
}

//#region Link targets
/**
 * Scrolls to the blocks or the anchor that a link to the note points at, once the editor or the
 * preview holds the content of the note: in the source, highlighting its lines; in the preview,
 * flashing the blocks; in a split, the source scrolls first, and the preview reveals the target a
 * frame later, once it has followed.
 */
function useRevealLinkTarget(
    { note, noteContext, ntxId, isVisible }: TypeWidgetProps,
    editorView: VanillaCodeMirror | null,
    previewEl: HTMLDivElement | null,
    html: string,
    loadedRef: RefObject<LoadedContent>
) {
    const reveal = useCallback(() => {
        const viewScope = noteContext?.viewScope;
        if (!viewScope || (!viewScope.block && !viewScope.bookmark)
            || loadedRef.current?.noteId !== note.noteId) {
            return;
        }

        const isPreviewShown = !!previewEl?.clientHeight;
        if (editorView?.scrollDOM.clientHeight) {
            revealInSource(editorView, viewScope, {
                isFlashed: !isPreviewShown, isConsumed: !isPreviewShown
            });
        }
        if (previewEl && isPreviewShown) {
            requestAnimationFrame(() => {
                consumeBookmark(previewEl, viewScope);
                consumeBlockReference(previewEl, viewScope);
            });
        }
    }, [ editorView, previewEl, noteContext, note.noteId, loadedRef ]);

    useLinkTargetLanding({ note, ntxId, isVisible }, reveal, [ html, reveal ]);
}

/**
 * Links to the headings of `content`, for the outline. The note path is the one of the render that
 * lists the headings. A target is `null` once the note, its content or the document of the editor
 * changed since: the outline then lists the headings again.
 */
function useHeadingLinks(
    { note, noteContext }: TypeWidgetProps,
    editorView: VanillaCodeMirror | null,
    content: string,
    loadedRef: RefObject<LoadedContent>
) {
    const notePath = noteContext?.notePath ?? note.getBestNotePathString();
    return useMemo<HeadingLinks>(() => ({
        async getTarget(heading) {
            const { line } = heading as MarkdownTocHeading;
            const loaded = loadedRef.current;
            if (loaded?.noteId !== note.noteId || loaded.content !== content) return null;

            // `ReadOnlyCode` passes its view too, which is read-only and takes no marker.
            if (editorView && !editorView.state.readOnly) {
                return editorView.state.doc.toString() === content
                    ? getMarkdownHeadingTarget(editorView, line, notePath, note.noteId)
                    : null;
            }
            return loaded.blobId
                ? getSavedMarkdownHeadingTarget(note.noteId, notePath, content, line, loaded.blobId)
                : null;
        },
        hasPublicLinks: true
    }), [ note, notePath, editorView, content, loadedRef ]);
}
//#endregion

//#region Table of contents
/**
 * Publishes heading data via `setContextData("toc", ...)` so the sidebar
 * Table of Contents can display headings extracted from the markdown source,
 * independent of whether the preview pane is visible.
 */
function usePublishToc(
    noteContext: NoteContext | undefined,
    editorView: VanillaCodeMirror | null,
    previewEl: HTMLDivElement | null,
    headings: MarkdownTocHeading[],
    note: FNote,
    headingLinks: HeadingLinks
) {
    const publish = useCallback(() => {
        if (!noteContext || noteContext.noteId !== note.noteId) return;
        noteContext.setContextData("toc", {
            headings,
            scrollToHeading(heading) {
                const mdHeading = headings.find(h => h.id === heading.id);
                if (mdHeading) scrollToSourceLine(editorView, previewEl, mdHeading.line);
            },
            headingLinks
        });
    }, [ noteContext, headings, editorView, previewEl, note.noteId, headingLinks ]);

    // Publish when headings or editor change.
    useEffect(() => { publish(); }, [ publish ]);

    // Re-publish after note switches: context data is cleared when the noteId
    // changes, so when our note becomes active again we need to restore it.
    // The noteId guard in publish() prevents overwriting another widget's ToC.
    useTriliumEvent("noteSwitched", ({ noteContext: ctx }) => {
        if (ctx === noteContext) {
            publish();
        }
    });
}

/**
 * Scrolls to the given 1-indexed source line: in the editor when it is on screen, since
 * `useSyncedScrolling` makes the preview follow, otherwise in the preview. In preview mode the
 * editor is either unmounted or hidden.
 */
export function scrollToSourceLine(editorView: VanillaCodeMirror | null, previewEl: HTMLElement | null, lineNumber: number) {
    if (editorView && editorView.scrollDOM.clientHeight > 0) {
        scrollEditorToLine(editorView, lineNumber);
        return;
    }

    if (!previewEl) return;
    const block = findActiveBlock(previewEl.querySelectorAll<HTMLElement>("[data-source-line]"), lineNumber);
    block?.scrollIntoView({ block: "start", behavior: "smooth" });
}

/** Scrolls the source editor so the given 1-indexed line sits in the middle of the viewport. */
function scrollEditorToLine(editorView: VanillaCodeMirror, lineNumber: number) {

    const line = editorView.state.doc.line(Math.min(lineNumber, editorView.state.doc.lines));
    const lineBlock = editorView.lineBlockAt(line.from);
    const scrollerHeight = editorView.scrollDOM.clientHeight;
    const targetTop = lineBlock.top - scrollerHeight / 2 + lineBlock.height / 2;

    editorView.scrollDOM.scrollTo({ top: targetTop, behavior: "smooth" });
}
//#endregion

//#region Highlights
/**
 * Publishes the note's formatted runs via `setContextData("highlights", ...)`, the same way the
 * table of contents is published, so the sidebar's Highlights list works for Markdown notes
 * without needing to know how they are rendered.
 */
function usePublishHighlights(
    noteContext: NoteContext | undefined,
    editorView: VanillaCodeMirror | null,
    previewEl: HTMLDivElement | null,
    highlights: MarkdownHighlight[],
    note: FNote
) {
    const publish = useCallback(() => {
        if (!noteContext || noteContext.noteId !== note.noteId) return;
        noteContext.setContextData("highlights", {
            highlights,
            scrollToHighlight(highlight) {
                const mdHighlight = highlights.find(h => h.id === highlight.id);
                if (mdHighlight) scrollToSourceLine(editorView, previewEl, mdHighlight.line);
            }
        });
    }, [ noteContext, highlights, editorView, previewEl, note.noteId ]);

    useEffect(() => { publish(); }, [ publish ]);

    // Context data is cleared when the note changes, so restore it when ours becomes active
    // again — the noteId guard in publish() keeps it from overwriting another note's list.
    useTriliumEvent("noteSwitched", ({ noteContext: ctx }) => {
        if (ctx === noteContext) {
            publish();
        }
    });
}
//#endregion

//#region Synced scrolling
/**
 * One-directional (editor → preview) scroll sync. On editor scroll, finds the
 * top visible source line via the CodeMirror `EditorView`, then scrolls the
 * preview so the block tagged with that line is at the top — interpolating to
 * the next block for smoothness.
 */
export function useSyncedScrolling(view: VanillaCodeMirror | null, preview: HTMLDivElement | null) {
    useEffect(() => {
        if (!view || !preview) return;

        const scroller = view.scrollDOM;

        function onScroll() {
            if (!view || !preview) return;
            const topLine = view.state.doc.lineAt(view.lineBlockAtHeight(scroller.scrollTop).from).number;

            const blocks = preview.querySelectorAll<HTMLElement>("[data-source-line]");
            if (!blocks.length) return;

            let before: HTMLElement | null = null;
            let after: HTMLElement | null = null;
            for (const el of blocks) {
                const l = parseInt(el.dataset.sourceLine!, 10);
                if (l <= topLine) before = el;
                else { after = el; break; }
            }

            if (!before) { preview.scrollTop = 0; return; }

            const previewTop = preview.getBoundingClientRect().top - preview.scrollTop;
            const beforeOffset = before.getBoundingClientRect().top - previewTop;
            const beforeLine = parseInt(before.dataset.sourceLine!, 10);

            if (!after) { preview.scrollTop = beforeOffset; return; }

            const afterOffset = after.getBoundingClientRect().top - previewTop;
            const afterLine = parseInt(after.dataset.sourceLine!, 10);
            const ratio = (topLine - beforeLine) / (afterLine - beforeLine);
            preview.scrollTop = beforeOffset + (afterOffset - beforeOffset) * ratio;
        }

        scroller.addEventListener("scroll", onScroll, { passive: true });
        return () => scroller.removeEventListener("scroll", onScroll);
    }, [ view, preview ]);
}

/**
 * Marks the preview block that corresponds to the editor's active line, matching the built-in
 * `cm-activeLine` behavior. Re-runs when the rendered HTML changes so newly inserted blocks pick
 * up the current cursor position.
 *
 * The marker is painted as the preview's background (see `Markdown.css`), so its geometry has to
 * be measured here. Every block is observed for resize, since a block that grows after render —
 * a mermaid diagram, an image, an embedded note — shifts everything below it.
 */
export function useSyncedHighlight(view: VanillaCodeMirror | null, preview: HTMLDivElement | null, html: string) {
    useEffect(() => {
        if (!view || !preview) return;

        let current: HTMLElement | null = null;

        function update(revealCursorTab: boolean) {
            if (!view || !preview) return;
            const activeLine = view.state.doc.lineAt(view.state.selection.main.head).number;
            if (revealCursorTab) revealTabAtLine(preview, activeLine);
            const blocks = preview.querySelectorAll<HTMLElement>("[data-source-line]");
            const match = findActiveBlock(blocks, activeLine);

            // Animate from one block to the next, but not into or out of nothing: with no
            // marker to move from, a transition reads as the bar growing out of the top edge.
            const moving = !!current && !!match && current !== match;
            preview.classList.toggle("markdown-preview-marker-moving", moving);
            current = match;
            placePreviewMarker(preview, match);
        }

        // A resize leaves the tabs alone, so a tab picked in the preview stays shown.
        update(true);
        const observer = new ResizeObserver(() => update(false));
        observer.observe(preview);
        for (const block of preview.children) observer.observe(block);

        const unsubscribe = view.addUpdateListener((v) => {
            if (v.selectionSet || v.docChanged) update(true);
        });
        return () => {
            observer.disconnect();
            unsubscribe();
        };
    }, [ view, preview, html ]);
}

/** Writes the geometry of the marker of `block`, the active block, for `Markdown.css` to draw. */
export function placePreviewMarker(preview: HTMLElement, block: HTMLElement | null) {
    // `offsetTop` and the marker's containing block are both the preview's padding box.
    preview.style.setProperty("--markdown-preview-marker-top", `${block?.offsetTop ?? 0}px`);
    preview.style.setProperty("--markdown-preview-marker-height", `${block?.offsetHeight ?? 0}px`);

    // An aside can be far from the gutter, so its marker is beside the aside.
    if (block?.matches("aside:not(.admonition)")) {
        preview.style.setProperty("--markdown-preview-marker-left", `${block.offsetLeft}px`);
    } else {
        preview.style.removeProperty("--markdown-preview-marker-left");
    }
}

/**
 * Shows the tab that `line` falls in, nested tabs included: the last tab whose header starts at or
 * before `line` within the top-level block that holds it. A line outside every tabs block leaves the
 * tabs as they are.
 */
export function revealTabAtLine(preview: HTMLElement, line: number) {
    const block = findActiveBlock(preview.querySelectorAll<HTMLElement>(":scope > [data-source-line]"), line);
    let match: HTMLElement | null = null;
    for (const tab of block?.querySelectorAll<HTMLElement>("section.trilium-tab") ?? []) {
        if (Number(tab.dataset.tabSourceLine) <= line) match = tab;
    }
    if (match) revealTab(match);
}

/** The last block that starts at or before `activeLine`, i.e. the one the cursor sits in. */
export function findActiveBlock(blocks: ArrayLike<HTMLElement>, activeLine: number) {
    let match: HTMLElement | null = null;
    for (const block of Array.from(blocks)) {
        if (Number(block.dataset.sourceLine) <= activeLine) match = block;
        else break;
    }
    return match;
}

//#region Text commands
/**
 * Handles text-detail commands for the Markdown editor:
 * - Add Link (Ctrl+L): opens the edit link dialog, inserts markdown link syntax
 * - Insert Date/Time (Alt+T): inserts a formatted date/time string
 */
function useTextCommands(
    editorView: VanillaCodeMirror | null,
    getOwnNote: () => { noteId: string; notePath: string }
) {
    useLegacyImperativeHandlers({
        addLinkToTextCommand() {
            if (editorView) showEditLinkDialog(editorView, getOwnNote());
        },

        insertDateTimeToTextCommand() {
            if (editorView) insertDateTime(editorView);
        },

        addIncludeNoteToTextCommand() {
            if (editorView) showIncludeNoteDialog(editorView);
        },

        async cutIntoNoteCommand() {
            if (!editorView) return;

            const { from, to } = editorView.state.selection.main;
            if (from === to) return;

            const selectedText = editorView.state.sliceDoc(from, to);

            // Extract first heading as title, if present.
            const headingMatch = selectedText.match(/^(#{1,6})\s+(.+)$/m);
            const title = headingMatch ? stripBlockMarkers(headingMatch[2]).trim() : null;
            const content = headingMatch
                ? selectedText.replace(headingMatch[0], "").trim()
                : selectedText;

            const note = appContext.tabManager.getActiveContextNote();
            const parentNotePath = appContext.tabManager.getActiveContextNotePath();
            if (!note || !parentNotePath) return;

            const result = await note_create.createNote(parentNotePath, {
                isProtected: note.isProtected,
                title,
                content,
                type: "code",
                mime: "text/x-markdown",
                activate: false
            });

            if (result?.note) {
                // Replace selection with a wiki-link to the new note.
                replaceSelection(editorView, `[[${result.note.noteId}]]`, from, to);
            }
        }
    });
}
//#endregion

//#region Markdown keymap
/**
 * Adds markdown-specific formatting shortcuts (bold, italic, strikethrough, math).
 * Toggles the wrapper around the selection, or inserts it at the cursor.
 */
/**
 * Draws the `[[noteId]]` links as chips with the note's icon and title, as the search field draws
 * its note ids, showing a link's text while the selection touches it so it stays editable.
 */
export function useNoteLinkChips(editorView: VanillaCodeMirror | null) {
    useEffect(() => {
        if (!editorView) return;

        editorView.setNamedExtension("noteLinkChips", triliumNoteChips(resolveWikilinkChip, {
            find: findWikilinkNoteIds,
            revealAtSelection: true
        }));
        return () => editorView.setNamedExtension("noteLinkChips", []);
    }, [editorView]);
}

export function useMarkdownKeymap(editorView: VanillaCodeMirror | null) {
    useEffect(() => {
        if (!editorView) return;

        function toggleWrap(wrapper: string): boolean {
            if (!editorView) return false;
            const { from, to } = editorView.state.selection.main;
            const len = wrapper.length;

            if (from === to) {
                // No selection — insert wrapper pair and place cursor inside.
                const text = `${wrapper}${wrapper}`;
                editorView.dispatch({
                    changes: { from, insert: text },
                    selection: { anchor: from + len }
                });
                return true;
            }

            const selected = editorView.state.sliceDoc(from, to);

            // If already wrapped, unwrap.
            if (selected.startsWith(wrapper) && selected.endsWith(wrapper) && selected.length >= len * 2) {
                const inner = selected.slice(len, -len);
                replaceSelection(editorView, inner, from, to);
                return true;
            }

            // Also check if the wrapper is outside the selection.
            const before = editorView.state.sliceDoc(from - len, from);
            const after = editorView.state.sliceDoc(to, to + len);
            if (before === wrapper && after === wrapper) {
                editorView.dispatch({
                    changes: [
                        { from: from - len, to: from },
                        { from: to, to: to + len }
                    ],
                    selection: { anchor: from - len, head: to - len }
                });
                return true;
            }

            // Wrap selection.
            const wrapped = `${wrapper}${selected}${wrapper}`;
            replaceSelection(editorView, wrapped, from, to);
            // Re-select just the inner text.
            editorView.dispatch({ selection: { anchor: from + len, head: to + len } });
            return true;
        }

        const bindings: Record<string, string> = {
            "b": "**",
            "i": "*",
            "m": "$"
        };
        const shiftBindings: Record<string, string> = {
            "x": "~~"
        };

        function onKeydown(e: KeyboardEvent) {
            const mod = e.ctrlKey || e.metaKey;
            if (!mod) return;

            const key = e.key.toLowerCase();
            const wrapper = e.shiftKey ? shiftBindings[key] : bindings[key];
            if (!wrapper) return;

            e.preventDefault();
            e.stopPropagation();
            toggleWrap(wrapper);
        }

        editorView.contentDOM.addEventListener("keydown", onKeydown, true);
        return () => editorView.contentDOM.removeEventListener("keydown", onKeydown, true);
    }, [editorView]);
}
//#endregion

//#region Image upload
/**
 * Handles drag-and-drop and paste of images into the CodeMirror editor.
 * Uploads the image as an attachment and inserts markdown image syntax at the cursor.
 */
function useImageDrop(note: FNote, editorView: VanillaCodeMirror | null) {
    useEffect(() => {
        if (!editorView) return;

        const dom = editorView.dom;

        function handleDrop(e: DragEvent) {
            const files = e.dataTransfer?.files;
            if (!files?.length) return;

            const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
            if (!imageFiles.length || !editorView) return;

            e.preventDefault();
            e.stopPropagation();

            const dropPos = editorView.posAtCoords({ x: e.clientX, y: e.clientY }) ?? undefined;
            for (const file of imageFiles) {
                uploadImageAndInsert(editorView!, note, file, dropPos);
            }
        }

        function handlePaste(e: ClipboardEvent) {
            const items = e.clipboardData?.items;
            if (!items) return;

            // Check for HTML containing attachment image references (e.g. from "Copy link to clipboard").
            const html = e.clipboardData?.getData("text/html");
            if (html) {
                const imgMatch = html.match(/<img[^>]+src="([^"]*)(api\/attachments\/[a-zA-Z0-9_]+\/image\/[^"?]+)/);
                if (imgMatch && editorView) {
                    e.preventDefault();
                    const src = imgMatch[2];
                    const alt = html.match(/<img[^>]+alt="([^"]*)"/)?.[1] ?? "image";
                    insertText(editorView, `![${alt}](${src})`);
                    return;
                }
            }

            // Check for pasted image files (e.g. screenshot paste).
            const imageFiles: File[] = [];
            for (const item of items) {
                if (item.type.startsWith("image/")) {
                    const file = item.getAsFile();
                    if (file) imageFiles.push(file);
                }
            }

            if (!imageFiles.length) return;

            e.preventDefault();
            for (const file of imageFiles) {
                uploadImageAndInsert(editorView!, note, file);
            }
        }

        function handleDragOver(e: DragEvent) {
            if (e.dataTransfer?.types.includes("Files")) {
                e.preventDefault();
            }
        }

        dom.addEventListener("drop", handleDrop);
        dom.addEventListener("paste", handlePaste);
        dom.addEventListener("dragover", handleDragOver);

        return () => {
            dom.removeEventListener("drop", handleDrop);
            dom.removeEventListener("paste", handlePaste);
            dom.removeEventListener("dragover", handleDragOver);
        };
    }, [editorView, note]);
}
//#endregion

/** Token types the parser emits but which don't produce top-level block HTML. */
const NON_RENDERED_TOKENS = new Set([ "space", "def", "blockMarkerLine" ]);

/**
 * Render markdown and tag each top-level block with its 1-indexed source line,
 * so the preview can be scrolled to match the editor. Uses the shared
 * `renderToHtml` pipeline (admonitions, math, tables, etc.) with DOMPurify for
 * sanitization, then walks the rendered DOM and pairs each top-level child
 * with the matching lexer token's start line. Marked does not emit source
 * positions (markedjs/marked#1267) so we count newlines in `raw` ourselves.
 */
export function renderWithSourceLines(src: string): {
    html: string;
    headings: MarkdownTocHeading[];
    highlights: MarkdownHighlight[];
} {
    const tokens = marked.lexer(src);
    const lines = getBlockLines(tokens);
    const headings: MarkdownTocHeading[] = [];
    let line = 1;
    let headingIdx = 0;
    for (const token of tokens) {
        const startLine = line;
        line += countLineBreaks(token.raw);
        if (token.type === "heading") {
            const rawText = token.text ?? "";
            const inlineHtml = DOMPurify.sanitize(marked.parseInline(rawText) as string).trim();
            headings.push({
                id: `md-heading-${headingIdx++}`,
                level: (token as { depth: number }).depth,
                text: inlineHtml,
                line: startLine
            });
        }
    }

    const html = renderToHtml(src, "", {
        sanitize: (h) => DOMPurify.sanitize(h),
        wikiLink: { formatHref: (id) => `#root/${id}` },
        demoteH1: false,
        renderer: new MarkdownPreviewRenderer({ async: false })
    });
    if (!html) return { html: "", headings, highlights: [] };

    const container = document.createElement("div");
    container.innerHTML = html;

    // The line goes on the block itself rather than on a wrapper, so blocks stay direct
    // siblings and the .ck-content sibling rules (e.g. collapsible runs) keep matching.
    const children = Array.from(container.children);
    for (let i = 0; i < children.length; i++) {
        const sourceLine = lines[i] ?? lines[lines.length - 1] ?? 1;
        children[i].setAttribute("data-source-line", String(sourceLine));
    }

    // A separate attribute: the scroll sync and the active-line marker measure every
    // `[data-source-line]` element, and a hidden tab has no geometry.
    const tabLines = collectTabLines(tokens);
    const tabs = container.querySelectorAll<HTMLElement>("section.trilium-tab");
    if (tabs.length === tabLines.length) {
        for (const [ index, tab ] of tabs.entries()) {
            tab.dataset.tabSourceLine = String(tabLines[index]);
        }
    }

    return { html: container.innerHTML, headings, highlights: extractHighlights(container) };
}

/**
 * Returns the 1-indexed line of every top-level element of the preview, in order. Raw HTML can
 * open an element that the next tokens render inside, such as `<aside>` or `<details>` around
 * Markdown, and one HTML token can render several elements or none. So the tokens are parsed as
 * HTML: a marker with the line, then the token's HTML, or a `<p>` for a token of another type.
 */
function getBlockLines(tokens: Token[]): number[] {
    let outline = "";
    let line = 1;
    for (const token of tokens) {
        if (!NON_RENDERED_TOKENS.has(token.type)) {
            const block = token.type === "html" ? token.raw : "<p></p>";
            outline += `<div ${LINE_MARKER}="${line}"></div>${block}`;
        }
        line += countLineBreaks(token.raw);
    }

    // A template parses its content without loading the images of the raw HTML.
    const template = document.createElement("template");
    template.innerHTML = DOMPurify.sanitize(outline);

    const lines: number[] = [];
    let blockLine = 1;
    for (const element of template.content.children) {
        const markerLine = element.getAttribute(LINE_MARKER);
        if (markerLine) {
            blockLine = Number(markerLine);
        } else {
            lines.push(blockLine);
        }
    }
    return lines;
}

const LINE_MARKER = "data-line-marker";

/**
 * Returns the 1-indexed line of every tab header, in the order of the rendered
 * `section.trilium-tab` elements; inside a list or a block quote the lines are approximate.
 */
function collectTabLines(tokens: Token[]): number[] {
    const lines: number[] = [];
    walkBlockTokens(tokens, (token, line) => {
        if (token.type === "tab") lines.push(line);
    });
    return lines;
}

/**
 * The note's formatted runs, read off the rendered preview rather than the Markdown source: by
 * this point `**bold**` is a `<strong>` like any other, so the sidebar's own extractor applies
 * unchanged — and `==highlight==`, which renders as a coloured span, is picked up too.
 *
 * Each run is traced back to the source line of the block it sits in (the attribute tagged on
 * just above), so clicking it scrolls whichever pane is on screen (`scrollToSourceLine`).
 */
function extractHighlights(container: HTMLElement): MarkdownHighlight[] {
    return extractHighlightsFromStaticHtml(container).map(({ element, ...highlight }, index) => ({
        ...highlight,
        // Stable across re-renders, unlike the random id the extractor assigns: the list is
        // rebuilt on every keystroke and would otherwise remount each item every time.
        id: `md-highlight-${index}`,
        line: Number(element.closest("[data-source-line]")?.getAttribute("data-source-line")) || 1
    }));
}
//#endregion
