import "./EditableText.css";
import "./LinkEmbed.css";

import { CKTextEditor, EditorWatchdog, TemplateDefinition } from "@triliumnext/ckeditor5";
import { deferred } from "@triliumnext/commons";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import link, { parseNavigationStateFromUrl } from "../../../services/link";
import note_create from "../../../services/note_create";
import options from "../../../services/options";
import toast from "../../../services/toast";
import utils, { isMobile } from "../../../services/utils";
import { useEditorSpacedUpdate, useLegacyImperativeHandlers, useNoteLabel, useTriliumEvent, useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import { TypeWidgetProps } from "../type_widget";
import CKEditorWithWatchdog, { CKEditorApi } from "./CKEditorWithWatchdog";
import getTemplates, { updateTemplateCache } from "./snippets.js";
import linkEmbedService from "../../../services/link_embed";
import { loadIncludedNote, refreshIncludedNote, setupImageOpening } from "./utils";

/**
 * The editor can operate into two distinct modes:
 *
 * - Ballon block mode, in which there is a floating toolbar for the selected text, but another floating button for the entire block (i.e. paragraph).
 * - Decoupled mode, in which the editing toolbar is actually added on the client side (in {@link ClassicEditorToolbar}), see https://ckeditor.com/docs/ckeditor5/latest/examples/framework/bottom-toolbar-editor.html for an example on how the decoupled editor works.
 */
export default function EditableText({ note, parentComponent, ntxId, noteContext }: TypeWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<string>("");
    const watchdogRef = useRef<EditorWatchdog>(null);
    const editorApiRef = useRef<CKEditorApi>(null);
    const [ language ] = useNoteLabel(note, "language");
    const [ textNoteEditorType ] = useTriliumOption("textNoteEditorType");
    const [ codeBlockWordWrap ] = useTriliumOptionBool("codeBlockWordWrap");
    const [ codeBlockTabWidth ] = useTriliumOption("codeBlockTabWidth");
    const isClassicEditor = isMobile() || textNoteEditorType === "ckeditor-classic";
    const initialized = useRef(deferred<void>());
    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteContext,
        noteType: "text",
        getData() {
            const editor = watchdogRef.current?.editor;
            if (!editor) {
                // There is nothing to save, most likely a result of the editor crashing and reinitializing.
                return;
            }

            const content = editor.getData() ?? "";

            // if content is only tags/whitespace (typically <p>&nbsp;</p>), then just make it empty,
            // this is important when setting a new note to code
            return {
                content: utils.isHtmlEmpty(content) ? "" : content
            };
        },
        onContentChange(newContent) {
            contentRef.current = newContent;
            watchdogRef.current?.editor?.setData(newContent);

            // Scroll to bookmark anchor if navigated with ?bookmark=...
            const viewScope = noteContext?.viewScope;
            if (viewScope?.bookmark) {
                requestAnimationFrame(() => {
                    const el = watchdogRef.current?.editor?.editing.view.getDomRoot()
                        ?.querySelector(`[id="${CSS.escape(viewScope.bookmark!)}"]`);
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    viewScope.bookmark = undefined;
                });
            }
        },
        dataSaved(savedData) {
            // Store back the saved data in order to retrieve it in case the CKEditor crashes.
            contentRef.current = savedData.content;
        }
    });
    const templates = useTemplates();

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
        insertDateTimeToTextCommand() {
            if (!editorApiRef.current) return;
            const date = new Date();
            const customDateTimeFormat = options.get("customDateTimeFormat");
            const dateString = utils.formatDateTime(date, customDateTimeFormat);

            addTextToEditor(dateString);
        },
        // Include note functionality note
        addIncludeNoteToTextCommand() {
            if (!editorApiRef.current) return;
            parentComponent?.triggerCommand("showIncludeNoteDialog", {
                editorApi: editorApiRef.current,
            });
        },
        loadIncludedNote,
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
        // Creating notes in @-completion
        async createNoteForReferenceLink(title: string) {
            const notePath = noteContext?.notePath;
            if (!notePath) return;

            const resp = await note_create.createNoteWithTypePrompt(notePath, {
                activate: false,
                title
            });

            if (!resp || !resp.note) return;
            return resp.note.getBestNotePathString();
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
            const note = appContext.tabManager.getActiveContextNote();
            if (!note) return;

            // without await as this otherwise causes deadlock through component mutex
            const parentNotePath = appContext.tabManager.getActiveContextNotePath();
            if (noteContext && parentNotePath) {
                note_create.createNote(parentNotePath, {
                    isProtected: note.isProtected,
                    saveSelection: true,
                    textEditor: await noteContext?.getTextEditor()
                });
            }
        },
        async saveNoteDetailNowCommand() {
            // used by cutToNote in CKEditor build
            spacedUpdate.updateNowIfNecessary();
        }
    });

    useTriliumEvent("refreshIncludedNote", ({ noteId }) => {
        if (!containerRef.current) return;
        refreshIncludedNote(containerRef.current, noteId);
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
                onWatchdogStateChange={onWatchdogStateChange}
                onChange={() => spacedUpdate.scheduleUpdate()}
                onEditorInitialized={(editor) => {
                    if (containerRef.current) {
                        setupImageOpening(containerRef.current, false);
                    }

                    initialized.current.resolve();
                    // Restore the data, either on the first render or if the editor crashes.
                    // We are not using CKEditor's built-in watch dog content, instead we are using the data we store regularly in the spaced update (see `dataSaved`).
                    editor.setData(contentRef.current);
                    parentComponent?.triggerEvent("textEditorRefreshed", { ntxId, editor });

                }}
            />}
        </>
    );
}

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
    const [ templates, setTemplates ] = useState<TemplateDefinition[]>();

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

function onNotificationWarning(data, evt) {
    const title = data.title;
    const message = data.message.message;

    if (title && message) {
        toast.showErrorTitleAndMessage(data.title, data.message.message);
    } else if (title) {
        toast.showError(title || message);
    }

    evt.stop();
}

