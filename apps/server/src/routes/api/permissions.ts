import { getAvatarHues, type NoteAccessGrant, type NoteAccessResponse, type NoteAccessUser } from "@triliumnext/commons";
import { getSql, permission_service, user_homes, type UserRecord, user_service } from "@triliumnext/core";
import type { Request } from "express";

function callerIsAdmin(req: Request): boolean {
    const userId = req.session?.userId;
    if (!userId) return false;
    const caller = user_service.getUserById(userId);
    return !!caller?.isAdmin;
}

function listPermissions(req: Request<{ noteId: string }>) {
    if (!callerIsAdmin(req)) return [403, { message: "Admin access required." }];
    const { noteId } = req.params;
    return permission_service.getPermissionsForNote(noteId);
}

function createPermission(req: Request) {
    if (!callerIsAdmin(req)) return [403, { message: "Admin access required." }];

    const { noteId, userId, groupId, canWrite } = req.body as {
        noteId?: unknown;
        userId?: unknown;
        groupId?: unknown;
        canWrite?: unknown;
    };

    if (typeof noteId !== "string" || noteId.trim() === "") {
        return [400, { message: "noteId is required." }];
    }
    if (!userId && !groupId) {
        return [400, { message: "userId or groupId is required." }];
    }
    if (userId !== undefined && userId !== null && (typeof userId !== "string" || userId.trim() === "")) {
        return [400, { message: "userId must be a non-empty string." }];
    }
    if (groupId !== undefined && groupId !== null && (typeof groupId !== "string" || groupId.trim() === "")) {
        return [400, { message: "groupId must be a non-empty string." }];
    }
    if (user_homes.isHomeOrUsersNote(noteId.trim())) {
        return [400, { message: "Access to this note cannot be changed." }];
    }

    const permissionId = permission_service.grantPermission(
        noteId.trim(),
        typeof userId === "string" ? userId.trim() : null,
        typeof groupId === "string" ? groupId.trim() : null,
        canWrite === true || canWrite === "true"
    );

    return { permissionId };
}

function deletePermission(req: Request<{ permissionId: string }>) {
    if (!callerIsAdmin(req)) return [403, { message: "Admin access required." }];

    const { permissionId } = req.params;
    permission_service.revokePermission(permissionId);
}

function getNoteAccess(req: Request<{ noteId: string }>) {
    const check = checkCanManageAccess(req);
    if (check.error) return check.error;

    const users = user_service.listUsers();
    const hues = getAvatarHues(users);
    const toAccessUser = (user: UserRecord): NoteAccessUser => ({
        userId: user.userId, username: user.username, avatarHue: hues.get(user.userId) ?? 0
    });
    const usersById = new Map(users.map((user) => [ user.userId, user ]));

    const grants: NoteAccessGrant[] = [];
    for (const row of permission_service.getPermissionsForNote(check.noteId)) {
        const user = row.userId ? usersById.get(row.userId) : undefined;
        if (user) {
            grants.push({ ...toAccessUser(user), canWrite: !!row.canWrite });
        }
    }

    const owner = check.ownerId ? usersById.get(check.ownerId) : undefined;
    return {
        owner: owner ? toAccessUser(owner) : null,
        grants,
        users: users.filter((user) => !user.isAdmin && user.userId !== check.ownerId).map(toAccessUser)
    } satisfies NoteAccessResponse;
}

function setNoteAccess(req: Request<{ noteId: string; userId: string }>) {
    const check = checkCanManageAccess(req);
    if (check.error) return check.error;

    const { canWrite } = req.body as { canWrite?: unknown };
    if (typeof canWrite !== "boolean") {
        return [400, { message: "canWrite must be a boolean." }];
    }

    const target = user_service.getUserById(req.params.userId);
    if (!target) return [404, { message: "User not found." }];
    if (target.isAdmin || target.userId === check.ownerId) {
        return [400, { message: "Admins and the note's owner already have full access." }];
    }

    permission_service.setUserAccess(check.noteId, target.userId, canWrite);
}

function removeNoteAccess(req: Request<{ noteId: string; userId: string }>) {
    const check = checkCanManageAccess(req);
    if (check.error) return check.error;

    permission_service.revokeUserAccess(check.noteId, req.params.userId);
}

export default {
    listPermissions, createPermission, deletePermission,
    getNoteAccess, setNoteAccess, removeNoteAccess
};

/**
 * Access to a note is managed by its owner and by admins; `root`, system notes, homes and the Users
 * note have none to manage.
 */
function checkCanManageAccess(req: Request<{ noteId: string }>):
    | { error: [number, { message: string }]; noteId?: undefined; ownerId?: undefined }
    | { error?: undefined; noteId: string; ownerId: string | null } {
    const callerId = req.session?.userId;
    if (!callerId) return { error: [403, { message: "Sign-in required." }] };

    const { noteId } = req.params;
    if (noteId === "root" || noteId.startsWith("_") || user_homes.isHomeOrUsersNote(noteId)) {
        return { error: [400, { message: "Access to this note cannot be changed." }] };
    }

    const note = getSql().getRowOrNull<{ ownerId: string | null }>(
        "SELECT ownerId FROM notes WHERE noteId = ? AND isDeleted = 0", [noteId]
    );
    if (!note) return { error: [404, { message: "Note not found." }] };

    if (note.ownerId !== callerId && !user_service.getUserById(callerId)?.isAdmin) {
        return { error: [403, { message: "Only the note's owner or an admin can manage access to it." }] };
    }

    return { noteId, ownerId: note.ownerId };
}
