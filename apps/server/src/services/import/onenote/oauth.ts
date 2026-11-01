/**
 * OneNote importer OAuth provider config: delegated Microsoft Graph access via Microsoft Entra ID.
 *
 * This is the single place the OneNote provider's OAuth specifics live; the actual flow runs through
 * the generic client in services/oauth/oauth.ts. It is intentionally separate from the user-login OAuth
 * in open_id.ts: that one authenticates the Trilium user (OIDC), whereas this one authorizes the app to
 * call the Graph API on the user's behalf (and to refresh the resulting tokens).
 *
 * It is a PUBLIC client (no client secret), so PKCE is mandatory. The backing app registration is of
 * type "Mobile and desktop applications" in the Microsoft Entra admin center, allows personal +
 * work/school accounts, and grants delegated Graph permissions (Notes.Read, User.Read, offline_access).
 * The client id is a public identifier — the flow is protected by PKCE, not by hiding this value — so
 * it is hardcoded, the same way other open-source apps (e.g. Obsidian's OneNote importer) ship theirs.
 */

import type { OAuthProviderConfig } from "../../oauth/oauth.js";

/** `/common` lets both personal Microsoft accounts and work/school accounts sign in. */
const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";

export const ONENOTE_OAUTH: OAuthProviderConfig = {
    authorizeEndpoint: `${AUTHORITY}/authorize`,
    tokenEndpoint: `${AUTHORITY}/token`,
    deviceCodeEndpoint: `${AUTHORITY}/devicecode`,
    clientId: "47e34695-b922-4c23-8519-303fa39284c8",
    // offline_access is requested so we receive a refresh token that survives long imports.
    scopes: "offline_access User.Read Notes.Read"
};
