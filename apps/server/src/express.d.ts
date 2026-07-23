import type { SessionData } from "express-session";

export declare module "express-serve-static-core" {
    interface Request {
        headers: {
            "x-local-date"?: string;
            "x-labels"?: string;

            authorization?: string;
            "trilium-cred"?: string;
            "x-csrf-token"?: string;

            "trilium-component-id"?: string;
            "trilium-local-now-datetime"?: string;
            "trilium-hoisted-note-id"?: string;

            "user-agent"?: string;
        };
    }

    interface Response {
        /** Set to true to prevent apiResultHandler from double-handling the response (e.g., for SSE streams) */
        triliumResponseHandled?: boolean;
    }
}

export declare module "express-session" {
    interface SessionData {
        loggedIn: boolean;
        lastAuthState: {
            totpEnabled: boolean;
            ssoEnabled: boolean;
        };
        /** Set during /bootstrap to mark the session as modified so express-session persists it and sends the cookie. */
        csrfInitialized?: true;
        /**
         * One-shot SSO rejection reason set by the OIDC afterCallback when a login is refused (wrong account,
         * or an attempt before enrollment). Read and cleared by the login page so the message shows once.
         */
        ssoError?: "wrong_account" | "not_enrolled";
        /**
         * One-shot flag set by the OIDC afterCallback when the owner binds their account for the first
         * time. Read and cleared by /bootstrap so the client can show a single "account connected" toast
         * after the post-enrollment redirect lands on the app root.
         */
        ssoJustEnrolled?: true;
        /**
         * One-shot technical detail set when the OIDC provider round-trip fails outright (the provider
         * is unreachable, its TLS certificate isn't trusted, the token exchange errors, …) rather than
         * completing with a rejection. Read and cleared by /bootstrap so the client can show a single
         * "connection failed" toast after we redirect back to the app root instead of leaving the user
         * on a raw JSON error page. Always non-empty when set, since its presence is what marks the
         * failure; bounded in length because it is held in the session store.
         */
        ssoConnectionFailed?: string;
        /**
         * Transient state for the OneNote importer's delegated-Graph OAuth device flow. During
         * sign-in it holds the pending device code (the secret the tokens are polled out with — never
         * sent to the browser); once the sign-in completes it holds the access/refresh tokens and the
         * connected account. Session-scoped only — never synced.
         */
        oneNoteImport?: {
            deviceCode?: string;
            /** Epoch millis at which the pending device code expires. */
            deviceCodeExpiresAt?: number;
            accessToken?: string;
            refreshToken?: string;
            expiresAt?: number;
            account?: { name: string; email: string };
        };
    }
}
