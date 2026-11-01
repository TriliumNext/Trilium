import type VanillaCodeMirror from "@triliumnext/codemirror";
import { getCodeLanguageIcon } from "@triliumnext/commons";
import { createPortal } from "preact";
import { useMemo, useState } from "preact/hooks";

import type FNote from "../../entities/fnote";
import type { MenuCommandItem, MenuItem } from "../../menus/context_menu";
import { t } from "../../services/i18n";
import server from "../../services/server";
import {
    useNoteLabelInt, useNoteLabelOptionalBool, useNoteProperty, useTriliumOptionBool,
    useTriliumOptionInt
} from "../react/hooks";
import { codeLanguageItems, NoteTypeOptionsModal, useMimeTypes } from "./NoteTypeSwitcher";
import { convertIndentation } from "./reindentation";

/** The language and indentation of a code note or a code file, and how to change them. */
export interface CodeSettings {
    /** The language, as a MIME type. */
    mime: string | undefined;
    setMime(mime: string): void;
    /** The tab width, or `undefined` to follow the global option. */
    tabWidth: number | undefined;
    /** Whether to indent with tabs, or `undefined` to follow the global option. */
    useTabs: boolean | undefined;
    /** Sets each setting given, and follows the global option again for each given as `null`. */
    setIndentation(indentation: { tabWidth?: number | null; useTabs?: boolean | null }): void;
}

/** A menu of the code settings, and what the control that opens it shows. */
export interface CodeMenu {
    /** The name of the menu, shown as the tooltip of the control. */
    title: string;
    /** The current setting, shown as the text of the control. */
    text: string;
    /** The icon of the current setting. */
    icon: string;
    items: MenuItem<unknown>[];
    filterable?: boolean;
}

/** The text of a code editor, which the tab width menu re-indents. */
export type CodeText = Pick<VanillaCodeMirror, "getText" | "setText">;

/**
 * The code settings of `note`: its MIME type, and its `#tabWidth` and `#indentWithTabs` labels.
 */
export function useNoteCodeSettings(note: FNote | null | undefined): CodeSettings {
    const mime = useNoteProperty(note, "mime");
    const [ tabWidth, setTabWidth ] = useNoteLabelInt(note, "tabWidth");
    const [ useTabs, setUseTabs ] = useNoteLabelOptionalBool(note, "indentWithTabs");

    return {
        mime,
        setMime: (newMime) => {
            if (note) void server.put(`notes/${note.noteId}/type`, { type: "code", mime: newMime });
        },
        tabWidth,
        useTabs,
        setIndentation: (indentation) => {
            if (indentation.tabWidth !== undefined) setTabWidth(indentation.tabWidth);
            if (indentation.useTabs !== undefined) setUseTabs(indentation.useTabs);
        }
    };
}

/**
 * The "Word wrap" submenu of a code editor: follow the global option, on, or off.
 *
 * @param wrapLines whether to wrap the lines, or `undefined` to follow the global option.
 * @param setWrapLines sets the line wrapping, or follows the global option again for `null`.
 */
export function getWordWrapMenu<T>(
    wrapLines: boolean | undefined,
    setWrapLines: (wrapLines: boolean | null) => void
): MenuCommandItem<T> {
    return {
        title: t("note_actions.word_wrap"),
        uiIcon: "bx bx-align-justify",
        items: getAutoOnOffItems(wrapLines, setWrapLines, {
            auto: t("note_actions.word_wrap_auto"),
            autoDescription: t("note_actions.word_wrap_auto_description"),
            on: t("note_actions.word_wrap_on"),
            off: t("note_actions.word_wrap_off")
        })
    };
}

/**
 * The "Line numbers" submenu of a code embed: follow the global option, on, or off.
 *
 * @param lineNumbers whether the embed shows line numbers, or `undefined` to follow the global
 * option.
 * @param setLineNumbers sets them, or follows the global option again for `null`.
 */
export function getLineNumbersMenu<T>(
    lineNumbers: boolean | undefined,
    setLineNumbers: (lineNumbers: boolean | null) => void
): MenuCommandItem<T> {
    return {
        title: t("link_context_menu.line_numbers"),
        uiIcon: "bx bx-list-ol",
        items: getAutoOnOffItems(lineNumbers, setLineNumbers, {
            auto: t("link_context_menu.line_numbers_auto"),
            autoDescription: t("link_context_menu.line_numbers_auto_description"),
            on: t("link_context_menu.line_numbers_on"),
            off: t("link_context_menu.line_numbers_off")
        })
    };
}

/**
 * The "Change language mode" menu of `settings`, and the dialog that its "Configure code notes"
 * item opens, which the caller renders.
 */
export function useCodeLanguageMenu({ mime, setMime }: CodeSettings) {
    const [ isModalShown, setIsModalShown ] = useState(false);
    const { enabledMimeTypes, allMimeTypes } = useMimeTypes();
    const mimeType = useMemo(() => (
        allMimeTypes.find((candidate) => candidate.mime === mime)
    ), [ allMimeTypes, mime ]);

    const menu: CodeMenu = {
        title: t("status_bar.code_note_switcher"),
        text: mimeType?.title ?? "",
        icon: getCodeLanguageIcon(mimeType),
        items: codeLanguageItems({
            currentMimeType: mime,
            mimeTypes: enabledMimeTypes,
            changeNoteType: (_type, newMime) => setMime(newMime),
            onConfigure: () => setIsModalShown(true)
        }),
        filterable: true
    };
    const modal = createPortal(
        <NoteTypeOptionsModal modalShown={isModalShown} setModalShown={setIsModalShown} />,
        document.body
    );
    return { menu, modal };
}

const TAB_WIDTH_OPTIONS = [ 1, 2, 3, 4, 6, 8 ] as const;

/**
 * The "Change tab width" menu of `settings`. Its re-indent items convert the text of
 * `getCodeEditor()`, and do nothing while it returns no editor.
 */
export function useTabWidthMenu(
    { tabWidth, useTabs, setIndentation }: CodeSettings,
    getCodeEditor: () => Promise<CodeText | null | undefined>
): CodeMenu {
    const [ globalTabWidth ] = useTriliumOptionInt("codeNoteTabWidth");
    const [ globalUseTabs ] = useTriliumOptionBool("codeNoteIndentWithTabs");
    const effectiveTabWidth = tabWidth ?? globalTabWidth ?? 4;
    const effectiveUseTabs = useTabs ?? globalUseTabs;

    const reindentTo = async (targetUseTabs: boolean, targetWidth: number) => {
        const editor = await getCodeEditor();
        if (!editor) return;
        const converted = convertIndentation(
            editor.getText(),
            { useTabs: effectiveUseTabs, width: effectiveTabWidth },
            { useTabs: targetUseTabs, width: targetWidth }
        );
        if (converted !== editor.getText()) {
            editor.setText(converted);
        }
        setIndentation({ tabWidth: targetWidth, useTabs: targetUseTabs });
    };

    const spacesName = t("status_bar.tab_width_style_spaces");
    const tabsName = t("status_bar.tab_width_style_tabs");
    const items: MenuItem<unknown>[] = [
        { kind: "header", title: t("status_bar.tab_width_style_header") },
        {
            title: spacesName,
            checked: !effectiveUseTabs,
            handler: () => setIndentation({ useTabs: false })
        },
        {
            title: tabsName,
            checked: effectiveUseTabs,
            handler: () => setIndentation({ useTabs: true })
        }
    ];
    if (useTabs !== undefined) {
        items.push({
            title: t("status_bar.tab_width_use_default_style", {
                style: globalUseTabs ? tabsName : spacesName
            }),
            uiIcon: "bx bx-x",
            handler: () => setIndentation({ useTabs: null })
        });
    }

    items.push({ kind: "header", title: t("status_bar.tab_width_display_header") });
    for (const size of TAB_WIDTH_OPTIONS) {
        items.push({
            title: t("status_bar.tab_width_spaces", { count: size }),
            checked: effectiveTabWidth === size,
            handler: () => setIndentation({ tabWidth: size })
        });
    }
    if (tabWidth !== undefined) {
        items.push({
            title: t("status_bar.tab_width_use_default", { width: globalTabWidth }),
            uiIcon: "bx bx-x",
            handler: () => setIndentation({ tabWidth: null })
        });
    }

    items.push({ kind: "header", title: t("status_bar.tab_width_reindent_header") });
    for (const size of TAB_WIDTH_OPTIONS) {
        items.push({
            title: t("status_bar.tab_width_spaces", { count: size }),
            uiIcon: "bx bx-empty",
            enabled: effectiveUseTabs || effectiveTabWidth !== size,
            handler: () => void reindentTo(false, size)
        });
    }
    items.push({
        title: tabsName,
        uiIcon: "bx bx-empty",
        enabled: !effectiveUseTabs,
        handler: () => void reindentTo(true, effectiveTabWidth)
    });

    return {
        title: t("status_bar.tab_width_title"),
        text: effectiveUseTabs
            ? t("status_bar.tab_width_tabs", { width: effectiveTabWidth })
            : t("status_bar.tab_width_spaces_short", { width: effectiveTabWidth }),
        icon: "bx bx-right-indent",
        items
    };
}

interface AutoOnOffTitles {
    auto: string;
    autoDescription?: string;
    on: string;
    off: string;
}

/** The Auto, On and Off items of a setting that is `undefined` while it follows its default. */
function getAutoOnOffItems<T>(
    value: boolean | undefined,
    setValue: (value: boolean | null) => void,
    titles: AutoOnOffTitles
): MenuCommandItem<T>[] {
    return [
        {
            title: titles.auto,
            description: titles.autoDescription,
            checked: value === undefined,
            handler: () => setValue(null)
        },
        { title: titles.on, checked: value === true, handler: () => setValue(true) },
        { title: titles.off, checked: value === false, handler: () => setValue(false) }
    ];
}
