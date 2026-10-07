import "./EditableText.css";
import "./LinkEmbed.css";

import {
    type AttachmentLinkChange,
    CKTextEditor,
    EditorWatchdog,
    type FileUploadData,
    type FileUploadEvent,
    SnippetDefinition
} from "@triliumnext/ckeditor5";
import { deferred, formatBlockRange, parseBlockRange } from "@triliumnext/commons";
import { createPortal } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import {
    consumeBlockReference, copyBlockReference, openBlockHandleMenu
} from "../../../services/block_reference";
import { consumeBookmark } from "../../../services/bookmark_jump";
import { getUploadBoxSize } from "../../../services/content_renderer";
import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import link, { parseNavigationStateFromUrl } from "../../../services/link";
import type LoadResults from "../../../services/load_results";
import note_create from "../../../services/note_create";
import options from "../../../services/options";
import { consumeSearchTerms } from "../../../services/search_jump";
import toast from "../../../services/toast";
import utils, { isMobile } from "../../../services/utils";
import type { IconPickerOpts } from "../../dialogs/icon_picker";
import {
    useEditorSpacedUpdate, useLegacyImperativeHandlers, useNoteLabel, useSameNoteSwitch,
    useSearchTermsConsumer, useTriliumEvent, useTriliumOption, useTriliumOptionBool
} from "../../react/hooks";
import IconPicker from "../../react/IconPicker";
import { setEditorNoteId } from "../../react/NoteStore";
import { TypeWidgetProps } from "../type_widget";
import AttachmentSaves, { useNoteEditor } from "./attachment_saves";
import CKEditorWithWatchdog, { CKEditorApi, NotificationEventData, NotificationEventInfo } from "./CKEditorWithWatchdog";
import { getContentEmbedTools } from "./content_embed_tools";
import { useEmbedEditors } from "./editable_embed";
import getTemplates, { updateTemplateCache } from "./snippets.js";
import linkEmbedService from "../../../services/link_embed";
import { usesClassicToolbar } from "./toolbar";
import {
    getAttachmentHref,
    loadEmbeddedAttachment,
    loadEmbeddedNote,
    openContentEmbedMenu,
    refreshEmbeddedNote,
    setupImageOpening,
    watchContentEmbeds
} from "./utils";

/**
 * The editor can operate into two distinct modes:
 *
 * - Ballon block mode, in which there is a floating toolbar for the selected text, but another floating button for the entire block (i.e. paragraph).
 * - Decoupled mode, in which the editing toolbar is actually added on the client side (in {@link ClassicEditorToolbar}), see https://ckeditor.com/docs/ckeditor5/latest/examples/framework/bottom-toolbar-editor.html for an example on how the decoupled editor works.
 */
interface EditableTextProps extends TypeWidgetProps {
    /** The blocks of the note to edit instead of the whole note, a `block` link parameter. */
    block?: string;
    /** Receives the blocks that the editor of `block` holds, each time they change. */
    onBlockChange?: (block: string) => void;
}

export default function EditableText({
    note, parentComponent, ntxId, noteContext, block, onBlockChange
}: EditableTextProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<string>("");
    /** The note `contentRef` holds the content of, so a restarted editor can be marked as holding it. */
    const contentNoteIdRef = useRef<string | undefined>(undefined);
    const pendingAttachmentChangesRef = useRef<PendingAttachmentChanges | undefined>(undefined);
    /** The attachment whose embed takes the focus when it renders next. */
    const focusedAttachmentIdRef = useRef<string | undefined>(undefined);
    const watchdogRef = useRef<EditorWatchdog>(null);
    const stopWatchingEmbedsRef = useRef<(() => void) | undefined>(undefined);
    const editorApiRef = useRef<CKEditorApi>(null);
    /** The open icon picker request and its balloon container, or `null` when none is open. */
    const [ iconPickerRequest, setIconPickerRequest ] = useState<IconPickerOpts & { container: HTMLElement } | null>(null);
    const [ language ] = useNoteLabel(note, "language");
    const [ textNoteEditorType ] = useTriliumOption("textNoteEditorType");
    const [ codeBlockWordWrap ] = useTriliumOptionBool("codeBlockWordWrap");
    const [ codeBlockTabWidth ] = useTriliumOption("codeBlockTabWidth");
    const isClassicEditor = usesClassicToolbar({
        floatingToolbarRequested: noteContext?.viewScope?.floatingToolbar,
        isMobile: isMobile(),
        textNoteEditorType
    });
    const initialized = useRef(deferred<void>());
    const [ reportBlocks ] = useState(() => (block !== undefined && onBlockChange
        ? watchEditorBlocks(block, onBlockChange)
        : undefined));
    const [ attachmentSaves ] = useState(() =>
        new AttachmentSaves(() => spacedUpdate.scheduleUpdate()));
    const noteEditor = useNoteEditor(noteContext);
    const { noteEditor: embedNoteEditor, attachmentEditor: embedAttachmentEditor } =
        useEmbedEditors({ noteEditor, attachmentEditor: attachmentSaves });
    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteContext,
        noteType: "text",
        block,
        getData() {
            const editor = watchdogRef.current?.editor;
            if (!editor) {
                // There is nothing to save, most likely a result of the editor crashing and reinitializing.
                return;
            }

            const attachments = attachmentSaves.collect();
            const savedAttachments = attachments.length ? { attachments } : {};
            if (block !== undefined) {
                return { ...getBlockData(editor as CKTextEditor, block), ...savedAttachments };
            }

            const content = editor.getData() ?? "";
            // if content is only tags/whitespace (typically <p>&nbsp;</p>), then just make it empty,
            // this is important when setting a new note to code
            return {
                content: utils.isHtmlEmpty(content) ? "" : content,
                ...savedAttachments
            };
        },
        onContentChange(newContent) {
            attachmentSaves.setNoteId(note?.noteId);
            contentRef.current = newContent;
            contentNoteIdRef.current = note?.noteId;
            const editor = watchdogRef.current?.editor;
            if (editor && note) {
                setEditorNoteId(editor, note.noteId);
            }
            editor?.setData(newContent);
            if (editor && note) {
                const textEditor = editor as CKTextEditor;
                applyPendingAttachmentChanges(textEditor, note.noteId, pendingAttachmentChangesRef);
            }

            // Jump to the first search match when navigated from search results.
            consumeSearchTerms(noteContext, ntxId, initialized.current);

            // Scroll to the bookmark or the blocks a link points at.
            const viewScope = noteContext?.viewScope;
            if (viewScope?.bookmark || viewScope?.block) {
                requestAnimationFrame(revealLinkTarget);
            }
        },
        dataSaved(savedData) {
            // Store back the saved data in order to retrieve it in case the CKEditor crashes.
            contentRef.current = savedData.content;
            contentNoteIdRef.current = note?.noteId;
            attachmentSaves.markSaved(savedData.attachments);
        }
    });
    const templates = useTemplates();

    useSearchTermsConsumer(note, noteContext, ntxId);
    useSameNoteSwitch(note, ntxId, () => {
        if (contentNoteIdRef.current === note?.noteId) {
            revealLinkTarget();
        }
    });

    function revealLinkTarget() {
        const root = watchdogRef.current?.editor?.editing.view.getDomRoot();
        consumeBookmark(root, noteContext?.viewScope);
        consumeBlockReference(root, noteContext?.viewScope);
    }

    useTriliumEvent("scrollToEnd", () => {
        const editor = watchdogRef.current?.editor;
        if (!editor) return;

        editor.model.change((writer) => {
            const rootItem = editor.model.document.getRoot();
            if (rootItem) {
                writer.setSelection(writer.createPositionAt(rootItem, "end"));
            }
        });
        editor.editing.view.focus();
    });

    useTriliumEvent("focusOnDetail", async ({ ntxId: eventNtxId, insertNewlineAtTop }) => {
        if (eventNtxId !== ntxId) return;
        const editor = await waitForEditor() as CKTextEditor | undefined;
        if (!editor) return;
        if (insertNewlineAtTop) {
            placeCursorInNewTopParagraph(editor);
        }
        editor.editing.view.focus();
    });

    useLegacyImperativeHandlers({
        addLinkToTextCommand() {
            if (!editorApiRef.current) return;
            parentComponent?.triggerCommand("showAddLinkDialog", {
                text: editorApiRef.current.getSelectedText(),
                hasSelection: editorApiRef.current.hasSelection(),
                async addLink(notePath, linkTitle, externalLink) {
                    await waitForEditor();
                    return editorApiRef.current?.addLink(notePath, linkTitle, externalLink);
                }
            });
        },
        pasteMarkdownIntoTextCommand() {
            if (!editorApiRef.current) return;
            parentComponent?.triggerCommand("showPasteMarkdownDialog", {
                editorApi: editorApiRef.current,
            });
        },
        // CKEditor creates and positions the balloon; `IconPicker` renders into its container.
        // On mobile, `showIconPickerDialog` opens the picker in a modal instead.
        showIconPicker(request: IconPickerOpts & { container: HTMLElement }) {
            if (isMobile()) {
                parentComponent?.triggerCommand("showIconPickerDialog", { onSelect: request.onSelect });
                return null;
            }

            setIconPickerRequest(request);
            return () => setIconPickerRequest(null);
        },
        formatDateTime(date: Date, format?: string) {
            return utils.formatDateTime(date, format ?? options.get("customDateTimeFormat"));
        },
        // Keyboard shortcut
        async insertDateTimeToTextCommand() {
            const editor = await waitForEditor();
            editor?.execute("insertDateTimeToText");
        },
        // Include note functionality note
        addIncludeNoteToTextCommand() {
            if (!editorApiRef.current) return;
            parentComponent?.triggerCommand("showContentEmbedDialog", {
                editorApi: editorApiRef.current,
            });
        },
        loadEmbeddedNote(
            noteId: string,
            $el: JQuery<HTMLElement>,
            boxSize?: string,
            embedBlock?: string,
            onBlockChange?: (block: string) => void
        ) {
            return loadEmbeddedNote(noteId, $el, boxSize, {
                noteEditor: embedNoteEditor,
                block: embedBlock,
                onBlockChange
            });
        },
        loadEmbeddedAttachment(attachmentId: string, $el: JQuery<HTMLElement>, boxSize?: string) {
            const isFocused = focusedAttachmentIdRef.current === attachmentId;
            if (isFocused) {
                focusedAttachmentIdRef.current = undefined;
            }
            return loadEmbeddedAttachment(attachmentId, $el, boxSize, {
                attachmentEditor: embedAttachmentEditor,
                isFocused
            });
        },
        focusContentEmbed(attachmentId: string) {
            focusedAttachmentIdRef.current = attachmentId;
        },
        getAttachmentHref,
        getNoteId() {
            return note.noteId;
        },
        getEmbedBoxSize: getUploadBoxSize,
        openContentEmbedMenu,
        openBlockHandleMenu(event: MouseEvent, count: number) {
            const editor = watchdogRef.current?.editor as CKTextEditor | undefined;
            if (!editor) return;

            const notePath = noteContext?.notePath ?? `root/${note.noteId}`;
            openBlockHandleMenu(event, count, async () => {
                await copyBlockReference(editor, notePath, note.title);
                // Saved now, so that the link resolves in other notes at once.
                spacedUpdate.updateNowIfNecessary();
            });
        },
        getContentEmbedTools,
        // Link preview functionality. The insert flow itself lives in the editor (a balloon form),
        // so the host only has to supply the metadata and the rendering.
        async fetchLinkMetadata(url: string) {
            return await linkEmbedService.fetchMetadata(url, note.noteId);
        },
        detectEmbedType(url: string) {
            return linkEmbedService.detectEmbedType(url);
        },
        renderLinkEmbed(container, metadata, editable) {
            linkEmbedService.renderEmbedPreview(container, metadata, editable);
        },
        renderLinkMention(container, metadata, editable) {
            linkEmbedService.renderMentionPreview(container, metadata, editable);
        },
        // Keyboard shortcut
        async followLinkUnderCursorCommand() {
            const editor = await waitForEditor();
            const selection = editor?.model.document.selection;
            const selectedElement = selection?.getSelectedElement();

            if (selectedElement?.name === "reference") {
                const { notePath } = parseNavigationStateFromUrl(selectedElement.getAttribute("href") as string | undefined);

                if (notePath) {
                    await appContext.tabManager.getActiveContext()?.setNote(notePath);
                    return;
                }
            }

            if (!selection?.hasAttribute("linkHref")) {
                return;
            }

            const selectedLinkUrl = selection.getAttribute("linkHref") as string;
            const notePath = link.getNotePathFromUrl(selectedLinkUrl);

            if (notePath) {
                await appContext.tabManager.getActiveContext()?.setNote(notePath);
            } else {
                window.open(selectedLinkUrl, "_blank");
            }
        },
        async cutIntoNoteCommand() {
            // The note this editor is showing, not whichever one the tab manager considers active: the
            // editor also runs in a split, in the quick editor and in the embedded panes of the map and
            // calendar views, where the active context is a different note entirely. Asking the tab
            // manager there put the sub-note under an unrelated parent, and — since the selection was
            // only saved when the *active* note was a text note — usually created it empty (#9890).
            const sourceNote = noteContext?.note;
            const parentNotePath = noteContext?.notePath;
            // This component's own editor, rather than noteContext.getTextEditor(): that one races the
            // round trip through the event bus against a 200 ms timeout and resolves to null when it
            // loses, which again meant an empty sub-note and a selection left where it was.
            const textEditor = await waitForEditor() as CKTextEditor | undefined;
            if (!sourceNote || !parentNotePath || !textEditor) return;

            if (!textEditor.getSelectedHtml()) {
                toast.showMessage(t("editable_text.nothing_selected_to_cut"));
                return;
            }

            // without await as this otherwise causes deadlock through component mutex
            note_create.createNote(parentNotePath, {
                isProtected: sourceNote.isProtected,
                saveSelection: true,
                textEditor
            });
        },
        async saveNoteDetailNowCommand() {
            // used by cutToNote in CKEditor build
            spacedUpdate.updateNowIfNecessary();
        }
    });

    useTriliumEvent("refreshEmbeddedNote", ({ noteId }) => {
        if (!containerRef.current) return;
        refreshEmbeddedNote(containerRef.current, noteId, { noteEditor: embedNoteEditor });
    });

    useEffect(() => () => stopWatchingEmbedsRef.current?.(), []);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const editor = watchdogRef.current?.editor as CKTextEditor | null | undefined;
        if (editor && note) {
            notifyAttachmentChanges(
                editor,
                loadResults,
                note.noteId,
                parentComponent?.componentId,
                pendingAttachmentChangesRef
            );
        }
    });

    useTriliumEvent("executeWithTextEditor", async ({ callback, resolve, ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        const editor = await waitForEditor() as CKTextEditor | undefined;
        if (!editor) return;
        if (callback) callback(editor);
        resolve(editor);
    });

    async function waitForEditor() {
        await initialized.current;
        const editor = watchdogRef.current?.editor;
        if (!editor) return;
        return editor;
    }

    async function addTextToEditor(text: string) {
        const editor = await waitForEditor();
        editor?.model.change((writer) => {
            const insertPosition = editor.model.document.selection.getLastPosition();
            if (insertPosition) {
                writer.insertText(text, insertPosition);
            }
        });
    }

    useTriliumEvent("addTextToActiveEditor", ({ text }) => {
        if (!noteContext?.isActive()) return;
        addTextToEditor(text);
    });

    const onWatchdogStateChange = useWatchdogCrashHandling();

    useEffect(() => {
        document.body.style.setProperty("--code-block-tab-width", codeBlockTabWidth || "4");
    }, [codeBlockTabWidth]);

    // Mobile-only: when the keyboard opens, scroll the caret into view.
    //
    // Under iOS WKWebView the outer scroll view is pinned to zero (see
    // ViewController.swift) so the toolbar doesn't get dragged off-screen
    // — which also suppresses iOS's native scroll-focused-element-into-
    // view behaviour. Without this effect, tapping near the bottom of a
    // long note leaves the view stuck at the top with the caret behind
    // the keyboard.
    //
    // Find the nearest scrollable ancestor of the caret, clamp its
    // "visible bottom" to `visualViewport.height` (so the caret lands
    // above the keyboard, not merely inside the container's rect), and
    // adjust scrollTop directly.
    useEffect(() => {
        if (!isMobile()) return;

        const CARET_BOTTOM_MARGIN_PX = 48;

        const findScrollableAncestor = (start: Node | null | undefined): HTMLElement | null => {
            let el: Node | null | undefined = start;
            while (el) {
                if (el instanceof HTMLElement) {
                    const overflowY = getComputedStyle(el).overflowY;
                    if ((overflowY === "auto" || overflowY === "scroll")
                        && el.scrollHeight > el.clientHeight + 1) {
                        return el;
                    }
                }
                el = el.parentNode;
            }
            return null;
        };

        const getCaretRect = (): DOMRect | null => {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return null;
            let rect = sel.getRangeAt(0).getBoundingClientRect();
            // Collapsed carets at end-of-line return a zero rect; fall
            // back to the containing element.
            if (rect.width === 0 && rect.height === 0) {
                const el = sel.focusNode instanceof Element
                    ? sel.focusNode
                    : sel.focusNode?.parentElement;
                if (el) rect = el.getBoundingClientRect();
            }
            return rect;
        };

        const scrollCaretIntoView = () => {
            const caretRect = getCaretRect();
            if (!caretRect) return;
            const scroller = findScrollableAncestor(window.getSelection()?.focusNode);
            if (!scroller) return;

            const vv = window.visualViewport;
            const containerRect = scroller.getBoundingClientRect();
            const viewportBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
            const viewportTop = vv?.offsetTop ?? 0;
            const visibleBottom = Math.min(containerRect.bottom, viewportBottom);
            const visibleTop = Math.max(containerRect.top, viewportTop);

            const overshoot = caretRect.bottom - (visibleBottom - CARET_BOTTOM_MARGIN_PX);
            if (overshoot > 0) {
                scroller.scrollTop += overshoot;
                return;
            }
            const undershoot = (visibleTop + CARET_BOTTOM_MARGIN_PX) - caretRect.top;
            if (undershoot > 0) {
                scroller.scrollTop -= undershoot;
            }
        };

        let pending: number | null = null;
        const schedule = () => {
            if (pending !== null) return;
            // Double rAF lets the keyboard animation, WebView resize, and
            // CKEditor's post-focus layout all settle before we measure.
            pending = requestAnimationFrame(() => {
                pending = requestAnimationFrame(() => {
                    pending = null;
                    scrollCaretIntoView();
                });
            });
        };

        window.visualViewport?.addEventListener("resize", schedule);
        document.addEventListener("focusin", schedule);
        return () => {
            window.visualViewport?.removeEventListener("resize", schedule);
            document.removeEventListener("focusin", schedule);
            if (pending !== null) cancelAnimationFrame(pending);
        };
    }, []);

    // Mobile-only: toggle todo-list checkboxes on the first tap and widen the
    // hit area so finger taps don't have to land precisely on the ~16px box.
    // Two problems are being solved:
    //   1. iOS WKWebView doesn't dispatch `change` on the first tap inside a
    //      contenteditable that isn't focused — users have to tap twice.
    //   2. The native checkbox is too small to hit reliably with a finger.
    // We accept any tap whose point lands within ~14px of the checkbox's
    // bounding box (roughly a 44px touch target, matching Apple HIG), flip
    // the checkbox, and fire a synthetic change event that CKEditor's
    // TodoCheckboxChangeObserver picks up.
    useEffect(() => {
        const container = containerRef.current;
        if (!container || !isMobile()) return;

        const HIT_PAD = 14;
        let tapped: HTMLInputElement | null = null;

        const findCheckboxFromTap = (e: TouchEvent): HTMLInputElement | null => {
            const target = e.target as HTMLElement | null;
            if (!target) return null;

            // Direct hit on the checkbox.
            const direct = target.closest<HTMLInputElement>(
                '.todo-list__label input[type="checkbox"]'
            );
            if (direct) return direct;

            // Near-miss: tap landed on the label or its surroundings. Accept
            // if the touch point is within HIT_PAD of the checkbox rect.
            const label = target.closest(".todo-list__label");
            if (!label) return null;
            const checkbox = label.querySelector<HTMLInputElement>(
                'input[type="checkbox"]'
            );
            if (!checkbox) return null;

            const touch = e.touches[0] ?? e.changedTouches[0];
            if (!touch) return null;
            const rect = checkbox.getBoundingClientRect();
            if (
                touch.clientX >= rect.left - HIT_PAD &&
                touch.clientX <= rect.right + HIT_PAD &&
                touch.clientY >= rect.top - HIT_PAD &&
                touch.clientY <= rect.bottom + HIT_PAD
            ) {
                return checkbox;
            }
            return null;
        };

        const onTouchStart = (e: TouchEvent) => {
            tapped = findCheckboxFromTap(e);
        };

        const onTouchEnd = (e: TouchEvent) => {
            if (!tapped) return;
            const checkbox = tapped;
            tapped = null;
            // Suppress the synthesised click so we don't toggle twice.
            e.preventDefault();
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        };

        container.addEventListener("touchstart", onTouchStart, { passive: true });
        container.addEventListener("touchend", onTouchEnd, { passive: false });
        return () => {
            container.removeEventListener("touchstart", onTouchStart);
            container.removeEventListener("touchend", onTouchEnd);
        };
    }, []);

    return (
        <>
            {note && !!templates && <CKEditorWithWatchdog
                containerRef={containerRef}
                className={`note-detail-editable-text-editor use-tn-links ${codeBlockWordWrap ? "word-wrap" : ""}`}
                tabIndex={300}
                contentLanguage={language}
                isClassicEditor={isClassicEditor}
                editorApi={editorApiRef}
                watchdogRef={watchdogRef}
                watchdogConfig={{
                    // An average number of milliseconds between the last editor errors (defaults to 5000). When the period of time between errors is lower than that and the crashNumberLimit is also reached, the watchdog changes its state to crashedPermanently, and it stops restarting the editor. This prevents an infinite restart loop.
                    minimumNonErrorTimePeriod: 5000,
                    // A threshold specifying the number of errors (defaults to 3). After this limit is reached and the time between last errors is shorter than minimumNonErrorTimePeriod, the watchdog changes its state to crashedPermanently, and it stops restarting the editor. This prevents an infinite restart loop.
                    crashNumberLimit: 10,
                    // A minimum number of milliseconds between saving the editor data internally (defaults to 5000). Note that for large documents, this might impact the editor performance.
                    saveInterval: Number.MAX_SAFE_INTEGER
                }}
                templates={templates}
                onNotificationWarning={onNotificationWarning}
                onNotificationInfo={onNotificationInfo}
                onWatchdogStateChange={onWatchdogStateChange}
                onChange={() => {
                    spacedUpdate.scheduleUpdate();
                    const editor = watchdogRef.current?.editor;
                    if (editor) {
                        reportBlocks?.(editor as CKTextEditor);
                    }
                }}
                onEditorInitialized={(editor) => {
                    if (containerRef.current) {
                        setupImageOpening(containerRef.current, false);
                        stopWatchingEmbedsRef.current?.();
                        stopWatchingEmbedsRef.current = watchContentEmbeds(
                            containerRef.current,
                            editor
                        );
                    }

                    editor.plugins.get("FileUploadEditing")
                        .on<FileUploadEvent>("upload", showFileUploadProgress);

                    if (block !== undefined) {
                        editor.plugins.get("BlockReferenceEditing").editRange();
                    }
                    initialized.current.resolve();
                    // Restore the data, either on the first render or if the editor crashes.
                    // We are not using CKEditor's built-in watch dog content, instead we are using the data we store regularly in the spaced update (see `dataSaved`).
                    if (contentNoteIdRef.current) {
                        setEditorNoteId(editor, contentNoteIdRef.current);
                    }
                    editor.setData(contentRef.current);
                    parentComponent?.triggerEvent("textEditorRefreshed", { ntxId, editor });

                }}
            />}

            {iconPickerRequest && createPortal(
                <IconPicker
                    columnCount={ICON_PICKER_COLUMNS}
                    compact
                    onSelect={iconPickerRequest.onSelect}
                />,
                iconPickerRequest.container
            )}
        </>
    );
}

/**
 * The content of an editor of the blocks of a note that `block` points at, and the blocks it holds
 * now. An empty editor still holds a block, whose id keeps the place of the blocks in the note.
 */
export function getBlockData(editor: CKTextEditor, block: string) {
    return {
        content: editor.getData({ trim: "none" }),
        block: getEditorBlocks(editor, block)
    };
}

/**
 * Calls `onBlockChange()` with the blocks that an editor of the blocks `block` holds, each time
 * they differ from the blocks it reported last.
 *
 * Exported for testing.
 */
export function watchEditorBlocks(block: string, onBlockChange: (block: string) => void) {
    let reportedBlock = block;
    return (editor: CKTextEditor) => {
        const editorBlock = getEditorBlocks(editor, block);
        if (editorBlock && editorBlock !== reportedBlock) {
            reportedBlock = editorBlock;
            onBlockChange(editorBlock);
        }
    };
}

/** The blocks that an editor of the blocks `block` holds, preferring the ids of `block`. */
function getEditorBlocks(editor: CKTextEditor, block: string) {
    const range = editor.plugins.get("BlockReferenceEditing").getRange(parseBlockRange(block));
    return range ? formatBlockRange(range) : undefined;
}

/** The number of icons per row of the picker in the editor's balloon. */
const ICON_PICKER_COLUMNS = 9;

/**
 * Inserts an empty paragraph at the very top of the document and places the cursor in it, giving the
 * Notion-like behavior when pressing Enter in the note title. If the first block is already an empty
 * paragraph, the cursor is placed in it rather than stacking another empty paragraph.
 */
function placeCursorInNewTopParagraph(editor: CKTextEditor) {
    editor.model.change((writer) => {
        const root = editor.model.document.getRoot();
        if (!root) return;

        const firstChild = root.getChild(0);
        if (firstChild?.is("element", "paragraph") && firstChild.isEmpty) {
            writer.setSelection(firstChild, "in");
            return;
        }

        const paragraph = writer.createElement("paragraph");
        writer.insert(paragraph, root, 0);
        writer.setSelection(paragraph, "in");
    });

    // The scrolling container scrolls, not the editor itself, and the inline title may have scrolled
    // out of view (e.g. the cursor was at the bottom of a long note), so the selection change alone
    // won't move the viewport. Explicitly reveal the new top paragraph once it has rendered.
    requestAnimationFrame(() => {
        // The editor may have been destroyed while waiting for the frame (e.g. the user navigated
        // away from the note), in which case `editing` is nulled — bail out instead of throwing.
        if (editor.editing?.view) {
            editor.editing.view.scrollToTheSelection();
        }
    });
}

function useTemplates() {
    const [ templates, setTemplates ] = useState<SnippetDefinition[]>();

    useEffect(() => {
        getTemplates().then(setTemplates);
    }, []);

    useTriliumEvent("entitiesReloaded", async ({ loadResults }) => {
        await updateTemplateCache(loadResults, setTemplates);
    });

    return templates;
}

function useWatchdogCrashHandling() {
    const hasCrashed = useRef(false);
    const onWatchdogStateChange = useCallback((watchdog: EditorWatchdog) => {
        const currentState = watchdog.state;
        logInfo(`CKEditor state changed to ${currentState}`);

        if (currentState === "ready" && hasCrashed.current) {
            hasCrashed.current = false;
            watchdog.editor?.focus();
        }

        if (!["crashed", "crashedPermanently"].includes(currentState)) {
            return;
        }

        hasCrashed.current = true;
        const formattedCrash = JSON.stringify(watchdog.crashes, null, 4);
        logError(`CKEditor crash logs: ${formattedCrash}`);

        if (currentState === "crashed") {
            toast.showPersistent({
                id: "editor-crashed",
                icon: "bx bx-bug",
                title: t("editable_text.editor_crashed_title"),
                message: t("editable_text.editor_crashed_content"),
                buttons: [
                    {
                        text: t("editable_text.editor_crashed_details_button"),
                        onClick: ({ dismissToast }) => {
                            dismissToast();
                            dialog.info(<>
                                <p>{t("editable_text.editor_crashed_details_intro")}</p>
                                <h3>{t("editable_text.editor_crashed_details_title")}</h3>
                                <pre><code class="language-application-json">{formattedCrash}</code></pre>
                            </>, {
                                title: t("editable_text.editor_crashed_title"),
                                size: "lg",
                                copyToClipboardButton: true
                            });
                        }
                    }
                ],
                timeout: 20_000
            });
        } else if (currentState === "crashedPermanently") {
            toast.showPersistent({
                id: "editor-crashed-permanently",
                icon: "bx bx-error-circle",
                title: t("editable_text.editor_crashed_title"),
                message: t("editable_text.keeps-crashing")
            });
            watchdog.editor?.enableReadOnlyMode("crashed-editor");
        }
    }, []);

    return onWatchdogStateChange;
}

/**
 * Renders a CKEditor warning (a failed upload, most commonly) as a Trilium toast instead of the
 * `window.alert` the notification plugin falls back to, and stops the event so that fallback never
 * runs.
 *
 * Exported for testing.
 */
export function onNotificationWarning(evt: NotificationEventInfo, data: NotificationEventData) {
    const { title, message } = data;

    if (title && message) {
        toast.showErrorTitleAndMessage(title, message);
    } else if (title || message) {
        toast.showError(title || message);
    }

    evt.stop();
}

/**
 * Shows a CKEditor info notification, such as the notice after sorting a table, as a Trilium toast.
 *
 * Exported for testing.
 */
export function onNotificationInfo(_evt: NotificationEventInfo, data: NotificationEventData) {
    toast.showMessage(data.message);
}

interface PendingAttachmentChanges {
    noteId: string;
    changes: AttachmentLinkChange[];
}

/**
 * Passes the attachments changed in `loadResults` to the editor's reference links, so a link shows
 * the new title of its attachment or goes away with it. Changes that this editor saved, such as a
 * canvas drawing, are skipped: redrawing an embed remounts what it shows.
 *
 * When `loadResults` also reloads the note's content, the changes wait in `pending` until
 * `applyPendingAttachmentChanges()` runs on the reloaded content.
 *
 * Exported for testing.
 */
export function notifyAttachmentChanges(
    editor: CKTextEditor,
    loadResults: LoadResults,
    noteId: string,
    componentId: string | undefined,
    pending: { current: PendingAttachmentChanges | undefined }
) {
    const rows = loadResults.getAttachmentRows(componentId);
    const changes = rows.flatMap(({ attachmentId, isDeleted }) =>
        attachmentId ? [ { attachmentId, isDeleted: !!isDeleted } ] : []
    );
    if (!changes.length) {
        return;
    }

    // `useNoteBlob()` reloads the content under the same condition, and `setData()` would discard
    // the updated links.
    if (loadResults.isNoteContentReloaded(noteId, componentId)) {
        const held = pending.current?.noteId === noteId ? pending.current.changes : [];
        pending.current = { noteId, changes: [ ...held, ...changes ] };
        return;
    }

    editor.plugins.get("ReferenceLinkEditing").updateAttachmentLinks(changes);
}

/**
 * Applies the changes `notifyAttachmentChanges()` held for `noteId`, once the editor holds its
 * reloaded content. Changes held for another note are dropped.
 *
 * Exported for testing.
 */
export function applyPendingAttachmentChanges(
    editor: CKTextEditor,
    noteId: string,
    pending: { current: PendingAttachmentChanges | undefined }
) {
    const held = pending.current;
    pending.current = undefined;
    if (held?.noteId === noteId) {
        editor.plugins.get("ReferenceLinkEditing").updateAttachmentLinks(held.changes);
    }
}

/**
 * Shows the progress of a file attachment upload in a toast until the upload ends.
 *
 * Exported for testing.
 */
export function showFileUploadProgress(_evt: unknown, { fileName, loader, done }: FileUploadData) {
    const id = `file-upload-${loader.id}`;
    const showProgress = () => toast.showPersistent({
        id,
        icon: "bx bx-paperclip",
        title: t("editable_text.uploading_attachment"),
        message: fileName,
        progress: loader.uploadedPercent / 100,
        dismissible: false
    });

    showProgress();
    loader.on("change:uploadedPercent", showProgress);
    void done.then(() => {
        loader.off("change:uploadedPercent", showProgress);
        toast.closePersistent(id);
    });
}
