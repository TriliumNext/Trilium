import { permission_service, user_service } from "@triliumnext/core";
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
    if (userId !== undefined && (typeof userId !== "string" || userId.trim() === "")) {
        return [400, { message: "userId must be a non-empty string." }];
    }
    if (groupId !== undefined && (typeof groupId !== "string" || groupId.trim() === "")) {
        return [400, { message: "groupId must be a non-empty string." }];
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

export default { listPermissions, createPermission, deletePermission };
