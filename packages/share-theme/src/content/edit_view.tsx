import "@triliumnext/client/src/stylesheets/ckeditor-theme.css";
import "@triliumnext/client/src/widgets/type_widgets/text/EditableText.css";

import appContext from "@triliumnext/client/src/components/app_context.js";
import Component from "@triliumnext/client/src/components/component.js";
import type { SaveState } from "@triliumnext/client/src/components/note_context.js";
import froca from "@triliumnext/client/src/services/froca.js";
import { t } from "@triliumnext/client/src/services/i18n.js";
import linkService from "@triliumnext/client/src/services/link.js";
import server from "@triliumnext/client/src/services/server.js";
import utils, { randomString, type ShareEditGlobals } from "@triliumnext/client/src/services/utils.js";
import { TYPE_MAPPINGS } from "@triliumnext/client/src/widgets/note_types.js";
import Alert from "@triliumnext/client/src/widgets/react/Alert.js";
import Button from "@triliumnext/client/src/widgets/react/Button.js";
import { useTriliumEvent } from "@triliumnext/client/src/widgets/react/hooks.js";
import { type ComponentType, createPortal, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import ShareAppHost, { type AppPayload, type HostedApp } from "./app_host.js";

export interface EditViewOptions {
    noteId: string;
    /** The page's title element, which the view makes editable. */
    title: HTMLElement;
    payload: AppPayload;
    csrfToken: string;
    /** The `blobId` of the note's content, which the first save names. */
    version: string;
    attachments: boolean;
    /** Where the page shows the editor's state; above the editor without one. */
    statusContainer?: HTMLElement;
    /** Where the page shows the editor's toolbar; above the editor without one. */
    toolbarContainer?: HTMLElement;
    /**
     * Called once the server refuses a save because the visitor's access ended, such as by a new
     * password; the page unlocks the note again and calls {@link EditView.resume}.
     */
    onLocked?: () => void;
    /**
     * Called once saves keep failing for over a minute, none of them stored; the page logs out of
     * editing and calls `release` right before it leaves, so that leaving does not ask to stay.
     */
    onSavesFailing: (release: () => void) => void;
}

export interface EditView {
    /**
     * Saves what the editor and the title still hold, and resolves to whether all of it is
     * stored, which the page waits for before it leaves the editor.
     */
    stop(): Promise<boolean>;
    /** Saves what was held while the access was lost, under the token of the new unlock. */
    resume(csrfToken: string): void;
}

/** What the app's modules read from `window.glob` on a page that saves, beyond the boot script's. */
interface EditGlobals {
    baseApiUrl: string;
    csrfToken: string;
    csrfRefreshUrl: string;
    componentId: string;
    isDesktop: typeof utils.isDesktop;
    isMobile: typeof utils.isMobile;
    getHeaders: typeof server.getHeaders;
    getComponentByEl: typeof appContext.getComponentByEl;
    getReferenceLinkTitle: (href: string) => Promise<string>;
    getReferenceLinkTitleSync: (href: string, storedTitle?: string) => string;
    getActiveContextNote: () => HostedApp["note"] | null;
    froca: typeof froca;
    treeCache: typeof froca;
    shareEdit: ShareEditGlobals;
}

export type { ShareEditGlobals };

/** How long after the last keystroke the title is saved. */
const TITLE_SAVE_DELAY = 1000;
/** How long after the server refused the title it is sent again. */
const TITLE_RETRY_DELAY = 5000;
/** How long saves can keep failing, none of them stored, before the page logs out of editing. */
const SAVE_FAILURE_LIMIT = 60_000;

/**
 * Mounts the app's text editor on a shared page whose note the visitor unlocked; it and the
 * page's title save through the share's guest API under the login's CSRF token.
 */
export default async function mountEditView(container: HTMLElement, options: EditViewOptions): Promise<EditView> {
    const status = createStatus();
    const component = new Component();
    const resumes = new Set<() => void>();
    // The page asks for the access once, however many saves were refused meanwhile.
    const onLocked = (resume?: () => void) => {
        if (resume) {
            resumes.add(resume);
        }
        if (!status.value.locked) {
            status.set({ ...status.value, locked: true });
            options.onLocked?.();
        }
    };
    let ended = false;
    const giveUp = () => {
        if (!ended) {
            ended = true;
            options.onSavesFailing(() => {
                appContext.beforeUnloadListeners = [];
            });
        }
    };
    installGlobals(options, status, component, onLocked, createFailureClock(giveUp));
    const view = await TYPE_MAPPINGS.editableText.view();
    const Widget = ("default" in view ? view.default : view) as ComponentType<WidgetProps>;
    render(
        <ShareAppHost noteId={options.noteId} payload={options.payload} readOnly={false} component={component}>
            {(app) => (
                <EditShell
                    app={app}
                    Widget={Widget}
                    status={status}
                    component={component}
                    statusContainer={options.statusContainer}
                    toolbarContainer={options.toolbarContainer}
                />
            )}
        </ShareAppHost>,
        container
    );
    const title = makeTitleEditable(
        options.title, options.noteId, container, onLocked, createFailureClock(giveUp));

    return {
        async stop() {
            const titleSaved = await title.flush();
            await component.triggerCommand("saveNoteDetailNow");
            const { state, conflict, locked } = status.value;
            return titleSaved && state === "saved" && !conflict && !locked;
        },
        resume(csrfToken) {
            (window.glob as unknown as EditGlobals).csrfToken = csrfToken;
            status.set({ ...status.value, locked: false });
            const pending = [ ...resumes ];
            resumes.clear();
            for (const resume of pending) {
                resume();
            }
            void title.flush();
        }
    };
}

/**
 * Sets what the app's modules read on a page that saves: the guest API, its CSRF token and the
 * editor's globals. `component` answers the plugins' lookups, as the page has no widget element.
 */
function installGlobals(
    options: EditViewOptions,
    status: Status,
    component: Component,
    onLocked: (resume: () => void) => void,
    clock: FailureClock
) {
    // The boot script defines `window.glob` on every shared page.
    const glob = window.glob as unknown as EditGlobals;
    glob.baseApiUrl = "api/";
    glob.csrfToken = options.csrfToken;
    glob.csrfRefreshUrl = `api/edit/session?noteId=${encodeURIComponent(options.noteId)}`;
    glob.componentId = randomString(12);
    glob.isDesktop = utils.isDesktop;
    glob.isMobile = utils.isMobile;
    glob.getHeaders = server.getHeaders;
    glob.getComponentByEl = (el) => appContext.getComponentByEl(el) ?? component;
    glob.getReferenceLinkTitle = (href) => linkService.getReferenceLinkTitle(href);
    glob.getReferenceLinkTitleSync = (href, storedTitle) => linkService.getReferenceLinkTitleSync(href, storedTitle);
    glob.getActiveContextNote = () => froca.getNoteFromCache(options.noteId) ?? null;
    glob.froca = froca;
    glob.treeCache = froca;
    glob.shareEdit = {
        version: options.version,
        attachments: options.attachments,
        onSaveState: (state) => {
            status.report(state);
            if (state === "error") {
                clock.failed();
            } else if (state === "saved") {
                clock.settled();
            }
        },
        onConflict: (stale, retry) =>
            status.set({ ...status.value, state: "error", conflict: { stale, retry } }),
        onLocked
    };
}

/**
 * Counts how long one kind of save keeps failing: the first failure since it was last all saved
 * starts the count, and a failure past {@link SAVE_FAILURE_LIMIT} calls `onExpired`.
 */
interface FailureClock {
    failed(): void;
    /** Records that nothing of this kind is left to save. */
    settled(): void;
}

function createFailureClock(onExpired: () => void): FailureClock {
    let since: number | undefined;
    return {
        failed() {
            const now = Date.now();
            since ??= now;
            if (now - since > SAVE_FAILURE_LIMIT) {
                onExpired();
            }
        },
        settled() {
            since = undefined;
        }
    };
}

interface Conflict {
    stale: { blobId: string };
    retry(): void;
}

interface StatusValue {
    state: SaveState;
    conflict?: Conflict;
    /** Whether saves wait for the page to unlock the note again. */
    locked?: boolean;
}

/** The editor's state, which the globals write and {@link EditShell} shows. */
interface Status {
    value: StatusValue;
    set(value: StatusValue): void;
    /**
     * Shows the state the editor reports; a conflict and a lost access stay up until the visitor
     * settles them.
     */
    report(state: SaveState): void;
    subscribe(listener: (value: StatusValue) => void): () => void;
}

function createStatus(): Status {
    const listeners = new Set<(value: StatusValue) => void>();
    const status: Status = {
        value: { state: "saved" },
        set(value) {
            status.value = value;
            for (const listener of listeners) {
                listener(value);
            }
        },
        report(state) {
            status.set({ ...status.value, state });
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
    return status;
}

interface WidgetProps {
    note: HostedApp["note"];
    viewScope: undefined;
    ntxId: null;
    parentComponent: Component;
    noteContext: undefined;
    isVisible: boolean;
}

interface EditShellProps {
    app: HostedApp;
    Widget: ComponentType<WidgetProps>;
    status: Status;
    /** The component the editor reports to, which the page's commands reach it through. */
    component: Component;
    statusContainer?: HTMLElement;
    toolbarContainer?: HTMLElement;
}

/**
 * The editor's toolbar, state and conflict around the app's editor of the note. The decoupled
 * toolbar is placed once the editor reports itself, as the app's formatting toolbar does.
 */
function EditShell(
    { app, Widget, status, component, statusContainer, toolbarContainer }: EditShellProps
) {
    const [ value, setValue ] = useState(status.value);
    const { conflict } = value;
    const toolbarRef = useRef<HTMLDivElement>(null);
    useEffect(() => status.subscribe(setValue), [ status ]);
    useTriliumEvent("textEditorRefreshed", ({ editor }) => {
        const toolbar = editor.ui.view.toolbar?.element;
        toolbarRef.current?.replaceChildren(...(toolbar ? [ toolbar ] : []));
    });

    const state = (
        <span className="share-edit-status">
            {t(conflict || value.locked
                ? "share_edit.status_not_saved"
                : `share_edit.status_${value.state}`)}
        </span>
    );
    const toolbar = <div ref={toolbarRef} className="share-edit-toolbar" />;
    return (
        <>
            {toolbarContainer ? createPortal(toolbar, toolbarContainer) : toolbar}
            {statusContainer ? createPortal(state, statusContainer) : state}
            {conflict && <Alert type="warning" className="share-edit-conflict">
                <p>{t("share_edit.conflict")}</p>
                <Button
                    text={t("share_edit.conflict_reload")}
                    onClick={() => {
                        // The visitor drops the version `useSaveBeforeLeaving` still holds.
                        appContext.beforeUnloadListeners = [];
                        window.location.reload();
                    }}
                />
                <Button
                    text={t("share_edit.conflict_keep")}
                    kind="primary"
                    onClick={() => {
                        status.set({ ...status.value, state: "unsaved", conflict: undefined });
                        conflict.retry();
                    }}
                />
            </Alert>}
            <div className={TYPE_MAPPINGS.editableText.className}>
                <Widget
                    note={app.note}
                    viewScope={undefined}
                    ntxId={null}
                    parentComponent={component}
                    noteContext={undefined}
                    isVisible
                />
            </div>
        </>
    );
}

/**
 * Makes the page's title editable as the app's title box is, saving after a pause, on leaving and
 * on `flush`, one save at a time; a title counts as saved once the server stored it, and a refused
 * one is sent again after {@link TITLE_RETRY_DELAY}.
 */
function makeTitleEditable(
    title: HTMLElement, noteId: string, container: HTMLElement, onLocked: () => void,
    clock: FailureClock
) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // An element's `textContent` is a string, whatever the DOM types allow.
    const readTitle = () => String(title.textContent).trim();
    let saved = readTitle();
    let saving = Promise.resolve(true);
    const save = () => {
        clearTimeout(timer);
        timer = undefined;
        saving = saving.then(async () => {
            const text = readTitle();
            if (!text || text === saved) {
                clock.settled();
                return true;
            }
            try {
                await server.putWithSilentRefusal(`notes/${noteId}/title`, { title: text });
                saved = text;
                clock.settled();
                return true;
            } catch (e) {
                if (isLockedRefusal(e)) {
                    onLocked();
                }
                clock.failed();
                timer ??= setTimeout(() => void save(), TITLE_RETRY_DELAY);
                return false;
            }
        });
        return saving;
    };
    // Leaving with a title not stored yet asks to stay, as for the note's content, and sends it.
    appContext.addBeforeUnloadListener(() => {
        const text = readTitle();
        if (!text || text === saved) {
            return true;
        }
        void save();
        return false;
    });

    title.contentEditable = "true";
    title.spellcheck = true;
    title.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => void save(), TITLE_SAVE_DELAY);
    });
    title.addEventListener("keydown", (event) => {
        // An Enter that confirms an input method's composition belongs to the composition.
        if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            container.querySelector<HTMLElement>(".ck-editor__editable")?.focus();
        }
    });
    title.addEventListener("blur", () => void save());

    return { flush: save };
}

/** Whether a refused request's response says the visitor's access ended. */
function isLockedRefusal(response: unknown) {
    try {
        return (JSON.parse(String(response)) as { locked?: unknown }).locked === true;
    } catch {
        return false;
    }
}
