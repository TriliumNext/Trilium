import { CKTextEditor, ClassicEditor, EditorWatchdog, PopupEditor, SnippetDefinition, type WatchdogConfig } from "@triliumnext/ckeditor5";
import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { HTMLProps, RefObject, useEffect, useImperativeHandle, useRef, useState } from "preact/compat";

import froca from "../../../services/froca";
import link from "../../../services/link";
import linkEmbedService, { type EmbedMetadata } from "../../../services/link_embed";
import { useKeyboardShortcuts, useLegacyImperativeHandlers, useNoteContext, useSyncedRef, useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import type { AiNoteLocation } from "./ai_assistant_stream";
import { useAiMenuFooter, useAiQuickActions } from "./ai_quick_actions";
import { buildConfig, BuildEditorOptions } from "./config";

export type BoxSize = "small" | "medium" | "full" | "expandable";

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

/**
 * The `EventInfo` CKEditor hands to every listener as its *first* argument. Listeners on
 * `show:warning` receive `(evt, data)` in that order — getting it backwards throws inside the
 * event handler, which the watchdog reports as an editor crash (see #10859).
 */
export interface NotificationEventInfo {
    stop(): void;
}

/** The payload of `Notification#show:warning`, as built by `Notification#_showNotification`. */
export interface NotificationEventData {
    /** The notification text. `Notification#showWarning` takes it as its first argument. */
    message: string;
    type: "success" | "info" | "warning";
    /** Empty string when the caller did not supply one. */
    title: string;
}

interface CKEditorWithWatchdogProps extends Pick<HTMLProps<HTMLDivElement>, "className" | "tabIndex"> {
    contentLanguage: string | null | undefined;
    isClassicEditor?: boolean;
    watchdogRef: RefObject<EditorWatchdog>;
    watchdogConfig?: WatchdogConfig;
    onNotificationWarning?: (evt: NotificationEventInfo, data: NotificationEventData) => void;
    onWatchdogStateChange?: (watchdog: EditorWatchdog) => void;
    onChange: () => void;
    /** Called upon whenever a new CKEditor instance is initialized, whether it's the first initialization, after a crash or after a config change that requires it (e.g. content language). */
    onEditorInitialized?: (editor: CKTextEditor) => void;
    editorApi: RefObject<CKEditorApi>;
    templates: SnippetDefinition[];
    containerRef?: RefObject<HTMLDivElement>;
}

export default function CKEditorWithWatchdog({ containerRef: externalContainerRef, contentLanguage, className, tabIndex, isClassicEditor, watchdogRef: externalWatchdogRef, watchdogConfig, onNotificationWarning, onWatchdogStateChange, onChange, onEditorInitialized, editorApi, templates }: CKEditorWithWatchdogProps) {
    const containerRef = useSyncedRef<HTMLDivElement>(externalContainerRef, null);
    const watchdogRef = useRef<EditorWatchdog>(null);
    // Serializes editor build/teardown so overlapping effect runs never operate on the same
    // container concurrently. Under Vite + Prefresh HMR, effects are force-re-run (ignoring the
    // dependency array) and can fire several times in quick succession; without this queue two
    // `buildEditor` calls could race on the same <div> and trip CKEditor's
    // `editor-source-element-already-used` guard.
    const buildQueueRef = useRef<Promise<void>>(Promise.resolve());
    // Keep the latest snippet definitions reachable from the (rarely re-running) build effect without
    // listing `templates` as one of its dependencies. Snippet changes are pushed into the live editor
    // instead of forcing a rebuild — see the "push snippet definitions" effect below.
    const templatesRef = useRef(templates);
    templatesRef.current = templates;
    const [ uiLanguage ] = useTriliumOption("locale");
    // Read purely as rebuild triggers: config builders consume the values through options.get() at
    // editor-creation time, so the editor must be recreated when either changes.
    const [ multilineToolbar ] = useTriliumOptionBool("textNoteEditorMultilineToolbar");
    const [ mathFieldEnabled ] = useTriliumOptionBool("mathFieldEnabled");
    // Rebuild triggers for the same reason, and there is no cheaper option for these: CKEditor bakes
    // the transformation list at plugin init — `normalizeTransformations` runs once inside
    // `_enableTransformationWatchers` — so unlike the settings read through a getter (link previews,
    // clipboard image embedding) a live editor has nothing left to re-read.
    const [ doubleQuoteStyle ] = useTriliumOption("textNoteDoubleQuoteStyle");
    const [ singleQuoteStyle ] = useTriliumOption("textNoteSingleQuoteStyle");
    const [ punctuationReplacements ] = useTriliumOptionBool("textNotePunctuationReplacementsEnabled");
    const [ mathReplacements ] = useTriliumOptionBool("textNoteMathReplacementsEnabled");
    const [ symbolReplacements ] = useTriliumOptionBool("textNoteSymbolReplacementsEnabled");
    // The raw JSON, deliberately: `useTriliumOptionJson` parses on every render and would hand back a
    // new array each time, rebuilding the editor continuously. A string compares by value.
    const [ customReplacements ] = useTriliumOption("textNoteCustomReplacements");
    // Which language a note with no `#language` of its own is written in, and so which quotes it
    // gets. The UI locale it can fall back to is already covered by `uiLanguage` above.
    const [ defaultContentLanguage ] = useTriliumOption("defaultContentLanguage");
    // Rebuild triggers as well: `buildHtmlSupportConfig()` reads both at editor-creation time, and
    // GHS turns its allow-list into schema definitions and converters when `DataSchema`/`DataFilter`
    // register at init, so there is nothing for a live editor to re-read. The raw JSON string for
    // the tag list, for the same by-value reason as `customReplacements` above.
    const [ htmlSupportEnabled ] = useTriliumOptionBool("textNoteHtmlSupportEnabled");
    const [ allowedHtmlTags ] = useTriliumOption("allowedHtmlTags");
    // Whether the AI assistant is offered at all, which `buildConfig()` settles at creation time:
    // it decides both the transport the command gates on and whether the toolbars carry the
    // assistant's entries, neither of which a live editor can be told about afterwards. Switching
    // the AI features off has to take the button away there and then, not at the next rebuild.
    // The provider list is a rebuild trigger for the same reason — configuring the first one (or
    // removing the last) is what makes the feature usable.
    const [ aiEnabled ] = useTriliumOptionBool("aiEnabled");
    const [ llmProviders ] = useTriliumOption("llmProviders");
    // Deliberately *not* a rebuild trigger — pushed into the live editor by the effect below
    // instead. The enabled content languages fill the assistant's Translate submenu, which now
    // offers the row that edits them, so the change is made from inside the editor and several
    // times over while the modal is open; the custom actions are notes, written and revised in the
    // editor itself. A rebuild for either would cost the caret and the undo history of the note
    // being written.
    const quickActions = useAiQuickActions();
    const menuFooter = useAiMenuFooter();
    const [ editor, setEditor ] = useState<CKTextEditor>();
    const { parentComponent, ntxId, note, notePath } = useNoteContext();
    // Which note the assistant says a run is writing into. Kept in a ref for the same reason the
    // snippets are: switching notes reuses the editor rather than rebuilding it, so a captured
    // note would name whichever one happened to be open when the editor was built.
    const noteLocationRef = useRef<AiNoteLocation | null>(null);
    noteLocationRef.current = note ? { title: note.title, notePath } : null;

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
        },
        async fetchLinkMetadata(url: string) {
            // The preview's pictures are stored as attachments of the note being edited, so there
            // is nothing to fetch into before the note context has resolved one. Answering as
            // unresolved leaves the URL a plain link, which is what the editor does with any
            // preview it could not build.
            if (!note) {
                return linkEmbedService.unresolvedMetadata(url);
            }

            return await linkEmbedService.fetchMetadata(url, note.noteId);
        },
        detectEmbedType(url: string) {
            return linkEmbedService.detectEmbedType(url);
        },
        renderLinkEmbed(container: HTMLElement, metadata: EmbedMetadata) {
            linkEmbedService.renderEmbedPreview(container, metadata, true);
        },
        renderLinkMention(container: HTMLElement, metadata: EmbedMetadata) {
            linkEmbedService.renderMentionPreview(container, metadata, true);
        }
    });

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let isStale = false;

        const init = async () => {
            // Preserve the scroll position across editor recreation: rebuilding the editor briefly
            // empties the content, which collapses the surrounding scrolling container back to the top.
            const scrollContainer = container.closest<HTMLElement>(".scrolling-container");
            const scrollTop = scrollContainer?.scrollTop ?? 0;

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
                    isClassicEditor: !!isClassicEditor,
                    uiLanguage: uiLanguage as DISPLAYABLE_LOCALE_IDS,
                    contentLanguage: contentLanguage ?? null,
                    templates: templatesRef.current,
                    getNoteLocation: () => noteLocationRef.current
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

            await watchdog.create(container, {});

            if (isStale || !scrollContainer || !scrollTop) return;

            // Restore after the content has been set and laid out, otherwise the container is still
            // collapsed and the assignment gets clamped to a smaller scroll height.
            requestAnimationFrame(() => {
                if (!isStale) {
                    // `behavior: "instant"` overrides the container's `scroll-behavior: smooth`,
                    // so the position is restored without an animation.
                    scrollContainer.scrollTo({ top: scrollTop, behavior: "instant" });
                }
            });
        };

        // Chain this run behind any in-flight build/teardown so two editors are never created on
        // the same container concurrently. Skipping when already stale avoids rebuilding for an
        // effect run that a newer one has already superseded. The queue promise is kept
        // always-resolving so one failed build can't wedge every subsequent run.
        buildQueueRef.current = buildQueueRef.current
            .then(() => (isStale ? undefined : init()))
            .catch((e) => {
                console.warn("CKEditor build failed", e);
            });

        return () => {
            isStale = true;
        };
        // `templates` is intentionally excluded: snippet changes are pushed into the live editor by the
        // effect below, so they must not trigger a full editor rebuild.
        //
        // The options below are not read in this effect — `buildConfig` goes to the options store
        // itself — but they are listed so that changing one rebuilds the editor. The rebuild is what
        // makes them apply to an already-open note; it costs the cursor position and undo history,
        // which is acceptable for a change made deliberately over in the settings.
    }, [
        contentLanguage, uiLanguage, isClassicEditor, multilineToolbar, mathFieldEnabled,
        doubleQuoteStyle, singleQuoteStyle, punctuationReplacements, mathReplacements, symbolReplacements,
        customReplacements, defaultContentLanguage, htmlSupportEnabled, allowedHtmlTags,
        aiEnabled, llmProviders
    ]);

    // Push snippet ("template") definitions into the live editor instead of rebuilding it. The premium
    // Template plugin read its definitions once at init; TriliumSnippets keeps them in a live
    // collection, so add/remove/rename/re-icon all apply in place.
    useEffect(() => {
        if (!editor || !templates) return;
        if (editor.plugins.has("TriliumSnippets")) {
            editor.plugins.get("TriliumSnippets").updateDefinitions(templates);
        }
    }, [ editor, templates ]);

    // Likewise for the AI quick actions: enabling a content language or writing a `#aiQuickAction`
    // note shows up in the menu without the note being edited losing its undo history.
    useEffect(() => {
        if (!editor) return;
        if (editor.plugins.has("AiAssistantUI")) {
            editor.plugins.get("AiAssistantUI").updateQuickActions(quickActions);
        }
    }, [ editor, quickActions ]);

    // Likewise for the row naming the model a run speaks to, which restates itself once picked.
    useEffect(() => {
        if (!editor) return;
        if (editor.plugins.has("AiAssistantUI")) {
            editor.plugins.get("AiAssistantUI").updateMenuFooter(menuFooter);
        }
    }, [ editor, menuFooter ]);


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
    const config = await buildConfig(opts);
    return await editorClass.create(element, config);
}
