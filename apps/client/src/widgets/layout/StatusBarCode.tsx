import type CodeMirror from "@triliumnext/codemirror";
import type { CursorPosition } from "@triliumnext/codemirror";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Trans } from "react-i18next";

import { t } from "../../services/i18n";
import { useGetContextDataFrom } from "../react/hooks/note_context";
import { useStaticTooltip } from "../react/hooks/tooltip";
import { type CodeMenu, useCodeLanguageMenu, useNoteCodeSettings, useTabWidthMenu } from "./code_menus";
import { type StatusBarContext, StatusBarDropdown, TOOLTIP_OPTIONS } from "./StatusBar";

/**
 * The items the status bar shows for a code note: the cursor position, the language and the tab
 * width. `StatusBar.tsx` imports this module once a code note is shown.
 */
export default function CodeItems(context: StatusBarContext) {
    return (
        <>
            <CodeCursorPosition {...context} />
            <CodeNoteSwitcher {...context} />
            <TabWidthSwitcher {...context} />
        </>
    );
}

//#region Cursor position
function CodeCursorPosition({ noteContext }: StatusBarContext) {
    const editor = useGetContextDataFrom(noteContext, "codeEditor");
    const position = useCursorPosition(editor);

    return (position &&
        <span className="cursor-position">
            <CursorPositionPart
                i18nKey="status_bar.cursor_line"
                title={t("status_bar.cursor_line_title")}
                value={position.line}
            />
            <CursorPositionPart
                i18nKey="status_bar.cursor_column"
                title={t("status_bar.cursor_column_title")}
                value={position.column}
            />
            {position.selectionLength > 0 && <CursorPositionPart
                i18nKey="status_bar.cursor_selection"
                title={t("status_bar.cursor_selection_title")}
                value={position.selectionLength}
            />}
        </span>
    );
}

/** One part of the cursor position, such as "Ln: 12", with the number emphasized. */
function CursorPositionPart({ i18nKey, title, value }: {
    i18nKey: string;
    title: string;
    value: number;
}) {
    const partRef = useRef<HTMLSpanElement>(null);
    // `useStaticTooltip()` rebuilds the tooltip when its config changes, and `value` changes as
    // the cursor moves.
    const tooltipOptions = useMemo(() => ({ ...TOOLTIP_OPTIONS, title }), [ title ]);
    useStaticTooltip(partRef, tooltipOptions);

    return (
        <span ref={partRef}>
            <Trans
                i18nKey={i18nKey}
                components={{ Value: <span className="value">{value}</span> as React.ReactElement }}
            />
        </span>
    );
}

/** The cursor position of `editor`, updated as the cursor moves. */
function useCursorPosition(editor: CodeMirror | undefined) {
    const [ position, setPosition ] = useState<CursorPosition | null>(null);

    useEffect(() => {
        setPosition(null);
        return editor?.addCursorPositionListener(setPosition);
    }, [ editor ]);

    return position;
}
//#endregion

function TabWidthSwitcher({ note, noteContext }: StatusBarContext) {
    const menu = useTabWidthMenu(useNoteCodeSettings(note), () => noteContext.getCodeEditor());
    return <CodeMenuDropdown menu={menu} />;
}

function CodeNoteSwitcher({ note }: StatusBarContext) {
    const { menu, modal } = useCodeLanguageMenu(useNoteCodeSettings(note));

    return (
        <>
            <CodeMenuDropdown
                menu={menu}
                dropdownContainerClassName="dropdown-code-note-switcher"
            />
            {modal}
        </>
    );
}

function CodeMenuDropdown({ menu, dropdownContainerClassName }: {
    menu: CodeMenu;
    dropdownContainerClassName?: string;
}) {
    return (
        <StatusBarDropdown
            icon={menu.icon}
            text={menu.text}
            title={menu.title}
            dropdownContainerClassName={dropdownContainerClassName}
            filterable={menu.filterable}
            items={menu.items}
        />
    );
}
