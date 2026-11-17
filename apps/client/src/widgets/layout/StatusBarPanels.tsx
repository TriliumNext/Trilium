import type { NoteType, SimilarNoteResponse } from "@triliumnext/commons";
import { NOTE_TYPE_ICONS } from "@triliumnext/commons/src/lib/notes.js";
import clsx from "clsx";
import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import type FNote from "../../entities/fnote";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import { NOTE_TYPES } from "../../services/note_types";
import server from "../../services/server";
import { formatSize, openInAppHelpFromUrl } from "../../services/utils";
import { formatDateTime } from "../../utils/formatters";
import type { DropdownHandle } from "../react/Dropdown";
import HelpDropdown from "../react/HelpDropdown";
import { useNoteLabel } from "../react/hooks/note";
import Icon from "../react/Icon";
import LinkButton from "../react/LinkButton";
import LoadingSpinner from "../react/LoadingSpinner";
import NoItems from "../react/NoItems";
import NoteLink from "../react/NoteLink";
import type { RightPaneTabId } from "../sidebar/RightPaneTabs";
import { useNoteMetadata } from "./note_metadata";

/*
 * What the status bar shows once asked: its panels and the content of its note info dropdown.
 * `StatusBar.tsx` imports this module when one of them first opens.
 */

export function NoteInfoContent({ note, noteType, dropdownRef, setSimilarNotesShown }: {
    note: FNote;
    noteType: NoteType;
    dropdownRef?: RefObject<DropdownHandle | null>;
    setSimilarNotesShown?: (value: boolean) => void;
}) {
    const { metadata, ...sizeProps } = useNoteMetadata(note);
    const [ originalFileName ] = useNoteLabel(note, "originalFileName");
    const noteTypeMapping = useMemo(() => NOTE_TYPES.find(t => t.type === noteType), [ noteType ]);

    return (
        <div className="note-info-content">
            <ul>
                {originalFileName && <NoteInfoValue text={t("file_properties.original_file_name")} value={originalFileName} />}
                <NoteInfoValue text={t("note_info_widget.created")} value={formatDateTime(metadata?.dateCreated)} />
                <NoteInfoValue text={t("note_info_widget.modified")} value={formatDateTime(metadata?.dateModified)} />
                {noteTypeMapping && <NoteInfoValue text={t("note_info_widget.type")} value={<><Icon icon={`bx ${noteTypeMapping.icon ?? NOTE_TYPE_ICONS[noteType]}`}/>{" "}{noteTypeMapping?.title}</>} />}
                {note.mime && <NoteInfoValue text={t("note_info_widget.mime")} value={note.mime} />}
                <NoteInfoValue text={t("note_info_widget.note_id")} value={<code>{note.noteId}</code>} />
                <NoteInfoValue text={t("note_info_widget.note_size")} title={t("note_info_widget.note_size_info")} value={<NoteSizeWidget {...sizeProps} />} />
            </ul>

            {setSimilarNotesShown && <LinkButton
                text={t("note_info_widget.show_similar_notes")}
                onClick={() => {
                    dropdownRef?.current?.hide();
                    setSimilarNotesShown(true);
                }}
            />}
        </div>
    );
}

function NoteInfoValue({ text, title, value }: { text: string; title?: string, value: ComponentChildren }) {
    return (
        <li>
            <strong title={title}>{text}{": "}</strong>
            <span>{value}</span>
        </li>
    );
}

function NoteSizeWidget({ isLoading, noteSizeResponse, subtreeSizeResponse, requestSizeInfo }: Omit<ReturnType<typeof useNoteMetadata>, "metadata">) {
    return <>
        {!isLoading && !noteSizeResponse && !subtreeSizeResponse && (
            <LinkButton
                text={t("note_info_widget.calculate")}
                onClick={requestSizeInfo}
            />
        )}

        <span className="note-sizes-wrapper selectable-text">
            <span className="note-size">{formatSize(noteSizeResponse?.noteSize)}</span>
            {" "}
            {subtreeSizeResponse && subtreeSizeResponse.subTreeNoteCount > 1 &&
                <span className="subtree-size">{t("note_info_widget.subtree_size", { size: formatSize(subtreeSizeResponse.subTreeSize), count: subtreeSizeResponse.subTreeNoteCount })}</span>
            }
            {isLoading && <LoadingSpinner />}
        </span>
    </>;
}

export function SimilarNotesPane({ note, setSimilarNotesShown }: {
    note: FNote;
    setSimilarNotesShown?: (value: boolean) => void;
}) {
    return (
        <BottomPanel title={t("similar_notes.title")}
            className="similar-notes-pane"
            visible
            setVisible={setSimilarNotesShown}
        >
            <SimilarNotesList note={note} />
        </BottomPanel>
    );
}

export function SimilarNotesList({ note }: { note: FNote | null | undefined }) {
    const [ similarNotes, setSimilarNotes ] = useState<SimilarNoteResponse>();

    useEffect(() => {
        if (note) {
            server.get<SimilarNoteResponse>(`similar-notes/${note.noteId}`).then(async similarNotes => {
                if (similarNotes) {
                    const noteIds = similarNotes.flatMap((note) => note.notePath);
                    await froca.getNotes(noteIds, true); // preload all at once
                }
                setSimilarNotes(similarNotes);
            });
        }

    }, [ note?.noteId ]);

    return (
        <div className="similar-notes-widget">
            {similarNotes?.length ? (
                <div className="similar-notes-wrapper">
                    {similarNotes.map(({notePath, score}) => (
                        <NoteLink
                            key={notePath.join("/")}
                            notePath={notePath}
                            noTnLink
                            style={{
                                "font-size": (1 - 1 / (1 + score)) + "em"
                            }}
                        />
                    ))}
                </div>
            ) : similarNotes && (
                // Outside the list's wrapper, whose font size is that of the most similar link.
                <NoItems
                    size="small"
                    icon="bx bx-bar-chart"
                    text={t("similar_notes.no_similar_notes_found")}
                />
            )}
        </div>
    );
}

/**
 * The way from a panel of the status bar to the sidebar tab holding the fuller version of the same
 * thing: the attributes panel edits a note's attributes as a line of text, the sidebar's card as a
 * list with a control apiece. Worded as what is found there rather than as the pane it opens, and
 * shown in the panel's title bar beside its `?`.
 *
 * A pane the user keeps closed is peeked rather than docked — a glance asked for from the status bar
 * is no reason to reflow the content the note is read in.
 */
export function SidebarLink({ text, tabId, onOpened }: { text: string; tabId: RightPaneTabId; onOpened?: () => void }) {
    return (
        <LinkButton
            className="status-bar-sidebar-link"
            text={<>
                <Icon icon="bx bx-sidebar" className="bx-flip-horizontal" />
                <span class="status-bar-sidebar-link-text">{text}</span>
            </>}
            onClick={() => {
                void appContext.triggerEvent("selectRightPaneTab", { tabId, peek: true });
                onOpened?.();
            }}
        />
    );
}

interface BottomPanelParams {
    children: ComponentChildren;
    title: string;
    visible: boolean;
    setVisible?: (visible: boolean) => void;
    className?: string;
    /**
     * What the panel offers besides being read and closed, shown in its title bar ahead of the `?`
     * and the `×` — the same place, and the same name, as a sidebar card's own (see RightPanelWidget).
     */
    buttons?: ComponentChildren;
    helpPage?: string;
    /** Inline help shown by the title bar's `?`; without it the `?` opens {@link helpPage} directly. */
    helpContent?: ComponentChildren;
}

export function BottomPanel({ children, title, visible, setVisible, className, buttons, helpPage, helpContent }: BottomPanelParams) {
    return <div className={clsx("bottom-panel", className, {"hidden-ext": !visible})}>
        <div className="bottom-panel-title-bar">
            <span className="bottom-panel-title-bar-caption">{title}</span>
            {buttons}
            {helpContent
                ? <HelpDropdown helpPage={helpPage}>{helpContent}</HelpDropdown>
                : helpPage && <button class="icon-action bx bx-help-circle" onClick={() => openInAppHelpFromUrl(helpPage)} title={t("open-help-page")} />}
            <button class="icon-action bx bx-x" onClick={() => setVisible?.(false)} />
        </div>
        <div class={clsx("bottom-panel-content")}>
            {children}
        </div>
    </div>;
}
