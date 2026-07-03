"use strict";

import Becca from "./becca-interface.js";
import { getCachedBecca, setCachedBecca } from "./becca_cache.js";
import { getUserId, get, set as ctxSet } from "../services/context.js";
import { getSql } from "../services/sql/index.js";

const adminBecca = new Becca();

// Direct SQL instead of going through user_service -> options -> becca (circular).
function isUserAdmin(userId: string): boolean {
    try {
        return !!getSql().getValue<number>(
            "SELECT isAdmin FROM users WHERE userId = ? AND isDeleted = 0", [userId]
        );
    } catch {
        return false;
    }
}

// "loadingBecca" in CLS is set by loadBeccaForUser so entity constructors
// register into the target Becca being built, not adminBecca.
// "resolvedBecca" is set once by warmBeccaForUser to avoid re-running the admin
// SQL check on every getBecca() call within the same request.
// Outside a request, or for admins, falls back to adminBecca.
export function getBecca(): Becca {
    const loadingBecca = get<Becca>("loadingBecca");
    if (loadingBecca) {
        return loadingBecca;
    }

    const userId = getUserId();
    if (!userId) {
        return adminBecca;
    }

    const resolved = get<Becca>("resolvedBecca");
    if (resolved) {
        return resolved;
    }

    if (isUserAdmin(userId)) {
        return adminBecca;
    }

    const userBecca = getCachedBecca(userId);
    if (userBecca) {
        return userBecca;
    }

    throw new Error(`getBecca: no cached Becca for user ${userId}; warmBeccaForUser() must run before request handlers`);
}

export async function warmBeccaForUser(userId: string): Promise<Becca> {
    let becca: Becca;

    if (isUserAdmin(userId)) {
        becca = adminBecca;
    } else {
        const existing = getCachedBecca(userId);
        if (existing) {
            becca = existing;
        } else {
            const { loadBeccaForUser } = await import("./becca_loader.js");
            const userBecca = new Becca();
            await loadBeccaForUser(userBecca, userId, false);
            setCachedBecca(userId, userBecca);
            becca = userBecca;
        }
    }

    ctxSet("resolvedBecca", becca);
    return becca;
}

export { adminBecca };
export default adminBecca;
