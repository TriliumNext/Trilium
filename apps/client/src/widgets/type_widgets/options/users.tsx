import "./users.css";

import type { CreateUserResponse, SetupLinkResponse, UserInput, UserListItem } from "@triliumnext/commons";
import { createPortal } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { copyText } from "../../../services/clipboard_ext";
import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { formatDateTime } from "../../../utils/formatters";
import ActionButton from "../../react/ActionButton";
import { Badge } from "../../react/Badge";
import Button from "../../react/Button";
import { Card, CardSection, OptionCardSection } from "../../react/Card";
import FormTextBox from "../../react/FormTextBox";
import Modal from "../../react/Modal";
import NoItems from "../../react/NoItems";
import OptionsPageHeader from "./components/OptionsPageHeader";
import OptionsRow, { OptionsRowWithToggle } from "./components/OptionsRow";

/** Which user the dialog is open for: a new one, or an existing one being edited. */
type DialogTarget = { mode: "create" } | { mode: "edit"; user: UserListItem };

/** A setup link just created, shown once for the admin to pass on. */
interface ShownSetupLink {
    username: string;
    link: SetupLinkResponse;
}

export default function UserSettings() {
    const [ users, setUsers ] = useState<UserListItem[]>([]);
    const [ dialogTarget, setDialogTarget ] = useState<DialogTarget | null>(null);
    const [ shownSetupLink, setShownSetupLink ] = useState<ShownSetupLink | null>(null);
    // A new user's link waits for the user dialog to finish closing: two Bootstrap modals changing
    // over at once leave the backdrop behind.
    const pendingSetupLink = useRef<ShownSetupLink | null>(null);

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

    const createSetupLink = useCallback(async (user: UserListItem) => {
        const confirmation = user.hasPassword ? "users.create_reset_link_confirmation" : "users.create_setup_link_confirmation";
        if (!(await dialog.confirm(t(confirmation, { username: user.username })))) {
            return;
        }

        const link = await server.post<SetupLinkResponse>(`users/${user.userId}/setup-link`);
        setShownSetupLink({ username: user.username, link });
        refreshUsers();
    }, [ refreshUsers ]);

    const onUserSaved = useCallback((created?: ShownSetupLink) => {
        pendingSetupLink.current = created ?? null;
        refreshUsers();
    }, [ refreshUsers ]);

    const onUserDialogHidden = useCallback(() => {
        setDialogTarget(null);
        if (pendingSetupLink.current) {
            setShownSetupLink(pendingSetupLink.current);
            pendingSetupLink.current = null;
        }
    }, []);

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
                onCreateSetupLink={createSetupLink}
                onDelete={deleteUser}
            />

            {/* The page's one command lives in its header, out of the search's reach. */}
            <Card filterOnly heading={t("settings.related_actions")}>
                <OptionCardSection label={t("users.add_user")} description={t("users.description")}>
                    <Button text={t("users.add_user")} onClick={openCreateDialog} />
                </OptionCardSection>
            </Card>

            {/* On the body, out of the note pane, which would otherwise clip and displace them. */}
            {createPortal(
                <>
                    <UserDialog
                        target={dialogTarget}
                        users={users}
                        onSaved={onUserSaved}
                        onClose={() => setDialogTarget(null)}
                        onHidden={onUserDialogHidden}
                    />
                    <SetupLinkDialog shown={shownSetupLink} onHidden={() => setShownSetupLink(null)} />
                </>,
                document.body
            )}
        </>
    );
}

interface UserListProps {
    users: UserListItem[];
    onEdit(user: UserListItem): void;
    onCreateSetupLink(user: UserListItem): void;
    onDelete(user: UserListItem): void;
}

function UserList({ users, onEdit, onCreateSetupLink, onDelete }: UserListProps) {
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
                    onCreateSetupLink={onCreateSetupLink}
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
    onCreateSetupLink(user: UserListItem): void;
    onDelete(user: UserListItem): void;
}

function UserRow({ user, isLastAdmin, onEdit, onCreateSetupLink, onDelete }: UserRowProps) {
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
                    {!user.isPrimaryAdmin && <SetupStatusBadge user={user} />}
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
                    icon="bx bx-link"
                    text={user.isPrimaryAdmin ? t("users.setup_link_blocked_primary") : t("users.create_setup_link")}
                    disabled={user.isPrimaryAdmin}
                    onClick={() => onCreateSetupLink(user)}
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

/** Where the user stands with their password: nothing is shown once they have one and no link is out. */
function SetupStatusBadge({ user }: { user: UserListItem }) {
    const expiry = user.setupLinkExpiresAt && formatDateTime(user.setupLinkExpiresAt, "medium", "short");

    if (user.hasPassword) {
        return expiry
            ? <Badge className="user-badge-pending" icon="bx bx-time-five" text={t("users.badge_reset_pending")} tooltip={t("users.setup_pending_tooltip", { date: expiry })} />
            : null;
    }

    return expiry
        ? <Badge className="user-badge-pending" icon="bx bx-time-five" text={t("users.badge_setup_pending")} tooltip={t("users.setup_pending_tooltip", { date: expiry })} />
        : <Badge className="user-badge-expired" icon="bx bx-error" text={t("users.badge_setup_expired")} tooltip={t("users.setup_expired_tooltip")} outline />;
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
    /** Handed the setup link when a user was just created. */
    onSaved(created?: ShownSetupLink): void;
    /** Asks for the dialog to close. */
    onClose(): void;
    /** Called once the dialog has finished closing, however it was closed. */
    onHidden(): void;
}

function UserDialog({ target, users, onSaved, onClose, onHidden }: UserDialogProps) {
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
                onSaved();
            } else {
                const { setupLink } = await server.post<CreateUserResponse>("users", input);
                toast.showMessage(t("users.created_toast", { username: input.username }));
                onSaved({ username: input.username, link: setupLink });
            }
        } catch {
            // The server's message has already been shown; keep the dialog open to correct it.
            setSaving(false);
            return;
        }

        onClose();
    }

    return (
        <Modal
            className="user-dialog"
            show={!!target}
            onHidden={onHidden}
            onSubmit={handleSubmit}
            title={editedUser ? t("users.edit_title", { username: editedUser.username }) : t("users.create_title")}
            size="lg"
            stackable
            footer={
                <>
                    <Button text={t("common.cancel")} onClick={onClose} />
                    <Button
                        text={editedUser ? t("common.save") : t("users.add_user")}
                        kind="primary"
                        disabled={saving}
                    />
                </>
            }
        >
            <Card heading={t("users.account")}>
                <CardSection>
                    <OptionsRow
                        name="user-username" label={t("users.username")}
                        description={touched && usernameError ? <span className="text-danger">{usernameError}</span> : undefined}
                    >
                        <FormTextBox
                            className={touched && usernameError ? "is-invalid" : undefined}
                            currentValue={username}
                            onChange={setUsername}
                            onBlur={() => setTouched(true)}
                            autoComplete="off"
                            autoFocus
                        />
                    </OptionsRow>
                </CardSection>
                <CardSection>
                    <OptionsRow name="user-email" label={t("users.email")} description={t("users.email_description")}>
                        <FormTextBox
                            type="email"
                            currentValue={email}
                            onChange={setEmail}
                            placeholder={t("users.email_placeholder")}
                            autoComplete="off"
                        />
                    </OptionsRow>
                </CardSection>
            </Card>

            <Card heading={t("users.role")}>
                <CardSection>
                    <OptionsRowWithToggle
                        name="user-admin"
                        label={t("users.role_admin")}
                        description={roleLocked
                            ? (editedUser?.isPrimaryAdmin ? t("users.role_locked_primary") : t("users.role_locked_self"))
                            : t("users.role_admin_description")}
                        currentValue={isAdmin}
                        onChange={setIsAdmin}
                        disabled={roleLocked}
                    />
                </CardSection>
            </Card>
        </Modal>
    );
}

interface SetupLinkDialogProps {
    shown: ShownSetupLink | null;
    onHidden(): void;
}

/** Shows a just-created setup link, the only time it can be seen, with a way to copy it. */
function SetupLinkDialog({ shown, onHidden }: SetupLinkDialogProps) {
    const url = shown ? buildSetupUrl(shown.link.token, window.location) : "";

    function copy() {
        if (copyText(url)) {
            toast.showMessage(t("users.setup_link_copied"));
        } else {
            toast.showError(t("clipboard.copy_failed"));
        }
    }

    return (
        <Modal
            className="setup-link-dialog"
            show={!!shown}
            onHidden={onHidden}
            title={shown ? t("users.setup_link_title", { username: shown.username }) : ""}
            size="md"
            stackable
            footer={<Button text={t("users.setup_link_done")} kind="primary" onClick={onHidden} />}
        >
            {shown && (
                <>
                    <p className="setup-link-description">
                        {t("users.setup_link_description", {
                            username: shown.username,
                            date: formatDateTime(shown.link.expiresAt, "medium", "short")
                        })}
                    </p>

                    <div className="setup-link-row">
                        <FormTextBox
                            currentValue={url}
                            readOnly
                            aria-label={t("users.setup_link_title", { username: shown.username })}
                            onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
                        />
                        <Button icon="bx bx-copy" text={t("users.setup_link_copy")} onClick={copy} />
                    </div>
                </>
            )}
        </Modal>
    );
}

/**
 * The address a setup link opens: the instance's root, as the admin reaches it, carrying the token.
 * Built from the admin's own location so that a subpath or reverse proxy in front of the server
 * comes out right; the server cannot know the public address.
 */
export function buildSetupUrl(token: string, location: Pick<Location, "origin" | "pathname">) {
    const url = new URL(".", location.origin + location.pathname);
    url.searchParams.set("setupAccount", token);
    return url.toString();
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
