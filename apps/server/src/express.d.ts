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
         * Transient state for the OneNote importer's delegated-Graph OAuth flow. During sign-in it
         * holds the PKCE verifier + state + redirect URI; after a successful callback it holds the
         * access/refresh tokens and the connected account. Session-scoped only — never synced.
         */
        oneNoteImport?: {
            verifier?: string;
            state?: string;
            redirectUri?: string;
            accessToken?: string;
            refreshToken?: string;
            expiresAt?: number;
            account?: { name: string; email: string };
        };
    }
}
