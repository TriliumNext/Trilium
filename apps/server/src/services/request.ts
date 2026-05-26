"use strict";

import type { ExecOpts, RequestProvider } from "@triliumnext/core";
import { isElectron } from "./utils.js";
import log from "./log.js";
import url from "url";
import syncOptions from "./sync_options.js";

// this service provides abstraction over node's HTTP/HTTPS and electron net.client APIs
// this allows supporting system proxy

interface ClientOpts {
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

interface Request {
    on(event: RequestEvent, cb: (e: any) => void): void;
    end(payload?: string): void;
}

interface Client {
    request(opts: ClientOpts): Request;
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

async function getClient(opts: ClientOpts): Promise<Client> {
    // it's not clear how to explicitly configure proxy (as opposed to system proxy),
    // so in that case, we always use node's modules
    if (isElectron && !opts.proxy) {
        return (await import("electron")).net as unknown as Client;
    } else {
        const { protocol } = url.parse(opts.url);

        if (protocol === "http:" || protocol === "https:") {
            return await import(protocol.substr(0, protocol.length - 1));
        } else {
            throw new Error(`Unrecognized protocol '${protocol}'`);
        }
    }
}

export default class NodeRequestProvider implements RequestProvider {

    async exec<T>(opts: ExecOpts): Promise<T> {
        const client = getClient(opts);

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

        return new Promise(async (resolve, reject) => {
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

                const request = (await client).request({
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
                    if (opts.cookieJar && response.headers["set-cookie"]) {
                        opts.cookieJar.header = response.headers["set-cookie"];
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
                                log.error(`Failed to deserialize sync response: ${responseStr}`);

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

        const client = await getClient(opts);
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
