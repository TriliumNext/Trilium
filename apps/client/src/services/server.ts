import utils, { isShare } from "./utils.js";
import ValidationError from "./validation_error.js";

type Headers = Record<string, string | null | undefined>;

type Method = string;

interface Response {
    headers: Headers;
    body: unknown;
}

interface Arg extends Response {
    statusCode: number;
    method: Method;
    url: string;
    requestId: string;
}

interface RequestData {
    resolve: (value: unknown) => any;
    reject: (reason: unknown) => any;
    silentNotFound: boolean;
}

export interface StandardResponse {
    success: boolean;
}

async function getHeaders(headers?: Headers) {
    if (isShare) {
        return {};
    }

    const appContext = (await import("../components/app_context.js")).default;
    const activeNoteContext = appContext.tabManager ? appContext.tabManager.getActiveContext() : null;

    // headers need to be lowercase because node.js automatically converts them to lower case
    // also avoiding using underscores instead of dashes since nginx filters them out by default
    const allHeaders: Headers = {
        "trilium-component-id": glob.componentId,
        "trilium-local-now-datetime": utils.localNowDateTime(),
        "trilium-hoisted-note-id": activeNoteContext ? activeNoteContext.hoistedNoteId : null,
        "x-csrf-token": glob.csrfToken
    };

    for (const headerName in headers) {
        if (headers[headerName]) {
            allHeaders[headerName] = headers[headerName];
        }
    }

    if (utils.isElectron()) {
        // passing it explicitly here because of the electron HTTP bypass
        allHeaders.cookie = document.cookie;
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

async function post<T>(url: string, data?: unknown, componentId?: string) {
    return await call<T>("POST", url, componentId, { data });
}

async function put<T>(url: string, data?: unknown, componentId?: string) {
    return await call<T>("PUT", url, componentId, { data });
}

async function patch<T>(url: string, data: unknown, componentId?: string) {
    return await call<T>("PATCH", url, componentId, { data });
}

async function remove<T>(url: string, componentId?: string) {
    return await call<T>("DELETE", url, componentId);
}

async function upload(url: string, fileToUpload: File, componentId?: string) {
    const formData = new FormData();
    formData.append("upload", fileToUpload);

    return await $.ajax({
        url: window.glob.baseApiUrl + url,
        headers: await getHeaders(componentId ? {
            "trilium-component-id": componentId
        } : undefined),
        data: formData,
        type: "PUT",
        timeout: 60 * 60 * 1000,
        contentType: false, // NEEDED, DON'T REMOVE THIS
        processData: false // NEEDED, DON'T REMOVE THIS
    });
}

let idCounter = 1;

const idToRequestMap: Record<string, RequestData> = {};

let maxKnownEntityChangeId = 0;

interface CallOptions {
    data?: unknown;
    silentNotFound?: boolean;
    // If `true`, the value will be returned as a string instead of a JavaScript object if JSON, XMLDocument if XML, etc.
    raw?: boolean;
}

async function call<T>(method: string, url: string, componentId?: string, options: CallOptions = {}) {
    let resp;

    const headers = await getHeaders({
        "trilium-component-id": componentId
    });
    const { data } = options;

    if (utils.isElectron()) {
        const ipc = utils.dynamicRequire("electron").ipcRenderer;
        const requestId = idCounter++;

        resp = (await new Promise((resolve, reject) => {
            idToRequestMap[requestId] = {
                resolve,
                reject,
                silentNotFound: !!options.silentNotFound
            };

            ipc.send("server-request", {
                requestId,
                headers,
                method,
                url: `/${window.glob.baseApiUrl}${url}`,
                data
            });
        })) as any;
    } else {
        resp = await ajax(url, method, data, headers, !!options.silentNotFound, options.raw);
    }

    const maxEntityChangeIdStr = resp.headers["trilium-max-entity-change-id"];

    if (maxEntityChangeIdStr && maxEntityChangeIdStr.trim()) {
        maxKnownEntityChangeId = Math.max(maxKnownEntityChangeId, parseInt(maxEntityChangeIdStr));
    }

    return resp.body as T;
}

/**
 * @param raw if `true`, the value will be returned as a string instead of a JavaScript object if JSON, XMLDocument if XML, etc.
 */
function ajax(url: string, method: string, data: unknown, headers: Headers, silentNotFound: boolean, raw?: boolean): Promise<Response> {
    return new Promise((res, rej) => {
        const options: JQueryAjaxSettings = {
            url: window.glob.baseApiUrl + url,
            type: method,
            headers,
            timeout: 60000,
            success: (body, textStatus, jqXhr) => {
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
                } else if (silentNotFound && jqXhr.status === 404) {
                    // report nothing
                } else {
                    await reportError(method, url, jqXhr.status, jqXhr.responseText);
                }

                rej(jqXhr.responseText);
            }
        };

        if (raw) {
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

if (utils.isElectron()) {
    const ipc = utils.dynamicRequire("electron").ipcRenderer;

    ipc.on("server-response", async (_, arg: Arg) => {
        if (arg.statusCode >= 200 && arg.statusCode < 300) {
            handleSuccessfulResponse(arg);
        } else {
            if (arg.statusCode === 404 && idToRequestMap[arg.requestId]?.silentNotFound) {
                // report nothing
            } else {
                await reportError(arg.method, arg.url, arg.statusCode, arg.body);
            }

            idToRequestMap[arg.requestId].reject(new Error(`Server responded with ${arg.statusCode}`));
        }

        delete idToRequestMap[arg.requestId];
    });

    function handleSuccessfulResponse(arg: Arg) {
        if (arg.headers["Content-Type"] === "application/json" && typeof arg.body === "string") {
            arg.body = JSON.parse(arg.body);
        }

        if (!(arg.requestId in idToRequestMap)) {
            // this can happen when reload happens between firing up the request and receiving the response
            throw new Error(`Unknown requestId '${arg.requestId}'`);
        }

        idToRequestMap[arg.requestId].resolve({
            body: arg.body,
            headers: arg.headers
        });
    }
}

async function reportError(method: string, url: string, statusCode: number, response: unknown) {
    let message = response;

    if (typeof response === "string") {
        try {
            response = JSON.parse(response);
            message = (response as any).message;
        } catch (e) {}
    }

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
        const { t } = await import("./i18n.js");
        if (statusCode === 400 && (url.includes("%23") || url.includes("%2F"))) {
            toastService.showPersistent({
                id: "trafik-blocked",
                icon: "bx bx-unlink",
                title: t("server.unknown_http_error_title"),
                message: t("server.traefik_blocks_requests")
            });
        } else {
            toastService.showErrorTitleAndMessage(
                t("server.unknown_http_error_title"),
                t("server.unknown_http_error_content", { statusCode, method, url, message: messageStr }),
                15_000);
        }
        const { logError } = await import("./ws.js");
        logError(`${statusCode} ${method} ${url} - ${message}`);
    }
}

export default {
    get,
    getWithSilentNotFound,
    post,
    put,
    patch,
    remove,
    upload,
    // don't remove, used from CKEditor image upload!
    getHeaders,
    getMaxKnownEntityChangeId: () => maxKnownEntityChangeId
};
