import { useEffect, useRef, useState } from "preact/hooks";
import dialog from "../../../services/dialog";
import toast from "../../../services/toast";
import utils, { hasTouchBar, isMobile } from "../../../services/utils";
import { useEditorSpacedUpdate, useKeyboardShortcuts, useLegacyImperativeHandlers, useNoteLabel, useTriliumEvent, useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import { TypeWidgetProps } from "../type_widget";
import CKEditorWithWatchdog, { CKEditorApi } from "./CKEditorWithWatchdog";
import "./EditableText.css";
import { CKTextEditor, ClassicEditor, EditorWatchdog, TemplateDefinition } from "@triliumnext/ckeditor5";
import Component from "../../../components/component";
import options from "../../../services/options";
import { loadIncludedNote, refreshIncludedNote, setupImageOpening } from "./utils";
import getTemplates, { updateTemplateCache } from "./snippets.js";
import appContext from "../../../components/app_context";
import link, { parseNavigationStateFromUrl } from "../../../services/link";
import note_create from "../../../services/note_create";
import TouchBar, { TouchBarButton, TouchBarGroup, TouchBarSegmentedControl } from "../../react/TouchBar";
import { RefObject } from "preact";
import { buildSelectedBackgroundColor } from "../../../components/touch_bar";
import { deferred } from "@triliumnext/commons";

/**
 * The editor can operate into two distinct modes:
 *
 * - Ballon block mode, in which there is a floating toolbar for the selected text, but another floating button for the entire block (i.e. paragraph).
 * - Decoupled mode, in which the editing toolbar is actually added on the client side (in {@link ClassicEditorToolbar}), see https://ckeditor.com/docs/ckeditor5/latest/examples/framework/bottom-toolbar-editor.html for an example on how the decoupled editor works.
 */
export default function EditableText({ note, parentComponent, ntxId, noteContext }: TypeWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [ content, setContent ] = useState<string>();
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
            setContent(newContent);
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
                title: title
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

    useTriliumEvent("insertDateTimeToText", ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        const date = new Date();
        const customDateTimeFormat = options.get("customDateTimeFormat");
        const dateString = utils.formatDateTime(date, customDateTimeFormat);

        addTextToEditor(dateString);
    });
    useTriliumEvent("addTextToActiveEditor", ({ text }) => {
        if (!noteContext?.isActive()) return;
        addTextToEditor(text);
    });

    return (
        <>
            {note && !!templates && <CKEditorWithWatchdog
                containerRef={containerRef}
                className={`note-detail-editable-text-editor use-tn-links ${codeBlockWordWrap ? "word-wrap" : ""}`}
                tabIndex={300}
                content={content}
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
                    saveInterval: 5000
                }}
                templates={templates}
                onNotificationWarning={onNotificationWarning}
                onWatchdogStateChange={onWatchdogStateChange}
                onChange={() => spacedUpdate.scheduleUpdate()}
                onEditorInitialized={(editor) => {
                    console.log("Editor has been initialized!", parentComponent, editor);

                    if (isClassicEditor) {
                        setupClassicEditor(editor, parentComponent);
                    }

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

function onWatchdogStateChange(watchdog: EditorWatchdog) {
    const currentState = watchdog.state;
    logInfo(`CKEditor state changed to ${currentState}`);

    if (!["crashed", "crashedPermanently"].includes(currentState)) {
        return;
    }

    logError(`CKEditor crash logs: ${JSON.stringify(watchdog.crashes, null, 4)}`);

    if (currentState === "crashedPermanently") {
        dialog.info(`Editing component keeps crashing. Please try restarting Trilium. If problem persists, consider creating a bug report.`);
        watchdog.editor?.enableReadOnlyMode("crashed-editor");
    }
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

function setupClassicEditor(editor: CKTextEditor, parentComponent: Component | undefined) {
    if (!parentComponent) return;
    const $classicToolbarWidget = findClassicToolbar(parentComponent);

    $classicToolbarWidget.empty();
    if ($classicToolbarWidget.length) {
        const toolbarView = (editor as ClassicEditor).ui.view.toolbar;
        if (toolbarView.element) {
            $classicToolbarWidget[0].appendChild(toolbarView.element);
        }
    }

    if (utils.isMobile()) {
        $classicToolbarWidget.addClass("visible");

        // Reposition all dropdowns to point upwards instead of downwards.
        // See https://ckeditor.com/docs/ckeditor5/latest/examples/framework/bottom-toolbar-editor.html for more info.
        const toolbarView = (editor as ClassicEditor).ui.view.toolbar;
        for (const item of toolbarView.items) {
            if (!("panelView" in item)) continue;

            item.on("change:isOpen", () => {
                if (!("isOpen" in item) || !item.isOpen) return;

                // @ts-ignore
                item.panelView.position = item.panelView.position.replace("s", "n");
            });
        }
    }
}

function findClassicToolbar(parentComponent: Component): JQuery<HTMLElement> {
    const $widget = $(parentComponent.$widget);

    if (!utils.isMobile()) {
        const $parentSplit = $widget.parents(".note-split.type-text");

        if ($parentSplit.length) {
            // The editor is in a normal tab.
            return $parentSplit.find("> .ribbon-container .classic-toolbar-widget");
        } else {
            // The editor is in a popup.
            return $widget.closest(".modal-body").find(".classic-toolbar-widget");
        }
    } else {
        return $("body").find(".classic-toolbar-widget");
    }
}

function EditableTextTouchBar({ watchdogRef, refreshTouchBarRef }: { watchdogRef: RefObject<EditorWatchdog | null>, refreshTouchBarRef: RefObject<() => void> }) {
    const [ headingSelectedIndex, setHeadingSelectedIndex ] = useState<number>();

    function refresh() {
        let headingSelectedIndex: number | undefined = undefined;
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

    useEffect(refresh, []);
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
                            editor?.execute("paragraph")
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
    )
}

function TouchBarCommandButton({ watchdogRef, icon, command }: { watchdogRef: RefObject<EditorWatchdog | null>, icon: string, command: string }) {
    const editor = watchdogRef.current?.editor;
    return (<TouchBarButton
        icon={icon}
        click={() => editor?.execute(command)}
        backgroundColor={buildSelectedBackgroundColor(editor?.commands.get(command)?.value as boolean)}
    />);
}
