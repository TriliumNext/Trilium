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
    }
}
