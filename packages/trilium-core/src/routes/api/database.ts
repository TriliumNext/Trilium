import type { Request } from "express";

import { ValidationError } from "../../errors.js";
import sqlInit from "../../services/sql_init.js";

/**
 * Verbose confirmation token required to wipe the database. Mirrors the password-reset endpoint's
 * approach: it guards against an accidental/mistaken call, it is not a security measure (the route
 * still relies on the usual auth middleware for that).
 */
export const WIPE_DATABASE_CONFIRMATION = "yesIReallyWantToDeleteEverythingAndCannotUndoThis";

async function wipeDatabase(req: Request) {
    if (req.query.really !== WIPE_DATABASE_CONFIRMATION) {
        throw new ValidationError("Incorrect database wipe confirmation");
    }

    await sqlInit.wipeDatabase();

    return { success: true };
}

export default {
    wipeDatabase
};
