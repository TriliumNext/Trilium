import "./share_edit.css";

import { prepareAppHost } from "../content/app_view.js";
import type { EditView, EditViewOptions } from "../content/edit_view.js";

/** What `GET api/edit/session` answers a page about its note. */
export interface EditSession {
    editable: boolean;
    needsPassword?: boolean;
    unlocked?: boolean;
    rootNoteId?: string;
    attachments?: boolean;
    /** The CSRF token of a session that holds the note unlocked. */
    csrfToken?: string;
    /** The texts of the page's controls, in the share's language. */
    strings?: Record<string, string>;
}

/** What `POST api/edit/login` answers once the note is unlocked. */
interface EditLogin {
    csrfToken: string;
    version: string;
    payload: EditViewOptions["payload"];
}

/**
 * Offers to edit a text note the host opened to its visitors: an *Edit* button in the note's header
 * unlocks it and mounts the app's editor in place of the rendered content.
 */
export default async function setupShareEdit() {
    const noteId = document.body.dataset.noteId;
    const title = document.getElementById("title");
    if (window.glob?.isStatic || !noteId || !title) {
        return;
    }

    const ended = takeEnded(noteId);
    const session = await fetchSession(noteId);
    if (!session?.editable) {
        return;
    }

    const controls = buildControls(session.strings ?? {});
    // A custom template without the header's actions gets the controls below its title.
    const actions = document.getElementById("note-header-actions");
    if (actions) {
        actions.append(controls.bar);
    } else {
        (title.closest("#title-row") ?? title).after(controls.bar);
    }
    if (ended) {
        controls.setError("ended");
    }

    const editing: Editing = { relock: null };
    controls.editButton.addEventListener("click", () => {
        if (session.needsPassword && !session.unlocked) {
            controls.showLogin();
            controls.passwordInput.focus();
        } else {
            void unlock(controls, noteId, session, editing);
        }
    });
    controls.loginForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const password = controls.passwordInput.value;
        void (editing.relock?.(password) ?? unlock(controls, noteId, session, editing, password));
    });
}

type Controls = ReturnType<typeof buildControls>;
type ErrorKey =
    "wrongPassword" | "failed" | "unsaved" | "locked" | "retry" | "ended" | "logOutFailed";

interface Editing {
    /**
     * Once the editor is open, unlocks the note again after the visitor's access ended, and
     * resolves to whether it did.
     */
    relock: ((password?: string) => Promise<boolean>) | null;
}

/**
 * Unlocks the note for this session, saying in `controls` what went wrong when it cannot: a wrong
 * password, or `failure` for a share that does not answer or refuses otherwise.
 */
async function login(
    controls: Controls, noteId: string, password?: string, failure: "failed" | "retry" = "failed"
): Promise<EditLogin | null> {
    controls.setError(null);
    let response: Response;
    try {
        response = await fetch("api/edit/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ noteId, password })
        });
    } catch {
        controls.setError(failure);
        return null;
    }
    if (response.status === 401) {
        controls.setError("wrongPassword");
        controls.passwordInput.select();
        return null;
    }
    if (!response.ok) {
        controls.setError(failure);
        return null;
    }
    return await response.json() as EditLogin;
}

async function unlock(
    controls: Controls, noteId: string, session: EditSession, editing: Editing, password?: string
) {
    const first = await login(controls, noteId, password);
    if (!first) {
        return;
    }

    let { csrfToken } = first;
    let canLogOut = !!session.needsPassword;
    controls.showEditing(canLogOut);
    // Once access ends, unlocks again where no password is needed; otherwise, or when that fails,
    // the form stays up to try again, the password optional unless the share asks for one.
    const onLocked = async () => {
        const current = await fetchSession(noteId);
        const needsPassword = !!current?.needsPassword;
        if (current?.editable && !needsPassword && await editing.relock?.()) {
            return;
        }
        controls.passwordInput.value = "";
        controls.passwordInput.required = needsPassword;
        controls.showLogin();
        controls.setError(needsPassword ? "locked" : "retry");
        controls.passwordInput.focus();
    };
    // The editor's token, which its saves renew once an unlock in another tab replaced the session.
    const logOut = (signal?: AbortSignal) =>
        dropGrant(noteId, window.glob?.csrfToken ?? csrfToken, signal);
    // Saves that keep failing end the editing, which the page says once it is back. The editor
    // keeps its leave guards until the page leaves, so a logout that stalls is cut short.
    const giveUp = async (release: () => void) => {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), LOGOUT_WAIT);
        await logOut(abort.signal);
        clearTimeout(timer);
        rememberEnded(noteId);
        release();
        window.location.reload();
    };
    const mounted = mountEditor(noteId, first, session, controls, () => void onLocked(),
        (release) => void giveUp(release));
    editing.relock = async (again?: string) => {
        const next = await login(controls, noteId, again || undefined, "retry");
        if (!next) {
            return false;
        }
        csrfToken = next.csrfToken;
        canLogOut ||= !!again;
        controls.showEditing(canLogOut);
        (await mounted).resume(csrfToken);
        return true;
    };
    // A click while the editor is still loading waits for it, so nothing pending is lost, and the
    // editor stays open while something is unsaved or the session keeps its access. An editor that
    // never mounted holds nothing.
    const leave = async (beforeReload?: () => Promise<boolean>) => {
        controls.setError(null);
        const saved = await mounted.then((view) => view.stop(), () => true);
        if (!saved) {
            controls.setError("unsaved");
            return;
        }
        if (beforeReload && !await beforeReload()) {
            controls.setError("logOutFailed");
            return;
        }
        window.location.reload();
    };
    controls.stopButton.addEventListener("click", () => void leave());
    controls.logOutButton.addEventListener("click", () => void leave(() => logOut()));
    try {
        await mounted;
    } catch (e) {
        console.error(e);
        controls.setError("failed");
    }
}

/**
 * Replaces the rendered content with the app's editor, its toolbar in the sticky top bar. The
 * rendered content comes back with the page, which *Stop editing* reloads.
 */
async function mountEditor(
    noteId: string,
    login: EditLogin,
    session: EditSession,
    controls: Controls,
    onLocked: () => void,
    onSavesFailing: EditViewOptions["onSavesFailing"]
): Promise<EditView> {
    const content = document.getElementById("content");
    const title = document.getElementById("title");
    if (!content || !title) {
        throw new Error("The page has no content to edit.");
    }

    await prepareAppHost(login.payload);
    const { default: mountEditView } = await import("../content/edit_view.js");
    const container = document.createElement("div");
    container.className = "share-edit-view";
    const rendered = [ ...content.children ].filter((child) =>
        child !== title && !child.contains(title) && child !== controls.bar);
    for (const child of rendered) {
        child.remove();
    }
    content.append(container);
    content.classList.add("share-editing");

    return await mountEditView(container, {
        noteId,
        title,
        payload: login.payload,
        csrfToken: login.csrfToken,
        version: login.version,
        attachments: !!session.attachments,
        statusContainer: buildStatusSlot(),
        toolbarContainer: buildToolbarSlot(),
        onLocked,
        onSavesFailing
    });
}

/** A slot in the sticky top bar, above the title row, where the page has one. */
function buildToolbarSlot() {
    const topBar = document.getElementById("top-bar");
    if (!topBar) {
        return undefined;
    }

    const slot = document.createElement("div");
    slot.className = "share-edit-toolbar-slot";
    topBar.insertBefore(slot, topBar.querySelector(":scope > #title-row"));
    return slot;
}

/** A slot at the start of the footer's "Last updated" line, where the page has one. */
function buildStatusSlot() {
    const updated = document.querySelector("#content-footer .updated");
    if (!updated) {
        return undefined;
    }

    const slot = document.createElement("span");
    slot.className = "share-edit-status-slot";
    updated.prepend(slot);
    return slot;
}

/** How long the page waits for the logout of a guest whose saves kept failing. */
const LOGOUT_WAIT = 5000;
/** The note whose page logged out as saves kept failing, kept for the page it reloads to. */
const ENDED_KEY = "shareEditEnded";

function rememberEnded(noteId: string) {
    try {
        sessionStorage.setItem(ENDED_KEY, noteId);
    } catch {
        // Without storage, the page comes back without saying why.
    }
}

/** Whether the page logged out of editing `noteId` as saves kept failing, which it then forgets. */
function takeEnded(noteId: string) {
    try {
        const ended = sessionStorage.getItem(ENDED_KEY);
        sessionStorage.removeItem(ENDED_KEY);
        return ended === noteId;
    } catch {
        return false;
    }
}

/**
 * Drops the session's grant on the subtree of `noteId`, renewing once a `token` the session no
 * longer knows, and resolves to whether the session is left without access to the note.
 */
async function dropGrant(noteId: string, token: string, signal?: AbortSignal) {
    const post = (csrfToken: string) => fetch("api/edit/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ noteId }),
        signal
    });
    try {
        const response = await post(token);
        if (response.status !== 403) {
            return response.ok;
        }
        const session = await fetchSession(noteId, signal);
        if (!session?.csrfToken) {
            // Only a session that holds the note unlocked gets a token.
            return !!session && !session.unlocked;
        }
        return (await post(session.csrfToken)).ok;
    } catch {
        return false;
    }
}

async function fetchSession(noteId: string, signal?: AbortSignal): Promise<EditSession | null> {
    try {
        const url = `api/edit/session?noteId=${encodeURIComponent(noteId)}`;
        const response = await fetch(url, { signal });
        return response.ok ? await response.json() as EditSession : null;
    } catch {
        return null;
    }
}

/** The controls: the *Edit* button, the password form, and the buttons while editing. */
function buildControls(strings: Record<string, string>) {
    const bar = document.createElement("div");
    bar.className = "share-edit-bar";
    bar.innerHTML = `
        <button type="button" class="share-edit-button share-edit-start"></button>
        <form class="share-edit-login" hidden>
            <input type="password" class="share-edit-password"
                autocomplete="current-password" required>
            <button type="submit" class="share-edit-button"></button>
        </form>
        <button type="button" class="share-edit-button share-edit-stop" hidden></button>
        <button type="button" class="share-edit-button share-edit-log-out" hidden></button>
        <p class="share-edit-error" role="alert" hidden></p>`;
    const find = <T extends HTMLElement>(selector: string) => bar.querySelector(selector) as T;
    const editButton = find<HTMLButtonElement>(".share-edit-start");
    const loginForm = find<HTMLFormElement>(".share-edit-login");
    const passwordInput = find<HTMLInputElement>(".share-edit-password");
    const stopButton = find<HTMLButtonElement>(".share-edit-stop");
    const logOutButton = find<HTMLButtonElement>(".share-edit-log-out");
    const error = find<HTMLParagraphElement>(".share-edit-error");

    editButton.textContent = strings.edit ?? "";
    passwordInput.placeholder = strings.password ?? "";
    find(".share-edit-login button").textContent = strings.unlock ?? "";
    stopButton.textContent = strings.stop ?? "";
    logOutButton.textContent = strings.logOut ?? "";

    return {
        bar,
        editButton,
        loginForm,
        passwordInput,
        stopButton,
        logOutButton,
        showLogin() {
            editButton.hidden = true;
            loginForm.hidden = false;
        },
        showEditing(canLogOut: boolean) {
            editButton.hidden = true;
            loginForm.hidden = true;
            stopButton.hidden = false;
            logOutButton.hidden = !canLogOut;
        },
        setError(key: ErrorKey | null) {
            error.hidden = key === null;
            error.textContent = key === null ? "" : strings[key] ?? key;
        }
    };
}
