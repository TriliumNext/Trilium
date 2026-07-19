"use strict";

import { type CookieJar, type ExecOpts, getLog, type RequestProvider, sync_options as syncOptions } from "@triliumnext/core";
import url from "url";

// this service provides abstraction over node's HTTP/HTTPS modules.
// Subclasses (e.g. apps/desktop's ElectronRequestProvider) can override
// `getClient` to plug in alternative transports such as `electron.net`
// (which honours the system proxy).

export interface ClientOpts {
    method: string;
    url: string;
    protocol?: string | null;
    host?: string | null;
    port?: string | null;
    path?: string | null;
    timeout?: number;
    headers?: Record<string, string | number>;
    agent?: any;
    proxy?: string | null;
}

type RequestEvent = "error" | "response" | "abort";

interface NetRequest {
    on(event: RequestEvent, cb: (e: any) => void): void;
    end(payload?: string): void;
}

export interface Client {
    request(opts: ClientOpts): NetRequest;
}

const HTTP = "http:",
    HTTPS = "https:";

function generateError(
    opts: {
        method: string;
        url: string;
    },
    message: string
) {
    return new Error(`Request to ${opts.method} ${opts.url} failed, error: ${message}`);
}

async function getProxyAgent(opts: ClientOpts) {
    if (!opts.proxy) {
        return null;
    }

    const { protocol } = url.parse(opts.url);

    if (!protocol || ![HTTP, HTTPS].includes(protocol)) {
        return null;
    }

    const AgentClass = HTTP === protocol ? (await import("http-proxy-agent")).HttpProxyAgent : (await import("https-proxy-agent")).HttpsProxyAgent;

    return new AgentClass(opts.proxy);
}

export default class NodeRequestProvider implements RequestProvider {

    /**
     * Resolves the HTTP client for a given request. The default implementation
     * picks Node's `http` or `https` module based on the URL scheme. Subclasses
     * may override to provide a transport that supports system proxy etc.
     */
    protected async getClient(opts: ClientOpts): Promise<Client> {
        const { protocol } = url.parse(opts.url);

        if (protocol === "http:" || protocol === "https:") {
            return await import(protocol.substr(0, protocol.length - 1));
        } else {
            throw new Error(`Unrecognized protocol '${protocol}'`);
        }
    }

    async exec<T>(opts: ExecOpts): Promise<T> {
        const client = this.getClient(opts);

        // hack for cases where electron.net does not work, but we don't want to set proxy
        if (opts.proxy === "noproxy") {
            opts.proxy = null;
        }

        const paging = opts.paging || {
            pageCount: 1,
            pageIndex: 0,
            requestId: "n/a"
        };

        const proxyAgent = await getProxyAgent(opts);
        const parsedTargetUrl = url.parse(opts.url);
        const resolvedClient = await client;

        return new Promise((resolve, reject) => {
            try {
                const headers: Record<string, string | number> = {
                    Cookie: (opts.cookieJar && opts.cookieJar.header) || "",
                    "Content-Type": paging.pageCount === 1 ? "application/json" : "text/plain",
                    pageCount: paging.pageCount,
                    pageIndex: paging.pageIndex,
                    requestId: paging.requestId
                };

                if (opts.auth) {
                    headers["trilium-cred"] = Buffer.from(`dummy:${opts.auth.password}`).toString("base64");
                }

                const request = resolvedClient.request({
                    method: opts.method,
                    // url is used by electron net module
                    url: opts.url,
                    // 4 fields below are used by http and https node modules
                    protocol: parsedTargetUrl.protocol,
                    host: parsedTargetUrl.hostname,
                    port: parsedTargetUrl.port,
                    path: parsedTargetUrl.path,
                    timeout: opts.timeout, // works only for node.js client
                    headers,
                    agent: proxyAgent
                });

                request.on("error", (err) => reject(generateError(opts, err)));

                request.on("response", (response) => {
                    // Once headers arrive, `electron.net` reports a mid-body failure by
                    // destroying the response stream rather than the request. An "error"
                    // event with no listener is rethrown by Node and crashes the Electron
                    // main process, so this listener is load-bearing, not defensive.
                    response.on("error", (err: unknown) => reject(generateError(opts, String(err))));

                    if (opts.cookieJar && response.headers["set-cookie"]) {
                        absorbSetCookies(opts.cookieJar, response.headers["set-cookie"]);
                    }

                    let responseStr = "";
                    let chunks: Buffer[] = [];

                    response.on("data", (chunk: Buffer) => chunks.push(chunk));

                    response.on("end", () => {
                        // use Buffer instead of string concatenation to avoid implicit decoding for each chunk
                        // decode the entire data chunks explicitly as utf-8
                        responseStr = Buffer.concat(chunks).toString("utf-8");

                        if ([200, 201, 204].includes(response.statusCode)) {
                            try {
                                const jsonObj = responseStr.trim() ? JSON.parse(responseStr) : null;

                                resolve(jsonObj);
                            } catch (e: any) {
                                getLog().error(`Failed to deserialize sync response: ${responseStr}`);

                                reject(generateError(opts, e.message));
                            }
                        } else {
                            let errorMessage;

                            try {
                                const jsonObj = JSON.parse(responseStr);

                                errorMessage = jsonObj?.message || "";
                            } catch (e: any) {
                                errorMessage = responseStr.substr(0, Math.min(responseStr.length, 100));
                            }

                            reject(generateError(opts, `${response.statusCode} ${response.statusMessage} ${errorMessage}`));
                        }
                    });
                });

                let payload;

                if (opts.body) {
                    payload = typeof opts.body === "object" ? JSON.stringify(opts.body) : opts.body;
                }

                request.end(payload as string);
            } catch (e: any) {
                reject(generateError(opts, e.message));
            }
        });
    }

    async getImage(imageUrl: string): Promise<ArrayBuffer> {
        const proxyConf = syncOptions.getSyncProxy();
        const opts: ClientOpts = {
            method: "GET",
            url: imageUrl,
            proxy: proxyConf !== "noproxy" ? proxyConf : null
        };

        const client = await this.getClient(opts);
        const proxyAgent = await getProxyAgent(opts);
        const parsedTargetUrl = url.parse(opts.url);

        return new Promise<ArrayBuffer>((resolve, reject) => {
            try {
                const request = client.request({
                    method: opts.method,
                    // url is used by electron net module
                    url: opts.url,
                    // 4 fields below are used by http and https node modules
                    protocol: parsedTargetUrl.protocol,
                    host: parsedTargetUrl.hostname,
                    port: parsedTargetUrl.port,
                    path: parsedTargetUrl.path,
                    timeout: opts.timeout, // works only for the node client
                    headers: {},
                    agent: proxyAgent
                });

                request.on("error", (err) => reject(generateError(opts, err)));

                request.on("abort", (err) => reject(generateError(opts, err)));

                request.on("response", (response) => {
                    // See the equivalent listener in `exec`: without it, a connection
                    // reset after headers crashes the Electron main process.
                    response.on("error", (err: unknown) => reject(generateError(opts, String(err))));

                    if (![200, 201, 204].includes(response.statusCode)) {
                        reject(generateError(opts, `${response.statusCode} ${response.statusMessage}`));
                    }

                    const chunks: Buffer[] = [];

                    response.on("data", (chunk: Buffer) => chunks.push(chunk));
                    response.on("end", () => {
                        const buf = Buffer.concat(chunks);
                        resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
                    });
                });

                request.end(undefined);
            } catch (e: any) {
                reject(generateError(opts, e.message));
            }
        });
    }
}

/**
 * Merges the cookies from a response's Set-Cookie header(s) into the jar, storing a
 * single "name=value; name=value" string.
 *
 * The naive alternative — replaying the raw Set-Cookie value(s) as the next Cookie
 * header — breaks in two ways (#10548):
 *
 * - `electron.net` serializes an array header value via `Array.prototype.toString()`,
 *   i.e. a bare-comma join. With more than one Set-Cookie in a response (a reverse
 *   proxy's affinity cookie next to `trilium.sid`), the merged header glues
 *   "…HttpOnly,trilium.sid=…" into a junk cookie name and the sync server loses the
 *   session ("Logged in session not found"). Node's `http` special-cases cookie arrays
 *   with a "; " join, which is why server↔server sync never exposed this.
 * - Wholesale replacement drops cookies a later response didn't re-set.
 *
 * Cookie attributes (Path, Expires, HttpOnly, …) are stripped — clients must not echo
 * them back, and the sync jar only lives for one sync cycle anyway.
 */
export function absorbSetCookies(cookieJar: CookieJar, setCookieValues: string | string[]) {
    const cookies = new Map<string, string>();

    const addPair = (pair: string) => {
        const eqIndex = pair.indexOf("=");
        if (eqIndex > 0) {
            cookies.set(pair.slice(0, eqIndex).trim(), pair.slice(eqIndex + 1).trim());
        }
    };

    for (const pair of (cookieJar.header ?? "").split(";")) {
        addPair(pair);
    }

    for (const setCookie of Array.isArray(setCookieValues) ? setCookieValues : [setCookieValues]) {
        // Only the leading name=value matters; the rest are attributes.
        addPair(setCookie.split(";")[0]);
    }

    cookieJar.header = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}
