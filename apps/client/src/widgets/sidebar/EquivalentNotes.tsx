import "./EquivalentNotes.css";

import { equivLabelName, type EquivalentNoteMember, type EquivalentNotesGroup, type EquivalentNotesResponse } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import FNote from "../../entities/fnote";
import { t } from "../../services/i18n";
import server from "../../services/server";
import FormTextBox from "../react/FormTextBox";
import { useActiveNoteContext, useNote, useNoteLabelByName, useTriliumEvent } from "../react/hooks";
import NoteLink from "../react/NoteLink";
import RightPanelWidget from "./RightPanelWidget";

export default function EquivalentNotes() {
    const { note } = useActiveNoteContext();
    const groups = useEquivalentNotes(note);
    const noteId = note?.noteId;

    if (!groups.length || !noteId) {
        return null;
    }

    return (
        <RightPanelWidget
            id="equivalentNotes"
            title={t("equivalent_notes.title")}
        >
            <div className="equivalent-notes-widget">
                {groups.map((group) => (
                    <div key={group.relationName} className="equivalent-notes-group">
                        <div className="equivalent-notes-type">{group.relationName}</div>
                        <ul className="equivalent-notes-list">
                            {group.members.map((member) => (
                                <MemberRow
                                    key={member.noteId}
                                    member={member}
                                    relationName={group.relationName}
                                    isCurrent={member.noteId === noteId}
                                />
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </RightPanelWidget>
    );
}

function MemberRow({ member, relationName, isCurrent }: {
    member: EquivalentNoteMember;
    relationName: string;
    isCurrent: boolean;
}) {
    return (
        <li className={isCurrent ? "equivalent-notes-current" : undefined} aria-current={isCurrent ? "page" : undefined}>
            <MemberDisplayName
                noteId={member.noteId}
                relationName={relationName}
                savedDisplayName={member.displayName}
                placeholder={member.title}
            />
            <NoteLink
                notePath={member.noteId}
                title={member.title}
                showNoteIcon
                noPreview
            />
        </li>
    );
}

export function MemberDisplayName({ noteId, relationName, savedDisplayName, placeholder }: {
    noteId: string;
    relationName: string;
    savedDisplayName?: string;
    placeholder?: string;
}) {
    const note = useNote(noteId);
    const labelName = equivLabelName(relationName);
    const [ savedFromNote, setSaved ] = useNoteLabelByName(note, labelName);
    const saved = note ? (savedFromNote ?? "") : (savedDisplayName ?? "");
    const [ draft, setDraft ] = useState(saved);

    useEffect(() => {
        setDraft(saved);
    }, [ saved, noteId, labelName ]);

    return (
        <FormTextBox
            className="equivalent-notes-display-name"
            currentValue={draft}
            placeholder={placeholder ?? t("equivalent_notes.display_name_placeholder")}
            aria-label={t("equivalent_notes.display_name")}
            onChange={(value) => setDraft(value)}
            onBlur={(value) => {
                const trimmed = value.trim();
                setDraft(trimmed);
                if (trimmed === saved) {
                    return;
                }
                setSaved(trimmed === "" ? null : trimmed);
            }}
        />
    );
}

export function useEquivalentNotes(note: FNote | null | undefined) {
    const [ groups, setGroups ] = useState<EquivalentNotesResponse["groups"]>([]);
    const noteId = note?.noteId;

    useEffect(() => {
        if (!noteId) {
            setGroups([]);
            return;
        }

        let cancelled = false;
        void server.get<EquivalentNotesResponse>(`notes/${noteId}/equivalent-notes`).then((res) => {
            if (!cancelled) {
                setGroups(res?.groups ?? []);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [ noteId ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (!noteId) {
            return;
        }
        const rows = loadResults.getAttributeRows();
        for (const attr of rows) {
            if (attr.noteId === noteId || attr.value === noteId) {
                void server.get<EquivalentNotesResponse>(`notes/${noteId}/equivalent-notes`).then((res) => {
                    setGroups(res?.groups ?? []);
                });
                return;
            }
        }
    });

    return groups;
}

export function filterEquivalenceGroups(groups: EquivalentNotesGroup[], query: string): EquivalentNotesGroup[] {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return groups;
    }
    return groups.filter((group) => {
        if (group.relationName.toLowerCase().includes(needle)) {
            return true;
        }
        for (const member of group.members) {
            if (memberMatchesQuery(member, needle)) {
                return true;
            }
        }
        return false;
    });
}

export function filterEquivalenceMembers(members: EquivalentNoteMember[], query: string): EquivalentNoteMember[] {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return members;
    }
    return members.filter((member) => memberMatchesQuery(member, needle));
}

/** Compact status-bar label: this note's name in the class, or the type name when that is empty. */
export function switcherButtonText(group: EquivalentNotesGroup | undefined, currentNoteId: string): string {
    if (!group) {
        return "";
    }
    const current = group.members.find((member) => member.noteId === currentNoteId);
    const name = current?.displayName?.trim();
    return name || group.relationName;
}

function memberMatchesQuery(member: EquivalentNoteMember, needle: string): boolean {
    if (member.title.toLowerCase().includes(needle)) {
        return true;
    }
    return (member.displayName?.toLowerCase().includes(needle) ?? false);
}

