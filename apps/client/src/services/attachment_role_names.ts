import { attachmentRoleTraits, type NamedAttachmentRole } from "@triliumnext/commons";

import { t } from "./i18n.js";

/**
 * What each role worth naming is called where a reader sees it.
 *
 * A `Record` over {@link NamedAttachmentRole} rather than a lookup with a default, so a role added to
 * `ATTACHMENT_ROLES` with a mark of its own does not compile until it has been given a name — the same
 * arrangement the user/system split uses. Which roles those are is not decided here: it is read off the
 * icon column, so a role the app created can never end up with a mark nobody can read, and one the
 * reader placed can never end up with a word restating its own picture.
 *
 * Naming is not derivable from the traits that live with the roles themselves, and it is a question only
 * the client has to answer, which is why the names live here and not beside the roles.
 *
 * Each entry calls `t` on a literal rather than holding the key for a caller to resolve: the tooling
 * that finds translatable strings reads call sites, and a key handed through a variable is invisible
 * to it. Thunks rather than strings so the name is read at render, and a language changed under the
 * app is not left showing the one loaded at startup.
 */
const ATTACHMENT_ROLE_NAMES: Record<NamedAttachmentRole, () => string> = {
    favicon: () => t("attachment_roles.favicon"),
    coverImage: () => t("attachment_roles.coverImage"),
    viewConfig: () => t("attachment_roles.viewConfig"),
    canvasLibraryItem: () => t("attachment_roles.canvasLibraryItem"),
    importSource: () => t("attachment_roles.importSource"),
    scriptModule: () => t("attachment_roles.scriptModule")
};

/**
 * What to call an attachment of this role beside an attachment that is already showing its icon — or
 * nothing, where the role has nothing left to tell.
 *
 * Three answers, and each is the interesting one for its case. A role the app created is named: "Site
 * icon" is the whole reason that row is not a picture the reader forgot placing. A role the app knows a
 * reader placed themselves says nothing, because the icon beside the title has already said it and
 * doing so twice on every card is what makes a listing look like a form. A role nobody here has heard
 * of — a script's own, or one from a newer version reached over sync — is shown as it was stored: not a
 * name anyone chose, but the only identification the attachment has, and no icon can stand in for it.
 */
export function attachmentRoleLabel(role: string | undefined | null): string | null {
    if (!role) {
        return null;
    }

    // `hasOwn` rather than a plain lookup: the role is whatever was stored, so `"constructor"`
    // reaches this, and reading it off the object would answer with something from its prototype.
    if (Object.hasOwn(ATTACHMENT_ROLE_NAMES, role)) {
        return ATTACHMENT_ROLE_NAMES[role as NamedAttachmentRole]();
    }

    return attachmentRoleTraits(role) ? null : role;
}
