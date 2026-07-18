import type { OAuthStatus } from "@triliumnext/commons";

import { t } from "./i18n";

/** Human label for the connected account: its email, then display name, then a generic fallback. */
export function oauthAccountLabel(status?: OAuthStatus) {
    return status?.email || status?.name || t("multi_factor_authentication.oauth_account_unknown");
}

/**
 * Provider display name: the configured issuer name, falling back to the host of the issuer URL
 * (e.g. "auth.example.com"), and finally to a generic label when neither is available.
 */
export function oauthProviderDisplayName(status?: OAuthStatus) {
    if (status?.issuerName) {
        return status.issuerName;
    }

    if (status?.issuerUrl) {
        try {
            return new URL(status.issuerUrl).host;
        } catch {
            return status.issuerUrl;
        }
    }

    return t("multi_factor_authentication.oauth_provider_unknown");
}
