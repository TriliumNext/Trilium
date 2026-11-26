/**
 * @module
 *
 * The kind of login that a session holds. The password and the OpenID login make an interactive
 * session, and the sync login makes a sync session, which reaches only the sync routes. A logged-in
 * session without a kind, from before the kinds existed, passes no route. Every reader of
 * `loggedIn` goes through this module, which a spec checks.
 */
import type { SessionData } from "express-session";

export type SessionKind = "interactive" | "sync";

type LoginState = Partial<Pick<SessionData, "loggedIn" | "sessionKind">>;

export function markLoggedIn(session: LoginState, kind: SessionKind) {
    session.loggedIn = true;
    session.sessionKind = kind;
}

export function markLoggedOut(session: LoginState) {
    session.loggedIn = false;
    delete session.sessionKind;
}

/** Whether a person logged the session in, with the password or OpenID. */
export function isInteractiveSession(session: LoginState | null | undefined): boolean {
    return session?.loggedIn === true && session.sessionKind === "interactive";
}

/** Whether a sync client logged the session in. */
export function isSyncSession(session: LoginState | null | undefined): boolean {
    return session?.loggedIn === true && session.sessionKind === "sync";
}
