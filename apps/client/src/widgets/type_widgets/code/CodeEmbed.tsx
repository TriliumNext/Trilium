import type { ContentEmbedCodeView } from "@triliumnext/ckeditor5";
import type VanillaCodeMirror from "@triliumnext/codemirror";
import { getMimeTypeFromCKEditorLanguage } from "@triliumnext/commons";
import moveVerticalIcon from "boxicons/svg/regular/bx-move-vertical.svg?raw";
import { createPortal, type RefObject } from "preact";
import { lazy, Suspense, useSyncExternalStore } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";

import type { CommandNames } from "../../../components/app_context";
import type FAttachment from "../../../entities/fattachment";
import FNote from "../../../entities/fnote";
import type { MenuItem } from "../../../menus/context_menu";
import { copyTextWithToast } from "../../../services/clipboard_ext";
import type { CodePreviewLines } from "../../../services/code_note_preview";
import type { ContentEditor } from "../../../services/content_renderer";
import { t } from "../../../services/i18n";
import { PLAIN_TEXT_MIME } from "../../../services/mime_types";
import type { SourceEmbedProps } from "../../../services/source_embeds";
import {
    type CodeSettings, type CodeText, getLineNumbersMenu, getWordWrapMenu, useCodeLanguageMenu,
    useNoteCodeSettings, useTabWidthMenu
} from "../../layout/code_menus";
import { SaveStateBadge } from "../../layout/NoteBadges";
import { useMimeTypes } from "../../layout/NoteTypeSwitcher";
import ActionButton from "../../react/ActionButton";
import {
    useNoteBlob, useNoteLabelOptionalBool, useTriliumEvent, useWhenShown
} from "../../react/hooks";
import { useContentEmbedMenus } from "../text/content_embed_menus";
import {
    type ContentEmbedToolbarItem, useContentEmbedAttribute, useContentEmbedFlag
} from "../text/content_embed_tools";
import {
    CaretNavigationContext, findTextEditorAround, useEditableEmbed, useEmbedBadgeSlot
} from "../text/editable_embed";

const CodeEmbedEditor = lazy(() => import("./CodeEmbedEditor"));

/** The items that the toolbar of an extended code block leaves to the menu of its embed. */
const EXTENDED_CODE_BLOCK_HIDDEN_ITEMS: readonly ContentEmbedToolbarItem[] = [
    "contentEmbedBoxSizeDropdown", "toggleContentEmbedEditable"
];

interface CodeEmbedProps {
    entity: FNote | FAttachment;
    /** Saves the changes to `entity`, or `undefined` where the content is read-only. */
    editor: ContentEditor | undefined;
    /** The content shown first. */
    content: string;
    /**
     * The MIME type that highlights the content: the language of a note, or that of the name of
     * a file. A note follows its own `mime` as it changes.
     */
    mime: string;
    /** The language that the embed of a file sets, as a MIME type, in place of `mime`. */
    codeLanguage?: string;
    /** The line wrapping that the embed of a file sets, in place of the option. */
    isCodeWrapped?: boolean;
    /** Whether the embed shows line numbers, in place of the option. */
    hasCodeLineNumbers?: boolean;
}

/**
 * A code note or a code file in an embed, shown in a read-only CodeMirror, which edits the content
 * while the Editable toggle of its embed is on.
 */
export default function CodeEmbed({
    entity, editor, content: initialContent, mime: initialMime, codeLanguage, isCodeWrapped,
    hasCodeLineNumbers
}: CodeEmbedProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const note = entity instanceof FNote ? entity : null;
    const noteSettings = useNoteCodeSettings(note);
    const fileSettings = useFileCodeSettings(rootRef, initialMime, codeLanguage);
    const settings = note ? noteSettings : fileSettings;
    const [ content, setContent ] = useState(initialContent);
    useSavedContent(entity, editor, setContent, rootRef);

    return (
        <CodeEmbedContent
            rootRef={rootRef}
            note={note}
            ownerNote={entity instanceof FNote ? entity : entity.getNote()}
            editor={editor}
            content={content}
            onContentChange={setContent}
            settings={settings}
            mime={settings.mime ?? initialMime}
            initialLines={{ isWrapped: isCodeWrapped, hasLineNumbers: hasCodeLineNumbers }}
            hasSaveStatus
        />
    );
}

/**
 * An extended code block: code kept inline in a text note, shown in a read-only CodeMirror, which
 * edits it while the Editable toggle of its embed is on. The language is the `data-language`
 * attribute of the embed, and the indentation and the lines its `data-code-*` attributes.
 */
export function InlineCodeEmbed({ content: savedContent, editor, language }: SourceEmbedProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const settings = useInlineCodeSettings(rootRef, language);
    const [ content, setContent ] = useState(savedContent);

    // Code written elsewhere, or undone, replaces the shown code unless it has unsaved edits.
    useEffect(() => {
        if (editor?.getUnsavedContent() === undefined) {
            setContent(savedContent);
        }
    }, [ savedContent ]);

    return (
        <CodeEmbedContent
            rootRef={rootRef}
            note={null}
            ownerNote={null}
            editor={editor}
            content={content}
            onContentChange={setContent}
            settings={settings}
            mime={settings.mime ?? PLAIN_TEXT_MIME}
            hasLanguageLabel
            hasCopyButton
            hiddenToolbarItems={EXTENDED_CODE_BLOCK_HIDDEN_ITEMS}
        />
    );
}

interface CodeEmbedContentProps {
    /** The root of the content. The parent reads the settings of the embed through it. */
    rootRef: RefObject<HTMLDivElement | null>;
    note: FNote | null;
    /** The note that holds an attachment, which images upload to and new notes go under. */
    ownerNote: FNote | null;
    editor: ContentEditor | undefined;
    content: string;
    /** Receives the content when it changes in the embed. */
    onContentChange: (content: string) => void;
    settings: CodeSettings;
    /** The MIME type that highlights the content. */
    mime: string;
    /** How the lines show until the content is in the embed. */
    initialLines?: CodePreviewLines;
    /** Whether the title row shows the save state while the content is edited. */
    hasSaveStatus?: boolean;
    /** Whether the editor shows the name of its language in its corner while it is edited. */
    hasLanguageLabel?: boolean;
    /**
     * Whether a button in the corner copies the content while it is not edited, as on a code
     * block of a read-only text note.
     */
    hasCopyButton?: boolean;
    /** The items of the embed toolbar to hide. The menu of the embed still offers them. */
    hiddenToolbarItems?: readonly ContentEmbedToolbarItem[];
}

/** CodeMirror over the code of an embed, and the tools of the embed toolbar for it. */
function CodeEmbedContent({
    rootRef, note, ownerNote, editor, content, onContentChange, settings, mime, initialLines,
    hasSaveStatus, hasLanguageLabel, hasCopyButton, hiddenToolbarItems
}: CodeEmbedContentProps) {
    const viewRef = useRef<VanillaCodeMirror>(null);
    // The toolbar buttons come from `CodeTools`, with the Editable toggle.
    const { canEdit, isEditing } = useEditableEmbed(rootRef, {
        editor, note, tools: null, focusTarget: ".cm-content"
    });
    const lines = useEmbedLines(rootRef, note, initialLines);
    const languageLabel = useMimeTypeTitle(mime);
    // The editor while the content is edited, otherwise the content with the unsaved changes of any
    // embed of it, which a change saves.
    const getCodeText = (): CodeText => (isEditing ? viewRef.current : null) ?? {
        getText: () => editor?.getUnsavedContent() ?? content,
        setText: (text) => {
            // Through the read-only editor, the change is a step of the shared undo history.
            const view = viewRef.current;
            const unsavedContent = editor?.getUnsavedContent() ?? content;
            if (view && view.getText() !== unsavedContent) {
                view.loadText(unsavedContent);
            }
            view?.setText(text);
            editor?.scheduleSave(() => text);
            onContentChange(text);
        }
    };

    return (
        <>
            <div ref={rootRef} className="code-embed-content">
                <CaretNavigationContext.Provider value={isEditing ? rootRef : null}>
                    <Suspense fallback={null}>
                        <CodeEmbedEditor
                            note={note}
                            ownerNote={ownerNote}
                            editor={isEditing ? editor : undefined}
                            history={editor?.history}
                            content={content}
                            mime={mime}
                            tabWidth={settings.tabWidth}
                            useTabs={settings.useTabs}
                            wrapLines={lines.wrapLines}
                            hasLineNumbers={lines.hasLineNumbers}
                            languageLabel={hasLanguageLabel && isEditing ? languageLabel : undefined}
                            viewRef={viewRef}
                            onClose={onContentChange}
                        />
                    </Suspense>
                </CaretNavigationContext.Provider>
                {hasCopyButton && !isEditing && (
                    <ActionButton
                        className="tn-tool-button copy-button"
                        icon="bx bx-copy"
                        text={t("code_block.copy_title")}
                        onClick={(e) => {
                            e.stopPropagation();
                            copyTextWithToast(getCodeText().getText());
                        }}
                    />
                )}
            </div>
            {hasSaveStatus && editor && (
                <SaveStatus rootRef={rootRef} editor={editor} isShown={isEditing} />
            )}
            <CodeTools
                rootRef={rootRef}
                settings={settings}
                canEdit={canEdit}
                menuItems={lines.menuItems}
                getCodeText={getCodeText}
                hiddenToolbarItems={hiddenToolbarItems}
            />
        </>
    );
}

/** How a code editor in an embed, and its preview, show their lines. */
export interface EmbedLines {
    /** Whether to wrap the lines, or `undefined` to follow the global option. */
    wrapLines: boolean | undefined;
    /** Whether to show the line numbers, or `undefined` to follow the global option. */
    hasLineNumbers: boolean | undefined;
    /** The "Word wrap" and "Line numbers" submenus, for the menu of the embed. */
    menuItems: MenuItem<CommandNames>[];
}

/**
 * How the code editor in the embed around `rootRef` shows its lines. The line wrapping of `note`
 * is its `#wrapLines` label. The embed keeps the line numbers, and the line wrapping of content
 * other than a note, in `data-code-*` attributes. `initial` applies until the content is in the
 * embed.
 */
export function useEmbedLines(
    rootRef: RefObject<HTMLElement | null>,
    note: FNote | null,
    initial: CodePreviewLines = {}
): EmbedLines {
    const [ noteWrapLines, setNoteWrapLines ] = useNoteLabelOptionalBool(note, "wrapLines");
    const embedWrapLines = useContentEmbedFlag(rootRef, "data-code-wrap-lines", initial.isWrapped);
    const lineNumbers = useContentEmbedFlag(
        rootRef, "data-code-line-numbers", initial.hasLineNumbers
    );
    const wrapLines = note ? noteWrapLines : embedWrapLines;
    const setWrapLines = (value: boolean | null) => {
        if (note) {
            setNoteWrapLines(value);
        } else {
            setCodeView(rootRef.current, { wrapLines: value });
        }
    };

    return {
        wrapLines,
        hasLineNumbers: lineNumbers,
        menuItems: [
            getWordWrapMenu(wrapLines, setWrapLines),
            getLineNumbersMenu(lineNumbers, (value) => {
                setCodeView(rootRef.current, { lineNumbers: value });
            })
        ]
    };
}

/**
 * The code settings of a file, which its embed keeps in `data-code-*` attributes: a language that
 * replaces `fileMime`, the language of its name, and the indentation. `initialLanguage` is the
 * language until the content is in the embed.
 */
function useFileCodeSettings(
    rootRef: RefObject<HTMLElement | null>,
    fileMime: string,
    initialLanguage: string | undefined
): CodeSettings {
    const language = useContentEmbedAttribute(rootRef, "data-code-language", initialLanguage ?? null);

    return {
        ...useEmbedIndentation(rootRef),
        mime: language ?? fileMime,
        setMime: (mime) => {
            setCodeView(rootRef.current, { language: mime === fileMime ? null : mime });
        }
    };
}

/**
 * The code settings of an extended code block: the language, from the `data-language` attribute
 * of its embed, and the indentation. `initialLanguage` is the language until the content is in the
 * embed. Both languages are CKEditor code block languages.
 */
function useInlineCodeSettings(
    rootRef: RefObject<HTMLElement | null>,
    initialLanguage: string | undefined
): CodeSettings {
    const language = useContentEmbedAttribute(rootRef, "data-language", initialLanguage ?? null);

    return {
        ...useEmbedIndentation(rootRef),
        mime: language ? getMimeTypeFromCKEditorLanguage(language) : undefined,
        setMime: (mime) => setCodeView(rootRef.current, { language: mime })
    };
}

/** The indentation, from the `data-code-*` attributes of the embed around `rootRef`. */
function useEmbedIndentation(
    rootRef: RefObject<HTMLElement | null>
): Pick<CodeSettings, "tabWidth" | "useTabs" | "setIndentation"> {
    const tabWidth = useContentEmbedAttribute(rootRef, "data-code-tab-width");
    const useTabs = useContentEmbedAttribute(rootRef, "data-code-indent-with-tabs");

    return {
        tabWidth: tabWidth ? parseInt(tabWidth, 10) || undefined : undefined,
        useTabs: useTabs === null ? undefined : useTabs === "true",
        setIndentation: (indentation) => setCodeView(rootRef.current, {
            tabWidth: indentation.tabWidth,
            indentWithTabs: indentation.useTabs
        })
    };
}

/** The name of the language of `mime`, such as "Python". */
function useMimeTypeTitle(mime: string) {
    const { allMimeTypes } = useMimeTypes();
    return allMimeTypes.find((mimeType) => mimeType.mime === mime)?.title;
}

/** Sets how the embed around `root` shows its code, through the text editor that holds it. */
function setCodeView(root: HTMLElement | null, codeView: ContentEmbedCodeView) {
    const editor = findTextEditorAround(root);
    if (!root || !editor?.plugins.get("ContentEmbed").selectEmbedAt(root)) return;

    editor.execute("setContentEmbedCodeView", codeView);
}

interface CodeToolsProps {
    rootRef: RefObject<HTMLElement | null>;
    settings: CodeSettings;
    /** Whether the content can be edited, which offers the menus and the Editable toggle. */
    canEdit: boolean;
    /** The items of the menu of the embed. */
    menuItems: MenuItem<CommandNames>[];
    /** The text that the re-indent items of the tab width menu convert. */
    getCodeText: () => CodeText;
    /** The items of the embed toolbar to hide. The menu of the embed still offers them. */
    hiddenToolbarItems?: readonly ContentEmbedToolbarItem[];
}

/**
 * The box size of the embed around `rootRef` as an icon of its toolbar, and while `canEdit`, the
 * "Change language mode" and "Change tab width" menus of the status bar as buttons of the toolbar
 * and `menuItems` in the menu of the embed.
 */
function CodeTools({
    rootRef, settings, canEdit, menuItems, getCodeText, hiddenToolbarItems
}: CodeToolsProps) {
    const language = useCodeLanguageMenu(settings);
    const tabWidth = useTabWidthMenu(settings, async () => getCodeText());
    useContentEmbedMenus(rootRef, canEdit ? [
        { id: "codeLanguage", ...language.menu },
        { id: "tabWidth", ...tabWidth }
    ] : [], canEdit ? menuItems : [], {
        hasEditableFlag: canEdit,
        boxSizeIcon: moveVerticalIcon,
        hiddenToolbarItems
    });

    return canEdit ? language.modal : null;
}

interface SaveStatusProps {
    rootRef: RefObject<HTMLElement | null>;
    editor: ContentEditor;
    isShown: boolean;
}

/**
 * The save state of `editor` in the title row of the embed around `rootRef`, while `isShown`, for
 * content that saves on its own.
 */
export function SaveStatus({ rootRef, editor, isShown }: SaveStatusProps) {
    const slot = useEmbedBadgeSlot(rootRef, isShown);
    const state = useSyncExternalStore(
        editor.subscribeSaveState ?? subscribeToNothing,
        () => editor.getSaveState?.()
    );

    return slot && createPortal(<SaveStateBadge state={state} />, slot);
}

/**
 * Shows the content of `entity` after each save, also one made by another embed of it, once
 * `shownRef` is shown. Unsaved changes made in the embed are kept, and replace that content when
 * they save.
 */
export function useSavedContent(
    entity: FNote | FAttachment,
    editor: ContentEditor | undefined,
    setContent: (content: string) => void,
    shownRef: RefObject<Element | null>
) {
    const noteBlob = useNoteBlob(entity instanceof FNote ? entity : null, undefined, { shownRef });
    const [ attachmentContent, setAttachmentContent ] = useState<string>();
    const requestIdRef = useRef(0);
    const whenShown = useWhenShown(shownRef);
    const content = entity instanceof FNote ? noteBlob?.content : attachmentContent;

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (entity instanceof FNote) return;
        const rows = loadResults.getAttachmentRows();
        if (rows.some((row) => row.attachmentId === entity.attachmentId)) {
            const requestId = ++requestIdRef.current;
            void entity.getBlob().then((blob) => {
                if (requestId !== requestIdRef.current) return;
                whenShown(() => {
                    if (requestId === requestIdRef.current) {
                        setAttachmentContent(blob?.content);
                    }
                });
            });
        }
    });

    useEffect(() => {
        if (content !== undefined && editor?.getUnsavedContent() === undefined) {
            setContent(content);
        }
    }, [ content ]);
}

function subscribeToNothing() {
    return () => {};
}
