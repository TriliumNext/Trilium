import "./users.css";

import type { CreateUserResponse, UserInput, UserListItem } from "@triliumnext/commons";
import { createPortal } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { formatDateTime } from "../../../utils/formatters";
import ActionButton from "../../react/ActionButton";
import { Badge } from "../../react/Badge";
import Button from "../../react/Button";
import { Card, CardSection, OptionCardSection } from "../../react/Card";
import FormGroup from "../../react/FormGroup";
import FormRadioGroup from "../../react/FormRadioGroup";
import FormTextBox from "../../react/FormTextBox";
import Modal from "../../react/Modal";
import NoItems from "../../react/NoItems";
import OptionsPageHeader from "./components/OptionsPageHeader";

/** Which user the dialog is open for: a new one, or an existing one being edited. */
type DialogTarget = { mode: "create" } | { mode: "edit"; user: UserListItem };

export default function UserSettings() {
    const [ users, setUsers ] = useState<UserListItem[]>([]);
    const [ dialogTarget, setDialogTarget ] = useState<DialogTarget | null>(null);

    // Users are not entities, so no entitiesReloaded announces a change: the page refetches after
    // each one it makes itself.
    const refreshUsers = useCallback(() => {
        server.get<UserListItem[]>("users").then(setUsers);
    }, []);

    useEffect(refreshUsers, []);

    const deleteUser = useCallback(async (user: UserListItem) => {
        if (!(await dialog.confirm(t("users.delete_confirmation", { username: user.username })))) {
            return;
        }

        await server.remove(`users/${user.userId}`);
        toast.showMessage(t("users.deleted", { username: user.username }));
        refreshUsers();
    }, [ refreshUsers ]);

    const openCreateDialog = useCallback(() => setDialogTarget({ mode: "create" }), []);

    return (
        <>
            <OptionsPageHeader
                below={
                    <div className="users-header-row">
                        <p className="users-description">{t("users.description")}</p>

                        <Button
                            name="create-user-button"
                            size="micro" icon="bx-user-plus"
                            text={t("users.add_user")}
                            onClick={openCreateDialog}
                        />
                    </div>
                }
            />

            <UserList
                users={users}
                onEdit={(user) => setDialogTarget({ mode: "edit", user })}
                onDelete={deleteUser}
            />

            {/* The page's one command lives in its header, out of the search's reach. */}
            <Card filterOnly heading={t("settings.related_actions")}>
                <OptionCardSection label={t("users.add_user")} description={t("users.description")}>
                    <Button text={t("users.add_user")} onClick={openCreateDialog} />
                </OptionCardSection>
            </Card>

            {/* On the body, out of the note pane, which would otherwise clip and displace it. */}
            {createPortal(
                <UserDialog
                    target={dialogTarget}
                    users={users}
                    onSaved={refreshUsers}
                    onHidden={() => setDialogTarget(null)}
                />,
                document.body
            )}
        </>
    );
}

interface UserListProps {
    users: UserListItem[];
    onEdit(user: UserListItem): void;
    onDelete(user: UserListItem): void;
}

function UserList({ users, onEdit, onDelete }: UserListProps) {
    if (!users.length) {
        return <NoItems icon="bx bx-group" text={t("users.no_users")} />;
    }

    const adminCount = users.filter((user) => user.isAdmin).length;

    return (
        <Card
            className="users-list"
            heading={t("users.count", { count: users.length })}
            description={t("users.admin_count", { count: adminCount })}
            filterExtraKeywords={`${t("users.description")} ${users.map((user) => user.username).join(" ")}`}
        >
            {users.map((user) => (
                <UserRow
                    key={user.userId}
                    user={user}
                    isLastAdmin={user.isAdmin && adminCount <= 1}
                    onEdit={onEdit}
                    onDelete={onDelete}
                />
            ))}
        </Card>
    );
}

interface UserRowProps {
    user: UserListItem;
    isLastAdmin: boolean;
    onEdit(user: UserListItem): void;
    onDelete(user: UserListItem): void;
}

function UserRow({ user, isLastAdmin, onEdit, onDelete }: UserRowProps) {
    const deleteBlockedReason = getDeleteBlockedReason(user, isLastAdmin);

    return (
        <CardSection className="user-row">
            <UserAvatar username={user.username} />

            <div className="user-row-details">
                <div className="user-row-name">
                    <span className="user-row-username">{user.username}</span>
                    {user.isCurrentUser && <Badge className="user-badge-you" text={t("users.badge_you")} outline />}
                    {user.isAdmin && (
                        <Badge
                            className="user-badge-admin"
                            icon="bx bx-shield-quarter"
                            text={user.isPrimaryAdmin ? t("users.badge_primary_admin") : t("users.badge_admin")}
                            tooltip={user.isPrimaryAdmin ? t("users.primary_admin_tooltip") : undefined}
                        />
                    )}
                </div>

                <small className="user-row-meta">
                    <span className={user.email ? "user-row-email" : "user-row-email user-row-email-none"}>
                        {user.email ?? t("users.no_email")}
                    </span>
                    <span className="user-row-created">
                        {t("users.created", { date: formatDateTime(user.dateCreated, "medium", "none") })}
                    </span>
                </small>
            </div>

            <span className="tn-card-option-actions">
                <ActionButton
                    icon="bx bx-edit-alt"
                    text={t("users.edit_user")}
                    onClick={() => onEdit(user)}
                />

                <ActionButton
                    className="destructive-action-icon"
                    icon="bx bx-trash"
                    text={deleteBlockedReason ?? t("users.delete_user")}
                    disabled={!!deleteBlockedReason}
                    onClick={() => onDelete(user)}
                />
            </span>
        </CardSection>
    );
}

/** A circle with the user's initials, tinted by a hue derived from the name so it stays stable. */
function UserAvatar({ username }: { username: string }) {
    return (
        <span
            className="user-avatar"
            aria-hidden="true"
            style={{ "--user-avatar-hue": getUsernameHue(username) }}
        >
            {getInitials(username)}
        </span>
    );
}

interface UserDialogProps {
    target: DialogTarget | null;
    users: UserListItem[];
    onSaved(): void;
    onHidden(): void;
}

function UserDialog({ target, users, onSaved, onHidden }: UserDialogProps) {
    const editedUser = target?.mode === "edit" ? target.user : undefined;
    const [ username, setUsername ] = useState("");
    const [ email, setEmail ] = useState("");
    const [ isAdmin, setIsAdmin ] = useState(false);
    const [ touched, setTouched ] = useState(false);
    const [ saving, setSaving ] = useState(false);

    // Reset the form whenever the dialog opens for a (possibly different) user.
    useEffect(() => {
        if (!target) return;
        setUsername(editedUser?.username ?? "");
        setEmail(editedUser?.email ?? "");
        setIsAdmin(editedUser?.isAdmin ?? false);
        setTouched(false);
        setSaving(false);
    }, [ target ]);

    const usernameError = validateUsername(username, users, editedUser?.userId);
    // The role of the primary admin, and the caller's own, cannot be changed (the server refuses).
    const roleLocked = !!editedUser && (editedUser.isPrimaryAdmin || editedUser.isCurrentUser);

    async function handleSubmit() {
        setTouched(true);
        if (usernameError || saving) return;

        const input: UserInput = {
            username: username.trim(),
            email: email.trim() || null,
            isAdmin
        };

        setSaving(true);
        try {
            if (editedUser) {
                await server.patch(`users/${editedUser.userId}`, roleLocked ? { ...input, isAdmin: undefined } : input);
                toast.showMessage(t("users.updated", { username: input.username }));
            } else {
                await server.post<CreateUserResponse>("users", input);
                toast.showMessage(t("users.created_toast", { username: input.username }));
            }
        } catch {
            // The server's message has already been shown; keep the dialog open to correct it.
            setSaving(false);
            return;
        }

        onSaved();
        onHidden();
    }

    return (
        <Modal
            className="user-dialog"
            show={!!target}
            onHidden={onHidden}
            onSubmit={handleSubmit}
            title={editedUser ? t("users.edit_title", { username: editedUser.username }) : t("users.create_title")}
            size="md"
            stackable
            footer={
                <>
                    <Button text={t("common.cancel")} onClick={onHidden} />
                    <Button
                        text={editedUser ? t("common.save") : t("users.add_user")}
                        kind="primary"
                        disabled={saving}
                    />
                </>
            }
        >
            <FormGroup
                name="user-username"
                label={t("users.username")}
                error={touched && usernameError ? usernameError : undefined}
            >
                <FormTextBox
                    currentValue={username}
                    onChange={setUsername}
                    onBlur={() => setTouched(true)}
                    autoComplete="off"
                    autoFocus
                />
            </FormGroup>

            <FormGroup name="user-email" label={t("users.email")} description={t("users.email_description")}>
                <FormTextBox
                    type="email"
                    currentValue={email}
                    onChange={setEmail}
                    placeholder={t("users.email_placeholder")}
                    autoComplete="off"
                />
            </FormGroup>

            <div className="user-dialog-role">
                <div className="user-dialog-role-label">{t("users.role")}</div>
                {roleLocked ? (
                    <p className="user-dialog-role-locked">
                        {editedUser?.isPrimaryAdmin ? t("users.role_locked_primary") : t("users.role_locked_self")}
                    </p>
                ) : (
                    <FormRadioGroup
                        name="user-role"
                        currentValue={isAdmin ? "admin" : "member"}
                        onChange={(value) => setIsAdmin(value === "admin")}
                        values={[
                            { value: "member", label: t("users.role_member"), inlineDescription: t("users.role_member_description") },
                            { value: "admin", label: t("users.role_admin"), inlineDescription: t("users.role_admin_description") }
                        ]}
                    />
                )}
            </div>
        </Modal>
    );
}

export function validateUsername(username: string, users: UserListItem[], exceptUserId?: string) {
    const trimmed = username.trim();
    if (!trimmed) {
        return t("users.error_username_required");
    }
    if (users.some((user) => user.username === trimmed && user.userId !== exceptUserId)) {
        return t("users.error_username_taken");
    }
    return undefined;
}

export function getInitials(username: string) {
    const words = username.trim().split(/[\s._-]+/).filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
    return letters.toUpperCase();
}

export function getUsernameHue(username: string) {
    // FNV-1a, then stepped round the wheel by the golden angle so similar names land far apart.
    let hash = 0x811c9dc5;
    for (const char of username) {
        hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
    }
    return Math.round((hash * 137.508) % 360);
}

/** Why a user cannot be deleted, mirroring the server's checks; `undefined` when they can. */
function getDeleteBlockedReason(user: UserListItem, isLastAdmin: boolean) {
    if (user.isCurrentUser) return t("users.delete_blocked_self");
    if (user.isPrimaryAdmin) return t("users.delete_blocked_primary");
    if (isLastAdmin) return t("users.delete_blocked_last_admin");
    return undefined;
}
