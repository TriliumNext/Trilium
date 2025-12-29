import { CKTextEditor, ClassicEditor, EditorWatchdog, PopupEditor, TemplateDefinition,type WatchdogConfig } from "@triliumnext/ckeditor5";
import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { HTMLProps, RefObject, useEffect, useImperativeHandle, useRef, useState } from "preact/compat";

import froca from "../../../services/froca";
import link from "../../../services/link";
import { useKeyboardShortcuts, useLegacyImperativeHandlers, useNoteContext, useSyncedRef, useTriliumOption } from "../../react/hooks";
import { buildConfig, BuildEditorOptions } from "./config";

export type BoxSize = "small" | "medium" | "full";

export interface CKEditorApi {
    /** returns true if user selected some text, false if there's no selection */
    hasSelection(): boolean;
    getSelectedText(): string;
    addLink(notePath: string, linkTitle: string | null, externalLink?: boolean): void;
    addLinkToEditor(linkHref: string, linkTitle: string): void;
    addHtmlToEditor(html: string): void;
    addIncludeNote(noteId: string, boxSize?: BoxSize): void;
    addImage(noteId: string): Promise<void>;
}

interface CKEditorWithWatchdogProps extends Pick<HTMLProps<HTMLDivElement>, "className" | "tabIndex"> {
    contentLanguage: string | null | undefined;
    isClassicEditor?: boolean;
    watchdogRef: RefObject<EditorWatchdog>;
    watchdogConfig?: WatchdogConfig;
    onNotificationWarning?: (evt: any, data: any) => void;
    onWatchdogStateChange?: (watchdog: EditorWatchdog) => void;
    onChange: () => void;
    /** Called upon whenever a new CKEditor instance is initialized, whether it's the first initialization, after a crash or after a config change that requires it (e.g. content language). */
    onEditorInitialized?: (editor: CKTextEditor) => void;
    editorApi: RefObject<CKEditorApi>;
    templates: TemplateDefinition[];
    containerRef?: RefObject<HTMLDivElement>;
}

export default function CKEditorWithWatchdog({ containerRef: externalContainerRef, contentLanguage, className, tabIndex, isClassicEditor, watchdogRef: externalWatchdogRef, watchdogConfig, onNotificationWarning, onWatchdogStateChange, onChange, onEditorInitialized, editorApi, templates }: CKEditorWithWatchdogProps) {
    const containerRef = useSyncedRef<HTMLDivElement>(externalContainerRef, null);
    const watchdogRef = useRef<EditorWatchdog>(null);
    const [ uiLanguage ] = useTriliumOption("locale");
    const [ editor, setEditor ] = useState<CKTextEditor>();
    const { parentComponent, ntxId } = useNoteContext();

    useKeyboardShortcuts("text-detail", containerRef, parentComponent, ntxId);

    useImperativeHandle(editorApi, () => ({
        hasSelection() {
            const model = watchdogRef.current?.editor?.model;
            const selection = model?.document.selection;

            return !selection?.isCollapsed;
        },
        getSelectedText() {
            const range = watchdogRef.current?.editor?.model.document.selection.getFirstRange();
            let text = "";

            if (!range) {
                return text;
            }

            for (const item of range.getItems()) {
                if ("data" in item && item.data) {
                    text += item.data;
                }
            }

            return text;
        },
        addLink(notePath, linkTitle, externalLink) {
            const editor = watchdogRef.current?.editor;
            if (!editor) return;

            if (linkTitle) {
                if (this.hasSelection()) {
                    editor.execute("link", externalLink ? `${notePath}` : `#${notePath}`);
                } else {
                    this.addLinkToEditor(externalLink ? `${notePath}` : `#${notePath}`, linkTitle);
                }
            } else {
                editor.execute("referenceLink", { href: `#${  notePath}` });
            }

            editor.editing.view.focus();
        },
        addLinkToEditor(linkHref, linkTitle) {
            watchdogRef.current?.editor?.model.change((writer) => {
                const insertPosition = watchdogRef.current?.editor?.model.document.selection.getFirstPosition();
                if (insertPosition) {
                    writer.insertText(linkTitle, { linkHref }, insertPosition);
                }
            });
        },
        addIncludeNote(noteId, boxSize) {
            const editor = watchdogRef.current?.editor;
            if (!editor) return;

            editor?.model.change((writer) => {
                // Insert <includeNote>*</includeNote> at the current selection position
                // in a way that will result in creating a valid model structure
                editor?.model.insertContent(
                    writer.createElement("includeNote", {
                        noteId,
                        boxSize
                    })
                );
            });
        },
        addHtmlToEditor(html: string) {
            const editor = watchdogRef.current?.editor;
            if (!editor) return;

            editor.model.change((writer) => {
                const viewFragment = editor.data.processor.toView(html);
                const modelFragment = editor.data.toModel(viewFragment);
                const insertPosition = editor.model.document.selection.getLastPosition();

                if (insertPosition) {
                    const range = editor.model.insertContent(modelFragment, insertPosition);

                    if (range) {
                        writer.setSelection(range.end);
                    }
                }
            });

            editor.editing.view.focus();
        },
        async addImage(noteId) {
            const editor = watchdogRef.current?.editor;
            if (!editor) return;

            const note = await froca.getNote(noteId);
            if (!note) return;

            editor.model.change(() => {
                const encodedTitle = encodeURIComponent(note.title);
                const src = `api/images/${note.noteId}/${encodedTitle}`;

                editor?.execute("insertImage", { source: src });
            });
        },
    }));

    useLegacyImperativeHandlers({
        async loadReferenceLinkTitle($el: JQuery<HTMLElement>, href: string | null = null) {
            await link.loadReferenceLinkTitle($el, href);
        }
    });

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let isStale = false;

        const init = async () => {
            // Ensure any previous watchdog is fully destroyed
            if (watchdogRef.current) {
                try {
                    await watchdogRef.current.destroy();
                } catch (e) {
                    console.warn("Watchdog destroy failed", e);
                }
                watchdogRef.current = null;
            }

            if (isStale) return;

            const watchdog = buildWatchdog(!!isClassicEditor, watchdogConfig);
            watchdogRef.current = watchdog;
            externalWatchdogRef.current = watchdog;

            watchdog.setCreator(async () => {
                if (isStale) {
                    throw new Error("Editor creation cancelled");
                }

                const editor = await buildEditor(container, !!isClassicEditor, {
                    forceGplLicense: false,
                    isClassicEditor: !!isClassicEditor,
                    uiLanguage: uiLanguage as DISPLAYABLE_LOCALE_IDS,
                    contentLanguage: contentLanguage ?? null,
                    templates
                });

                if (isStale) {
                    await editor.destroy();
                    throw new Error("Editor creation cancelled");
                }

                setEditor(editor);

                if (import.meta.env.VITE_CKEDITOR_ENABLE_INSPECTOR === "true") {
                    const CKEditorInspector = (await import("@ckeditor/ckeditor5-inspector")).default;
                    CKEditorInspector.attach(editor);
                }

                onEditorInitialized?.(editor);

                return editor;
            });

            if (onWatchdogStateChange) {
                watchdog.on("stateChange", () => onWatchdogStateChange(watchdog));
            }

            await watchdog.create(container);
        };

        init();

        return () => {
            isStale = true;
        };
    }, [ contentLanguage, templates, uiLanguage ]);


    // React to notification warning callback.
    useEffect(() => {
        if (!onNotificationWarning || !editor) return;
        const notificationPlugin = editor.plugins.get("Notification");
        notificationPlugin.on("show:warning", onNotificationWarning);
        return () => notificationPlugin.off("show:warning", onNotificationWarning);
    }, [ editor, onNotificationWarning ]);

    // React to on change listener.
    useEffect(() => {
        if (!editor) return;
        editor.model.document.on("change:data", onChange);
        return () => editor.model.document.off("change:data", onChange);
    }, [ editor, onChange ]);

    return (
        <div ref={containerRef} className={className} tabIndex={tabIndex} />
    );
}

function buildWatchdog(isClassicEditor: boolean, watchdogConfig?: WatchdogConfig): EditorWatchdog {
    if (isClassicEditor) {
        return new EditorWatchdog(ClassicEditor, watchdogConfig);
    }
    return new EditorWatchdog(PopupEditor, watchdogConfig);

}

async function buildEditor(element: HTMLElement, isClassicEditor: boolean, opts: BuildEditorOptions) {
    const editorClass = isClassicEditor ? ClassicEditor : PopupEditor;
    let config = await buildConfig(opts);
    let editor = await editorClass.create(element, config);

    if (editor.isReadOnly) {
        editor.destroy();

        opts.forceGplLicense = true;
        config = await buildConfig(opts);
        editor = await editorClass.create(element, config);
    }
    return editor;
}
