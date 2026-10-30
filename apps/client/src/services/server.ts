import type { StandaloneApi } from "@triliumnext/commons";

import { t } from "./i18n.js";
import { getSetupAuthToken } from "./setup_auth.js";
import utils, { isShare, isShareEditing } from "./utils.js";
import ValidationError from "./validation_error.js";

type Headers = Record<string, string | null | undefined>;

interface Response {
    headers: Headers;
    body: unknown;
}

export interface StandardResponse {
    success: boolean;
}

async function getHeaders(headers?: Headers) {
    // A visitor of a shared page sends nothing of the app's, unless the page is editing its note.
    if (isShare && !isShareEditing()) {
        return {};
    }

    const activeNoteContext = glob.appContext?.tabManager ? glob.appContext.tabManager.getActiveContext() : null;

    // headers need to be lowercase because node.js automatically converts them to lower case
    // also avoiding using underscores instead of dashes since nginx filters them out by default
    const allHeaders: Headers = {
        "trilium-component-id": glob.componentId,
        "trilium-local-now-datetime": utils.localNowDateTime(),
        "trilium-hoisted-note-id": activeNoteContext ? activeNoteContext.hoistedNoteId : null,
        "x-csrf-token": glob.csrfToken,
        // What unlocks the setup wizard where a knowledge base is sitting behind it. Null on every
        // other page, and dropped below along with every other header that has no value.
        "trilium-setup-auth": getSetupAuthToken()
    };

    for (const headerName in headers) {
        if (headers[headerName]) {
            allHeaders[headerName] = headers[headerName];
        }
    }

    return allHeaders;
}

async function getWithSilentNotFound<T>(url: string, componentId?: string) {
    return await call<T>("GET", url, componentId, { silentNotFound: true });
}

/**
 * @param raw if `true`, the value will be returned as a string instead of a JavaScript object if JSON, XMLDocument if XML, etc.
 */
async function get<T>(url: string, componentId?: string, raw?: boolean) {
    return await call<T>("GET", url, componentId, { raw });
}

async function getWithSilentUnauthorized<T>(url: string, componentId?: string) {
    return await call<T>("GET", url, componentId, { silentUnauthorized: true });
}

async function post<T>(url: string, data?: unknown, componentId?: string) {
    return await call<T>("POST", url, componentId, { data });
}

async function postWithSilentInternalServerError<T>(url: string, data?: unknown, componentId?: string) {
    return await call<T>("POST", url, componentId, { data, silentInternalServerError: true });
}

/**
 * For an operation that runs in minutes rather than seconds — see {@link CallOptions.timeoutMs}. The
 * work carries on server-side whatever the client does, so giving up early does not stop it; it only
 * loses the answer, and reports a failure for something that is still succeeding.
 */
async function getWithTimeout<T>(url: string, timeoutMs: number, componentId?: string) {
    return await call<T>("GET", url, componentId, { timeoutMs });
}

/**
 * The POST counterpart of {@link getWithTimeout}. `silence` suppresses the error toast for a
 * caller that shows the failure itself.
 */
async function postWithTimeout<T>(url: string, timeoutMs: number, data?: unknown, componentId?: string, silence?: Pick<CallOptions, "silentBadRequest">) {
    return await call<T>("POST", url, componentId, { data, timeoutMs, ...silence });
}

async function put<T>(url: string, data?: unknown, componentId?: string) {
    return await call<T>("PUT", url, componentId, { data });
}

/**
 * A PUT whose caller handles the server's refusal itself: a 409 for a save over an older version,
 * a 401 for one whose access ended, as a guest's save on a shared page meets.
 */
async function putWithSilentRefusal<T>(url: string, data?: unknown, componentId?: string) {
    return await call<T>("PUT", url, componentId,
        { data, silentConflict: true, silentUnauthorized: true });
}

async function patch<T>(url: string, data: unknown, componentId?: string) {
    return await call<T>("PATCH", url, componentId, { data });
}

async function remove<T>(url: string, componentId?: string) {
    return await call<T>("DELETE", url, componentId);
}

async function upload(url: string, fileToUpload: File, componentId?: string, method = "PUT") {
    const doUpload = async () => uploadForm(url, {
        method,
        headers: await getHeaders(componentId ? {
            "trilium-component-id": componentId
        } : undefined),
        fields: {},
        file: fileToUpload,
        timeoutMs: UPLOAD_TIMEOUT
    });

    try {
        return await doUpload();
    } catch (e: unknown) {
        // jQuery rejects with the jqXHR object
        const jqXhr = e as JQuery.jqXHR;
        if (jqXhr?.status && isCsrfError(jqXhr.status, jqXhr.responseText)) {
            await refreshCsrfToken();
            return await doUpload();
        }
        throw e;
    }
}

export interface UploadFormOptions {
    method: string;
    headers: Headers;
    fields: Record<string, string>;
    /** Sent as the form's `upload` field. */
    file: File;
    timeoutMs: number;
    /** Passed to jQuery, which otherwise picks a parser from the response's content type. */
    dataType?: "json";
}

/** What `uploadForm()` rejects with on an error status: the fields of a jqXHR that callers read. */
export interface UploadFormError {
    status: number;
    responseText: string;
}

const UPLOAD_TIMEOUT = 60 * 60 * 1000;

/**
 * Sends a multipart form carrying one file and resolves with the parsed response. The standalone
 * leader tab hands the `File` to its worker through `standaloneApi.localUpload`, so the page never
 * reads it and an import can read a zip one entry at a time; everywhere else it goes out as an XHR.
 * Rejects with an {@link UploadFormError} on an error status.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the parsed body of whatever the route answers, as `$.ajax` gives it
async function uploadForm(url: string, options: UploadFormOptions): Promise<any> {
    const headers: Record<string, string> = {};
    for (const [ name, value ] of Object.entries(options.headers)) {
        if (value) {
            headers[name] = value;
        }
    }

    const localUpload = getLocalUpload();
    if (localUpload) {
        return await localUploadForm(localUpload, url, headers, options);
    }

    const formData = new FormData();
    formData.append("upload", options.file);
    for (const [ name, value ] of Object.entries(options.fields)) {
        formData.append(name, value);
    }

    return await $.ajax({
        url: window.glob.baseApiUrl + url,
        headers,
        data: formData,
        type: options.method,
        dataType: options.dataType,
        timeout: options.timeoutMs,
        contentType: false, // NEEDED, DON'T REMOVE THIS
        processData: false // NEEDED, DON'T REMOVE THIS
    });
}

/** The standalone leader tab's in-page upload to its worker, or `undefined` elsewhere. */
function getLocalUpload() {
    return USE_LOCAL_FETCH ? window.standaloneApi?.localUpload : undefined;
}

async function localUploadForm(
    localUpload: NonNullable<StandaloneApi["localUpload"]>,
    url: string,
    headers: Record<string, string>,
    options: UploadFormOptions
): Promise<unknown> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_, rej) => {
        timeoutHandle = setTimeout(
            () => rej(new Error(`Timed out after ${options.timeoutMs}ms: ${options.method} ${url}`)),
            options.timeoutMs
        );
    });

    let resp: globalThis.Response;
    try {
        resp = await Promise.race([
            localUpload(window.glob.baseApiUrl + url, {
                method: options.method,
                headers,
                fields: options.fields,
                file: options.file
            }),
            expiry
        ]);
    } finally {
        clearTimeout(timeoutHandle);
    }

    const responseText = await resp.text();
    if (!resp.ok) {
        throw { status: resp.status, responseText } satisfies UploadFormError;
    }
    if ((resp.headers.get("content-type") ?? "").includes("json")) {
        return responseText ? JSON.parse(responseText) : null;
    }
    return responseText;
}

let maxKnownEntityChangeId = 0;

let csrfRefreshInProgress: Promise<void> | null = null;

/**
 * Re-fetches /bootstrap to obtain a fresh CSRF token. This is needed when the
 * server session expires (e.g. mobile tab backgrounded for a long time) and the
 * existing CSRF token is no longer valid.
 *
 * Coalesces concurrent calls so only one bootstrap request is in-flight at a time.
 */
async function refreshCsrfToken(): Promise<void> {
    if (csrfRefreshInProgress) {
        return csrfRefreshInProgress;
    }

    csrfRefreshInProgress = (async () => {
        try {
            const url = glob.csrfRefreshUrl ?? `./bootstrap${window.location.search}`;
            const response = await fetch(url, { cache: "no-store" });
            if (response.ok) {
                const json = await response.json();
                glob.csrfToken = json.csrfToken;
            }
        } finally {
            csrfRefreshInProgress = null;
        }
    })();

    return csrfRefreshInProgress;
}

function isCsrfError(status: number, responseText: string): boolean {
    if (status !== 403) {
        return false;
    }
    try {
        const body = JSON.parse(responseText);
        return body.message === "Invalid CSRF token";
    } catch {
        return false;
    }
}

interface CallOptions {
    data?: unknown;
    silentNotFound?: boolean;
    silentInternalServerError?: boolean;
    /** Suppresses the error toast for a 400, for callers that show the server's message themselves. */
    silentBadRequest?: boolean;
    /** Suppresses the generic error toast for a 401, for callers that present the failure themselves
     *  (e.g. the OneNote import dialog showing an expired connection inline, with the server's reason). */
    silentUnauthorized?: boolean;
    /** Suppresses the error toast for a 409, for a caller that resolves the conflict itself. */
    silentConflict?: boolean;
    // If `true`, the value will be returned as a string instead of a JavaScript object if JSON, XMLDocument if XML, etc.
    raw?: boolean;
    /** Used internally to prevent infinite retry loops on CSRF refresh. */
    csrfRetried?: boolean;
    /**
     * How long to wait before giving up, for the few operations that legitimately run past
     * {@link DEFAULT_TIMEOUT} — a database rebuild, an erasure sweeping a large database. Left unset
     * everywhere else, so an ordinary request that hangs still fails rather than hanging its caller.
     */
    timeoutMs?: number;
}

/**
 * Long enough for any request the UI makes while someone waits on it. Operations measured in
 * minutes state their own — see {@link CallOptions.timeoutMs}.
 */
const DEFAULT_TIMEOUT = 60000;

/**
 * Whether a standalone tab that owns the SQLite worker answers its own API calls, rather than
 * letting the XHR below reach that same worker through the service worker's forwarding.
 *
 * Build with `VITE_DISABLE_LOCAL_FETCH=true` to take the service worker's route instead, which is
 * what compares the two transports. An unset variable keeps the direct path, so a build that does
 * not name the variable still gets it.
 */
const USE_LOCAL_FETCH = import.meta.env.VITE_DISABLE_LOCAL_FETCH !== "true";

async function call<T>(method: string, url: string, componentId?: string, options: CallOptions = {}) {
    const headers = await getHeaders({
        "trilium-component-id": componentId
    });
    const { data } = options;

    // In Electron the page is loaded from the `trilium-app://` custom
    // protocol, whose handler routes everything through the same Express
    // app the browser build talks to over HTTP. So a single $.ajax path
    // covers both — no IPC bridge needed.
    const resp = await ajax(url, method, data, headers, options);

    const maxEntityChangeIdStr = resp.headers["trilium-max-entity-change-id"];

    if (maxEntityChangeIdStr && maxEntityChangeIdStr.trim()) {
        maxKnownEntityChangeId = Math.max(maxKnownEntityChangeId, parseInt(maxEntityChangeIdStr));
    }

    return resp.body as T;
}

function ajax(url: string, method: string, data: unknown, headers: Headers, opts: CallOptions): Promise<Response> {
    // The standalone leader tab defines `standaloneApi.localFetch`, which the in-page SQLite
    // worker answers directly — the XHR below would reach the same worker through the service
    // worker's forwarding. Follower tabs and the other builds leave it unset.
    const localFetch = USE_LOCAL_FETCH ? window.standaloneApi?.localFetch : undefined;
    if (localFetch) {
        return localAjax(localFetch, url, method, data, headers, opts);
    }

    return new Promise((res, rej) => {
        const options: JQueryAjaxSettings = {
            url: window.glob.baseApiUrl + url,
            type: method,
            headers,
            timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
            success: (body, _textStatus, jqXhr) => {
                const respHeaders: Headers = {};

                jqXhr
                    .getAllResponseHeaders()
                    .trim()
                    .split(/[\r\n]+/)
                    .forEach((line) => {
                        const parts = line.split(": ");
                        const header = parts.shift();
                        if (header) {
                            respHeaders[header] = parts.join(": ");
                        }
                    });

                res({
                    body,
                    headers: respHeaders
                });
            },
            error: async (jqXhr) => {
                if (jqXhr.status === 0) {
                    // don't report requests that are rejected by the browser, usually when the user is refreshing or going to a different page.
                    rej("rejected by browser");
                    return;
                }

                // If the CSRF token is stale (e.g. session expired while tab was backgrounded),
                // refresh it and retry the request once.
                if (!opts.csrfRetried && isCsrfError(jqXhr.status, jqXhr.responseText)) {
                    try {
                        await refreshCsrfToken();
                        // Rebuild headers so the fresh glob.csrfToken is picked up
                        const retryHeaders = await getHeaders({ "trilium-component-id": headers["trilium-component-id"] });
                        const retryResult = await ajax(url, method, data, retryHeaders, { ...opts, csrfRetried: true });
                        res(retryResult);
                        return;
                    } catch (retryErr) {
                        rej(retryErr);
                        return;
                    }
                }

                if (opts.silentNotFound && jqXhr.status === 404) {
                    // report nothing
                } else if (opts.silentInternalServerError && jqXhr.status === 500) {
                    // report nothing
                } else if (opts.silentUnauthorized && jqXhr.status === 401) {
                    // report nothing
                } else if (opts.silentBadRequest && jqXhr.status === 400) {
                    // report nothing
                } else if (opts.silentConflict && jqXhr.status === 409) {
                    // report nothing
                } else {
                    try {
                        await reportError(method, url, jqXhr.status, jqXhr.responseText);
                    } catch {
                        // reportError may throw (e.g. ValidationError); ensure rej() is still called below.
                    }
                }

                rej(jqXhr.responseText);
            }
        };

        if (opts.raw) {
            options.dataType = "text";
        }

        if (data) {
            try {
                options.data = JSON.stringify(data);
            } catch (e) {
                console.log("Can't stringify data: ", data, " because of error: ", e);
            }
            options.contentType = "application/json";
        }

        $.ajax(options);
    });
}

/**
 * The `ajax()` fast path for the standalone leader tab: the same request shape, response contract
 * and error handling, but answered by `standaloneApi.localFetch` instead of an XHR.
 */
async function localAjax(
    localFetch: (request: Request) => Promise<globalThis.Response>,
    url: string,
    method: string,
    data: unknown,
    headers: Headers,
    opts: CallOptions
): Promise<Response> {
    const requestHeaders: Record<string, string> = {};
    for (const [ name, value ] of Object.entries(headers)) {
        if (value) {
            requestHeaders[name] = value;
        }
    }

    let body: string | undefined;
    if (data) {
        try {
            body = JSON.stringify(data);
            requestHeaders["content-type"] = "application/json";
        } catch (e) {
            console.log("Can't stringify data: ", data, " because of error: ", e);
        }
    }

    // The worker carries on with a request this stops waiting for, the same way the XHR path
    // abandons one still in flight. Nothing else bounds the wait: a worker that died rejects what
    // it was holding, but one stuck inside a request never answers it.
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_, rej) => {
        timeoutHandle = setTimeout(() => rej(new Error(`Timed out after ${timeoutMs}ms: ${method} ${url}`)), timeoutMs);
    });

    const request = new Request(window.glob.baseApiUrl + url, { method, headers: requestHeaders, body });
    const startedAt = performance.now();

    let resp: globalThis.Response;
    try {
        resp = await Promise.race([ localFetch(request), expiry ]);
    } finally {
        clearTimeout(timeoutHandle);
        if (import.meta.env.DEV) {
            // This transport opens no XHR, so devtools' network panel lists none of these.
            console.debug(`[api] ${method} ${url} ${(performance.now() - startedAt).toFixed(1)}ms`);
        }
    }

    const responseText = await resp.text();

    if (!resp.ok) {
        // If the CSRF token is stale (e.g. session expired while tab was backgrounded),
        // refresh it and retry the request once.
        if (!opts.csrfRetried && isCsrfError(resp.status, responseText)) {
            await refreshCsrfToken();
            // Rebuild headers so the fresh glob.csrfToken is picked up
            const retryHeaders = await getHeaders({ "trilium-component-id": headers["trilium-component-id"] });
            return await ajax(url, method, data, retryHeaders, { ...opts, csrfRetried: true });
        }

        const silenced = (opts.silentNotFound && resp.status === 404)
            || (opts.silentInternalServerError && resp.status === 500)
            || (opts.silentUnauthorized && resp.status === 401)
            || (opts.silentBadRequest && resp.status === 400)
            || (opts.silentConflict && resp.status === 409);

        if (!silenced) {
            try {
                await reportError(method, url, resp.status, responseText);
            } catch {
                // reportError may throw (e.g. ValidationError); the throw below signals the caller either way.
            }
        }

        throw responseText;
    }

    const respHeaders: Headers = {};
    for (const [ name, value ] of resp.headers.entries()) {
        respHeaders[name] = value;
    }

    let respBody: unknown = responseText;
    if (!opts.raw && (resp.headers.get("content-type") ?? "").includes("json")) {
        respBody = responseText ? JSON.parse(responseText) : null;
    }

    return { body: respBody, headers: respHeaders };
}

async function reportError(method: string, url: string, statusCode: number, response: unknown) {
    let message = response;

    if (typeof response === "string") {
        try {
            response = JSON.parse(response);
            message = (response as any).message;
        } catch (e) {}
    }

    // Dynamic import to avoid circular dependency (toast → app_context → options → server).
    const toastService = (await import("./toast.js")).default;

    const messageStr = (typeof message === "string" ? message : JSON.stringify(message)) || "-";

    if ([400, 404].includes(statusCode) && response && typeof response === "object") {
        toastService.showError(messageStr);
        throw new ValidationError({
            requestUrl: url,
            method,
            statusCode,
            ...response
        });
    } else {
        toastService.showErrorTitleAndMessage(
            t("server.unknown_http_error_title"),
            t("server.unknown_http_error_content", { statusCode, method, url, message: messageStr }),
            15_000);
        window.logError(`${statusCode} ${method} ${url} - ${message}`);
    }
}

export default {
    get,
    getWithSilentNotFound,
    getWithSilentUnauthorized,
    getWithTimeout,
    post,
    postWithSilentInternalServerError,
    postWithTimeout,
    put,
    putWithSilentRefusal,
    patch,
    remove,
    upload,
    uploadForm,
    // don't remove, used from CKEditor image upload!
    getHeaders,
    getLocalUpload,
    getMaxKnownEntityChangeId: () => maxKnownEntityChangeId
};
