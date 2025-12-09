import "./Breadcrumb.css";

import { useMemo } from "preact/hooks";
import { Fragment } from "preact/jsx-runtime";

import NoteContext from "../components/note_context";
import froca from "../services/froca";
import ActionButton from "./react/ActionButton";
import Dropdown from "./react/Dropdown";
import { FormListItem } from "./react/FormList";
import { useChildNotes, useNoteContext, useNoteLabel, useNoteProperty } from "./react/hooks";
import Icon from "./react/Icon";
import NoteLink from "./react/NoteLink";
import link_context_menu from "../menus/link_context_menu";

const COLLAPSE_THRESHOLD = 5;
const INITIAL_ITEMS = 2;
const FINAL_ITEMS = 2;

export default function Breadcrumb() {
    const { note, noteContext } = useNoteContext();
    const notePath = buildNotePaths(noteContext?.notePathArray);

    return (
        <div className="breadcrumb">
            {notePath.length > COLLAPSE_THRESHOLD ? (
                <>
                    {notePath.slice(0, INITIAL_ITEMS).map((item, index) => (
                        <Fragment key={item}>
                            {index === 0
                                ? <BreadcrumbRoot noteContext={noteContext} />
                                : <BreadcrumbItem notePath={item} />
                            }
                            <BreadcrumbSeparator notePath={item} activeNotePath={notePath[index + 1]} noteContext={noteContext} />
                        </Fragment>
                    ))}
                    <BreadcrumbCollapsed items={notePath.slice(INITIAL_ITEMS, -FINAL_ITEMS)} noteContext={noteContext} />
                    {notePath.slice(-FINAL_ITEMS).map((item, index) => (
                        <Fragment key={item}>
                            <BreadcrumbSeparator notePath={notePath[notePath.length - FINAL_ITEMS - (1 - index)]} activeNotePath={item} noteContext={noteContext} />
                            <BreadcrumbItem notePath={item} />
                        </Fragment>
                    ))}
                </>
            ) : (
                notePath.map((item, index) => (
                    <Fragment key={item}>
                        {index === 0
                            ? <BreadcrumbRoot noteContext={noteContext} />
                            : <BreadcrumbItem notePath={item} />
                        }
                        {(index < notePath.length - 1 || note?.hasChildren()) &&
                            <BreadcrumbSeparator notePath={item} activeNotePath={notePath[index + 1]} noteContext={noteContext} />}
                    </Fragment>
                ))
            )}
        </div>
    );
}

function BreadcrumbRoot({ noteContext }: { noteContext: NoteContext | undefined }) {
    const note = useMemo(() => froca.getNoteFromCache("root"), []);
    useNoteLabel(note, "iconClass");
    const title = useNoteProperty(note, "title");

    return (note &&
        <ActionButton
            icon={note.getIcon()}
            text={title ?? ""}
            onClick={() => noteContext?.setNote("root")}
            onContextMenu={(e) => {
                e.preventDefault();
                link_context_menu.openContextMenu(note.noteId, e);
            }}
        />
    );
}

function BreadcrumbItem({ notePath }: { notePath: string }) {
    return (
        <NoteLink
            notePath={notePath}
            noPreview
        />
    );
}

function BreadcrumbSeparator({ notePath, noteContext, activeNotePath }: { notePath: string, activeNotePath: string, noteContext: NoteContext | undefined }) {
    return (
        <Dropdown
            text={<Icon icon="bx bx-chevron-right" />}
            noSelectButtonStyle
            buttonClassName="icon-action"
            hideToggleArrow
            dropdownOptions={{ popperConfig: { strategy: "fixed" } }}
        >
            <BreadcrumbSeparatorDropdownContent notePath={notePath} noteContext={noteContext} activeNotePath={activeNotePath} />
        </Dropdown>
    );
}

function BreadcrumbSeparatorDropdownContent({ notePath, noteContext, activeNotePath }: { notePath: string, activeNotePath: string, noteContext: NoteContext | undefined }) {
    const notePathComponents = notePath.split("/");
    const parentNoteId = notePathComponents.at(-1);
    const childNotes = useChildNotes(parentNoteId);

    return (
        <ul className="breadcrumb-child-list">
            {childNotes.map((note) => {
                const childNotePath = `${notePath}/${note.noteId}`;
                return <li key={note.noteId}>
                    <FormListItem
                        icon={note.getIcon()}
                        onClick={() => noteContext?.setNote(childNotePath)}
                    >
                        {childNotePath !== activeNotePath
                            ? <span>{note.title}</span>
                            : <strong>{note.title}</strong>}
                    </FormListItem>
                </li>;
            })}
        </ul>
    );
}

function BreadcrumbCollapsed({ items, noteContext }: { items: string[], noteContext: NoteContext | undefined }) {
    return (
        <Dropdown
            text={<Icon icon="bx bx-dots-horizontal-rounded" />}
            noSelectButtonStyle
            buttonClassName="icon-action"
            hideToggleArrow
            dropdownOptions={{ popperConfig: { strategy: "fixed" } }}
        >
            <ul className="breadcrumb-child-list">
                {items.map((notePath) => {
                    const notePathComponents = notePath.split("/");
                    const noteId = notePathComponents[notePathComponents.length - 1];
                    const note = froca.getNoteFromCache(noteId);
                    if (!note) return null;

                    return <li key={note.noteId}>
                        <FormListItem
                            icon={note.getIcon()}
                            onClick={() => noteContext?.setNote(notePath)}
                        >
                            <span>{note.title}</span>
                        </FormListItem>
                    </li>;
                })}
            </ul>
        </Dropdown>
    );
}

function buildNotePaths(notePathArray: string[] | undefined) {
    if (!notePathArray) return [];

    let prefix = "";
    const output: string[] = [];
    for (const notePath of notePathArray) {
        output.push(`${prefix}${notePath}`);
        prefix += `${notePath}/`;
    }
    return output;
}
