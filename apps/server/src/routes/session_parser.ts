import sql from "../services/sql.js";
import session, { Store } from "express-session";
import sessionSecret from "../services/session_secret.js";
import config from "../services/config.js";
import log from "../services/log.js";
import type express from "express";

/**
 * The amount of time in milliseconds after which expired sessions are cleaned up.
 */
export const CLEAN_UP_INTERVAL = 60 * 60 * 1000; // 1 hour

/**
 * The amount of time in milliseconds after which a session cookie expires if "Remember me" is not checked.
 *
 * Note that the session is renewed on each request, so the session will last up to this time from the last request.
 */
export const SESSION_COOKIE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

export class SQLiteSessionStore extends Store {

    get(sid: string, callback: (err: any, session?: session.SessionData | null) => void): void {
        try {
            const data = sql.getValue<string>(/*sql*/`SELECT data FROM sessions WHERE id = ?`, sid);
            let session = null;
            if (data) {
                session = JSON.parse(data);
            }
            return callback(null, session);
        } catch (e: unknown) {
            log.error(e);
            return callback(e);
        }
    }

    set(id: string, session: session.SessionData, callback?: (err?: any) => void): void {
        try {
            const expires = session.cookie?.expires
                ? new Date(session.cookie.expires).getTime()
                : Date.now() + SESSION_COOKIE_EXPIRY;
            const data = JSON.stringify(session);

            sql.upsert("sessions", "id", {
                id,
                expires,
                data
            });
            callback?.();
        } catch (e) {
            log.error(e);
            return callback?.(e);
        }
    }

    destroy(sid: string, callback?: (err?: any) => void): void {
        try {
            sql.execute(/*sql*/`DELETE FROM sessions WHERE id = ?`, sid);
            callback?.();
        } catch (e) {
            log.error(e);
            callback?.(e);
        }
    }

    touch(sid: string, session: session.SessionData, callback?: (err?: any) => void): void {
        // For now it's only for session cookies ("Remember me" unchecked).
        if (session.cookie?.expires) {
            callback?.();
            return;
        }

        try {
            const expires = Date.now() + SESSION_COOKIE_EXPIRY;
            sql.execute(/*sql*/`UPDATE sessions SET expires = ? WHERE id = ?`, [expires, sid]);
            callback?.();
        } catch (e) {
            log.error(e);
            callback?.(e);
        }
    }

    /**
     * Given a session ID, returns the expiry date of the session.
     *
     * @param sid the session ID to check.
     * @returns the expiry date of the session or null if the session does not exist.
     */
    getSessionExpiry(sid: string): Date | null {
        try {
            const expires = sql.getValue<number>(/*sql*/`SELECT expires FROM sessions WHERE id = ?`, sid);
            return expires !== undefined ? new Date(expires) : null;
        } catch (e) {
            log.error(e);
            return null;
        }
    }

}

export const sessionStore = new SQLiteSessionStore();

const sessionParser: express.RequestHandler = session({
    secret: sessionSecret,
    resave: false, // true forces the session to be saved back to the session store, even if the session was never modified during the request.
    saveUninitialized: false, // true forces a session that is "uninitialized" to be saved to the store. A session is uninitialized when it is new but not modified.
    rolling: true, // forces the session to be saved back to the session store, resetting the expiration date.
    cookie: {
        path: "/",
        httpOnly: true,
        secure: config.Network.https,
        sameSite: "lax",
        maxAge: config.Session.cookieMaxAge * 1000 // needs value in milliseconds
    },
    name: "trilium.sid",
    store: sessionStore
});

setInterval(() => {
    // Clean up expired sesions.
    const now = Date.now();
    const result = sql.execute(/*sql*/`DELETE FROM sessions WHERE expires < ?`, now);
    console.log("Cleaning up expired sessions: ", result.changes);
}, CLEAN_UP_INTERVAL);

export default sessionParser;
