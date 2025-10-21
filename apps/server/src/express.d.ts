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
}

export declare module "express-session" {
    interface SessionData {
        loggedIn: boolean;
        userId?: string;
        username?: string;
        isAdmin?: boolean;
        lastAuthState: {
            totpEnabled: boolean;
            ssoEnabled: boolean;
        };
    }
}
