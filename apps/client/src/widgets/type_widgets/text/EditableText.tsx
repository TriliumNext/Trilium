import "./EditableText.css";

import { CKTextEditor, EditorWatchdog, TemplateDefinition } from "@triliumnext/ckeditor5";
import { deferred } from "@triliumnext/commons";
import { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import { buildSelectedBackgroundColor } from "../../../components/touch_bar";
import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import link, { parseNavigationStateFromUrl } from "../../../services/link";
import note_create from "../../../services/note_create";
import options from "../../../services/options";
import toast from "../../../services/toast";
import utils, { hasTouchBar, isMobile } from "../../../services/utils";
import { useEditorSpacedUpdate, useLegacyImperativeHandlers, useNoteLabel, useTriliumEvent, useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import TouchBar, { TouchBarButton, TouchBarGroup, TouchBarSegmentedControl } from "../../react/TouchBar";
import { TypeWidgetProps } from "../type_widget";
import CKEditorWithWatchdog, { CKEditorApi } from "./CKEditorWithWatchdog";
import getTemplates, { updateTemplateCache } from "./snippets.js";
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
    const refreshTouchBarRef = useRef<() => void>(null);
    const [ language ] = useNoteLabel(note, "language");
    const [ textNoteEditorType ] = useTriliumOption("textNoteEditorType");
    const [ codeBlockWordWrap ] = useTriliumOptionBool("codeBlockWordWrap");
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

    useTriliumEvent("focusOnDetail", async ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        const editor = await waitForEditor();
        editor?.editing.view.focus();
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
                    if (hasTouchBar) {
                        const handler = () => refreshTouchBarRef.current?.();
                        for (const event of [ "bold", "italic", "underline", "paragraph", "heading" ]) {
                            editor.commands.get(event)?.on("change", handler);
                        }
                    }

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

            <EditableTextTouchBar watchdogRef={watchdogRef} refreshTouchBarRef={refreshTouchBarRef} />
        </>
    );
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
            dialog.info(t("editable_text.keeps-crashing"));
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

function EditableTextTouchBar({ watchdogRef, refreshTouchBarRef }: { watchdogRef: RefObject<EditorWatchdog | null>, refreshTouchBarRef: RefObject<() => void> }) {
    const [ headingSelectedIndex, setHeadingSelectedIndex ] = useState<number>();

    function refresh() {
        let headingSelectedIndex: number | undefined;
        const editor = watchdogRef.current?.editor;
        const headingCommand = editor?.commands.get("heading");
        const paragraphCommand = editor?.commands.get("paragraph");
        if (paragraphCommand?.value) {
            headingSelectedIndex = 0;
        } else if (headingCommand?.value === "heading2") {
            headingSelectedIndex = 1;
        } else if (headingCommand?.value === "heading3") {
            headingSelectedIndex = 2;
        }
        setHeadingSelectedIndex(headingSelectedIndex);
    }

    useEffect(refresh, [ watchdogRef ]);
    refreshTouchBarRef.current = refresh;

    return (
        <TouchBar>
            <TouchBarSegmentedControl
                segments={[
                    { label: "P" },
                    { label: "H2" },
                    { label: "H3" }
                ]}
                onChange={(selectedIndex) => {
                    const editor = watchdogRef.current?.editor;
                    switch (selectedIndex) {
                        case 0:
                            editor?.execute("paragraph");
                            break;
                        case 1:
                            editor?.execute("heading", { value: "heading2" });
                            break;
                        case 2:
                            editor?.execute("heading", { value: "heading3" });
                            break;
                    }
                }}
                selectedIndex={headingSelectedIndex}
                mode="buttons"
            />

            <TouchBarGroup>
                <TouchBarCommandButton watchdogRef={watchdogRef} command="bold" icon="NSTouchBarTextBoldTemplate" />
                <TouchBarCommandButton watchdogRef={watchdogRef} command="italic" icon="NSTouchBarTextItalicTemplate" />
                <TouchBarCommandButton watchdogRef={watchdogRef} command="underline" icon="NSTouchBarTextUnderlineTemplate" />
            </TouchBarGroup>
        </TouchBar>
    );
}

function TouchBarCommandButton({ watchdogRef, icon, command }: { watchdogRef: RefObject<EditorWatchdog | null>, icon: string, command: string }) {
    const editor = watchdogRef.current?.editor;
    return (<TouchBarButton
        icon={icon}
        click={() => editor?.execute(command)}
        backgroundColor={buildSelectedBackgroundColor(editor?.commands.get(command)?.value as boolean)}
    />);
}
