import "./note_access.css";

import type { NoteAccessResponse, NoteAccessUser } from "@triliumnext/commons";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

import appContext from "../../components/app_context";
import { menuName } from "../../menus/context_menu_utils";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import LoadResults from "../../services/load_results";
import server from "../../services/server";
import ActionButton from "../react/ActionButton";
import { Badge } from "../react/Badge";
import Button from "../react/Button";
import { Card, CardSection } from "../react/Card";
import Dropdown from "../react/Dropdown";
import { useNoteTitle, useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import SegmentedChoice, { type SegmentedChoiceOption } from "../react/SegmentedChoice";
import UserAvatar from "../react/UserAvatar";

type AccessLevel = "read" | "write";

export default function NoteAccessDialog() {
    const [ shown, setShown ] = useState(false);
    const [ noteId, setNoteId ] = useState<string>();
    const [ access, setAccess ] = useState<NoteAccessResponse>();
    const [ newUserId, setNewUserId ] = useState<string>();
    const [ newLevel, setNewLevel ] = useState<AccessLevel>("read");
    const noteTitle = useNoteTitle(noteId, undefined);

    useTriliumEvent("showNoteAccess", async ({ node, noteId }) => {
        const targetNoteId = noteId ?? node?.data.noteId;
        if (!targetNoteId) return;

        setNoteId(targetNoteId);
        setAccess(undefined);
        setNewUserId(undefined);
        setNewLevel("read");
        setShown(true);
        await refresh(targetNoteId);
    });

    async function refresh(targetNoteId = noteId) {
        try {
            setAccess(await server.get<NoteAccessResponse>(`notes/${targetNoteId}/access`));
        } catch {
            // The server's message is already shown as a toast.
            setShown(false);
        }
    }

    async function setLevel(userId: string, level: AccessLevel) {
        await server.put(`notes/${noteId}/access/${userId}`, { canWrite: level === "write" });
        await Promise.all([ refresh(), noteId && reloadInTree(noteId) ]);
    }

    async function removeAccess(userId: string) {
        await server.remove(`notes/${noteId}/access/${userId}`);
        await Promise.all([ refresh(), noteId && reloadInTree(noteId) ]);
    }

    const levelOptions: SegmentedChoiceOption<AccessLevel>[] = [
        { value: "read", label: t("note_access.can_view") },
        { value: "write", label: t("note_access.can_edit") }
    ];
    const grantedIds = new Set(access?.grants.map((grant) => grant.userId));
    const candidates = access?.users.filter((user) => !grantedIds.has(user.userId)) ?? [];
    const selectedUserId = newUserId && candidates.some((user) => user.userId === newUserId)
        ? newUserId
        : candidates[0]?.userId;

    return (
        <Modal
            className="note-access-dialog"
            title={noteTitle ? t("note_access.title_with_note", { title: noteTitle }) : t("note_access.title")}
            size="lg"
            show={shown}
            onHidden={() => setShown(false)}
            footer={<Button text={t("note_access.close")} onClick={() => setShown(false)} />}
        >
            {access && <>
                <Card heading={t("note_access.people_heading")} description={t("note_access.people_description")}>
                    {access.owner && (
                        <AccessRow user={access.owner}>
                            <Badge className="note-access-owner-badge" text={t("note_access.owner")} outline />
                        </AccessRow>
                    )}

                    {access.grants.map((grant) => (
                        <AccessRow key={grant.userId} user={grant}>
                            <SegmentedChoice
                                options={levelOptions}
                                currentValue={grant.canWrite ? "write" : "read"}
                                onChange={(level) => setLevel(grant.userId, level)}
                            />
                            <ActionButton
                                className="note-access-remove"
                                icon="bx bx-x"
                                text={t("note_access.remove", { username: grant.username })}
                                onClick={() => removeAccess(grant.userId)}
                            />
                        </AccessRow>
                    ))}
                </Card>

                <Card heading={t("note_access.add_heading")}>
                    {selectedUserId ? (
                        <CardSection className="note-access-add">
                            <UserPicker users={candidates} currentUserId={selectedUserId} onChange={setNewUserId} />
                            <SegmentedChoice options={levelOptions} currentValue={newLevel} onChange={setNewLevel} />
                            <Button
                                icon="bx bx-plus"
                                text={t("note_access.add")}
                                onClick={() => setLevel(selectedUserId, newLevel)}
                            />
                        </CardSection>
                    ) : (
                        <CardSection className="note-access-add-none">{t("note_access.no_more_users")}</CardSection>
                    )}
                </Card>
            </>}
        </Modal>
    );
}

function UserPicker({ users, currentUserId, onChange }: {
    users: NoteAccessUser[];
    currentUserId: string;
    onChange(userId: string): void;
}) {
    const current = users.find((user) => user.userId === currentUserId);

    return (
        <Dropdown
            className="note-access-add-user"
            dropdownContainerClassName="note-access-user-menu"
            title={t("note_access.user")}
            text={current && <UserLabel user={current} />}
            mobileBottomSheet
            filterable
            items={users.map((user) => ({
                title: menuName(user.username),
                leading: <UserAvatar username={user.username} hue={user.avatarHue} />,
                checked: user.userId === currentUserId,
                handler: () => onChange(user.userId)
            }))}
        />
    );
}

function UserLabel({ user }: { user: NoteAccessUser }) {
    return (
        <span className="note-access-user-label">
            <UserAvatar username={user.username} hue={user.avatarHue} />
            <span className="note-access-user-name">{user.username}</span>
        </span>
    );
}

/** No entity change carries a grant, so the tree's access icon is refreshed by reloading the note. */
async function reloadInTree(noteId: string) {
    await froca.reloadNotes([ noteId ]);
    const loadResults = new LoadResults([]);
    loadResults.addNote(noteId);
    await appContext.triggerEvent("entitiesReloaded", { loadResults });
}

function AccessRow({ user, children }: { user: NoteAccessUser; children: ComponentChildren }) {
    return (
        <CardSection className="note-access-row">
            <UserAvatar username={user.username} hue={user.avatarHue} />
            <span className="note-access-username">{user.username}</span>
            <div className="note-access-controls">{children}</div>
        </CardSection>
    );
}
