/**
 * Minimal Microsoft Graph client for the OneNote importer. Only the read endpoints needed to
 * enumerate the notebook tree and pull page content are implemented.
 *
 * Graph reference: https://learn.microsoft.com/en-us/graph/api/resources/onenote-api-overview
 */

import type { OneNoteNotebook, OneNoteSection, OneNoteSectionGroup } from "@triliumnext/commons";
import { getLog } from "@triliumnext/core";

import { safeFetch } from "../../safe_fetch.js";
import { extractPageId } from "./links.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/**
 * Supplies a currently-valid access token, refreshing it as needed. The importer passes one of these
 * rather than a fixed string so a long or heavily-throttled import — which outlives a single Graph
 * token — keeps authenticating instead of 401ing once the token captured up front expires. It is
 * re-read before every request attempt (see {@link graphFetch}), including after a throttle wait.
 */
export type AccessTokenProvider = () => Promise<string>;

// safeFetch's default 5s timeout is too tight for the importer: page content and binary resources can
// be large and slow. Allow a generous per-request budget instead.
const GRAPH_TIMEOUT_MS = 60_000;

// Graph throttles aggressively under load (HTTP 429, occasionally 503). When the response carries a
// Retry-After header that wait is used verbatim — but OneNote's 429s usually omit it
// (https://learn.microsoft.com/en-us/graph/throttling), so retries mostly fall back to exponential
// backoff. A request only gives up once it has spent MAX_THROTTLE_WAIT_MS waiting out throttles: a
// fixed retry count proved too small for huge imports. Microsoft publishes no hard OneNote limits —
// throttling is per app+user and time-based ("simply waiting will eventually reset the limit"), and
// a heavily-throttled user can stay throttled for the better part of an hour, so the budget must
// cover that; one page giving up aborts the whole import.
const BASE_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 60_000;
const MAX_THROTTLE_WAIT_MS = 60 * 60_000;

// A 504 means the OneNote backend behind the Graph gateway timed out producing this one response.
// Usually transient (Microsoft's own SDK retry handlers treat 504 like 429/503), but a permanent
// per-resource variant is well documented — some pages/sections 504 on every fetch — so unlike
// throttling these retries are bounded by a small attempt count, not the hour-long wait budget: a
// poisoned page must fail within minutes instead of stalling the import for an hour.
const MAX_GATEWAY_TIMEOUT_RETRIES = 5;

// Shared throttle gate. Graph throttles per app/tenant, so a 429 on one request means every other
// in-flight and subsequent request is being throttled too. Rather than each request independently
// retrying — which just keeps hammering Graph and prolongs the throttle — a 429 pushes back a shared
// "don't send until" timestamp that ALL requests wait on, so the whole pool backs off together.
let throttledUntilMs = 0;

// Aggregate throttle statistics for the current import, surfaced in the import report (they answer
// "why did this take hours?"). `requestCount` counts throttled (429/503) responses; `waitMs`
// accumulates net extensions of the shared gate — wall-clock time spent waiting out throttles —
// rather than a per-request sum, since concurrent requests wait on the same gate window.
let throttledRequestCount = 0;
let throttleWaitMs = 0;

/**
 * Fetches a Microsoft Graph URL through {@link safeFetch} so the request is hardened against SSRF —
 * pagination (`@odata.nextLink`) and resource URLs come from Graph responses and page HTML, so they
 * must not be trusted to point at the public Graph host. The bearer token is sent on every hop.
 *
 * Retries on throttling (429/503) via the shared {@link throttledUntilMs} gate, so concurrent
 * requests pause together instead of dog-piling the throttle. Gives up only once this request has
 * spent {@link MAX_THROTTLE_WAIT_MS} waiting, returning the throttled response for the caller to
 * report as an error.
 *
 * Also retries gateway timeouts (504), but privately: the backoff is slept here rather than pushed
 * onto the shared gate — a 504 is specific to the resource being fetched, not the app+user pool —
 * and gives up after {@link MAX_GATEWAY_TIMEOUT_RETRIES} attempts rather than drawing on the
 * hour-long throttle budget.
 */
async function graphFetch(getAccessToken: AccessTokenProvider, url: string): Promise<Response> {
    const giveUpAtMs = Date.now() + MAX_THROTTLE_WAIT_MS;
    let throttleAttempt = 0;
    let gatewayTimeoutRetry = 0;
    for (;;) {
        const gateWaitMs = throttledUntilMs - Date.now();
        if (gateWaitMs > 0) {
            await delay(gateWaitMs);
        }

        // Resolved after the gate wait, per attempt: a token captured before an hour of throttling
        // would already be expired by the time the request finally goes out. The provider hands back
        // the cached token while it is valid and refreshes only as expiry nears.
        const accessToken = await getAccessToken();
        const response = await safeFetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS)
        });

        if (response.status === 504) {
            if (gatewayTimeoutRetry >= MAX_GATEWAY_TIMEOUT_RETRIES) {
                return response;
            }
            const waitMs = backoffDelayMs(gatewayTimeoutRetry);
            gatewayTimeoutRetry++;

            // Drain the failed response so its connection is released before we back off.
            await response.body?.cancel();
            getLog().info(`OneNote import: Graph gateway timeout (HTTP 504) on ${sanitizeGraphUrl(url)}; retry ${gatewayTimeoutRetry}/${MAX_GATEWAY_TIMEOUT_RETRIES} after ${waitMs}ms`);
            await delay(waitMs);
            continue;
        }

        if (response.status !== 429 && response.status !== 503) {
            return response;
        }

        // Graph's Retry-After, when present, states exactly how long the throttle lasts — trust it
        // over the computed backoff.
        const waitMs = retryAfterMs(response.headers.get("retry-after")) ?? backoffDelayMs(throttleAttempt);
        if (Date.now() + waitMs > giveUpAtMs) {
            return response;
        }

        // Drain the throttled response so its connection is released before we back off.
        await response.body?.cancel();

        // Extend the shared gate (Math.max: simultaneous 429s converge on one window rather than
        // stacking). The wait itself happens at the top of the next iteration, shared across the pool.
        throttledRequestCount++;
        throttleWaitMs += Math.max(0, Date.now() + waitMs - Math.max(throttledUntilMs, Date.now()));
        throttledUntilMs = Math.max(throttledUntilMs, Date.now() + waitMs);
        throttleAttempt++;
        getLog().info(`OneNote import: Graph throttled (HTTP ${response.status}) on ${sanitizeGraphUrl(url)}; retry ${throttleAttempt} after ${waitMs}ms (${Math.round((giveUpAtMs - Date.now()) / 60_000)}min of wait budget left)`);
    }
}

/** Exponential backoff before a throttling retry, capped at {@link MAX_RETRY_DELAY_MS}. */
export function backoffDelayMs(attempt: number): number {
    return Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

/**
 * Parses a Retry-After header (delta-seconds or HTTP-date) into a wait in milliseconds, or null when
 * the header is absent or unparseable.
 */
export function retryAfterMs(header: string | null): number | null {
    const trimmed = header?.trim();
    if (!trimmed) {
        return null;
    }
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds)) {
        return Math.max(0, seconds * 1000);
    }
    const dateMs = Date.parse(trimmed);
    return Number.isNaN(dateMs) ? null : Math.max(0, dateMs - Date.now());
}

/** Resets the shared throttle gate; exported for tests only. */
export function resetThrottleGate(): void {
    throttledUntilMs = 0;
}

/** Returns the throttle statistics accumulated since the last {@link resetThrottleStats}. */
export function getThrottleStats(): { requestCount: number; waitMs: number } {
    return { requestCount: throttledRequestCount, waitMs: throttleWaitMs };
}

/** Resets the throttle statistics; called at the start of an import so its report covers only itself. */
export function resetThrottleStats(): void {
    throttledRequestCount = 0;
    throttleWaitMs = 0;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GraphAccount {
    name: string;
    email: string;
}

export interface OneNotePage {
    id: string;
    title: string;
    createdDateTime?: string;
    lastModifiedDateTime?: string;
    /** OneNote's indentation level in the page list: 0 for a top-level page, 1+ for a subpage. */
    level: number;
    /** The page-id GUID OneNote uses in `onenote:` links to this page; used to resolve cross-page links. */
    pageId?: string;
}

export async function getAccount(getAccessToken: AccessTokenProvider): Promise<GraphAccount> {
    const me = await graphGet<{ displayName?: string; mail?: string; userPrincipalName?: string }>(getAccessToken, "/me");
    return {
        name: me.displayName ?? me.userPrincipalName ?? "Unknown",
        email: me.mail ?? me.userPrincipalName ?? ""
    };
}

/**
 * Returns the notebooks with their direct sections and a tree of section groups — each group carrying
 * its own sections and nested groups — mirroring the OneNote structure so the importer can recreate it
 * as nested folders.
 *
 * The initial call expands each notebook's sections and whether it has any section groups, so the
 * common case (no section groups) is a single round-trip. Only notebooks/groups that actually contain
 * section groups follow their `sectionGroupsUrl`, and those follow-up requests run in parallel —
 * section groups nest arbitrarily and the notebooks endpoint won't $expand them more than one level.
 */
export async function listNotebooks(getAccessToken: AccessTokenProvider): Promise<OneNoteNotebook[]> {
    const url = "/me/onenote/notebooks?$select=id,displayName,createdDateTime,lastModifiedDateTime,sectionGroupsUrl&$expand=sections($select=id,displayName,createdDateTime,lastModifiedDateTime),sectionGroups($select=id)&$orderby=displayName";
    const notebooks = await graphGetAll<RawNotebook>(getAccessToken, url);

    return Promise.all(
        notebooks.map(async (notebook) => ({
            id: notebook.id,
            title: notebook.displayName,
            createdDateTime: notebook.createdDateTime,
            lastModifiedDateTime: notebook.lastModifiedDateTime,
            sections: mapSections(notebook.sections),
            sectionGroups: notebook.sectionGroups?.length && notebook.sectionGroupsUrl ? await fetchSectionGroups(getAccessToken, notebook.sectionGroupsUrl) : []
        }))
    );
}

/**
 * Fetches the section groups under `sectionGroupsUrl` (a notebook's or section group's link) as a tree,
 * each group carrying its own sections and nested groups. Sibling groups are fetched in parallel, and a
 * further round-trip happens only for groups that actually have nested groups.
 */
async function fetchSectionGroups(getAccessToken: AccessTokenProvider, sectionGroupsUrl: string): Promise<OneNoteSectionGroup[]> {
    const url = appendQuery(sectionGroupsUrl, "$select=id,displayName,createdDateTime,lastModifiedDateTime,sectionGroupsUrl&$expand=sections($select=id,displayName,createdDateTime,lastModifiedDateTime),sectionGroups($select=id)");
    const groups = await graphGetAll<RawSectionGroup>(getAccessToken, url);

    return Promise.all(
        groups.map(async (group) => ({
            id: group.id,
            title: group.displayName,
            createdDateTime: group.createdDateTime,
            lastModifiedDateTime: group.lastModifiedDateTime,
            sections: mapSections(group.sections),
            sectionGroups: group.sectionGroups?.length && group.sectionGroupsUrl ? await fetchSectionGroups(getAccessToken, group.sectionGroupsUrl) : []
        }))
    );
}

function mapSections(raw: RawSection[] | undefined): OneNoteSection[] {
    return (raw ?? []).map((s) => ({ id: s.id, title: s.displayName, createdDateTime: s.createdDateTime, lastModifiedDateTime: s.lastModifiedDateTime }));
}

function appendQuery(url: string, query: string): string {
    return url.includes("?") ? `${url}&${query}` : `${url}?${query}`;
}

export async function listPages(getAccessToken: AccessTokenProvider, sectionId: string): Promise<OneNotePage[]> {
    // `links` carries the page's own `onenote:` client URL, from which we recover the page-id GUID that
    // cross-page links reference (see links.ts).
    const url = `/me/onenote/sections/${sectionId}/pages?$select=id,title,createdDateTime,lastModifiedDateTime,level,links&$orderby=order&pagelevel=true`;
    const raw = await graphGetAll<RawPage>(getAccessToken, url);
    return raw.map((p) => ({
        id: p.id,
        title: p.title || "Untitled",
        createdDateTime: p.createdDateTime,
        lastModifiedDateTime: p.lastModifiedDateTime,
        level: p.level ?? 0,
        pageId: extractPageId(p.links?.oneNoteClientUrl?.href) ?? undefined
    }));
}

/**
 * Returns a page's content, split into its HTML body and (optional) InkML.
 *
 * We request `includeInkML=true` so handwriting/drawings — which the default HTML output drops,
 * leaving only `<!-- InkNode is not supported -->` comments — come back as a separate InkML part. With
 * that flag the response is a MIME multipart envelope (one `text/html` part, one
 * `application/inkml+xml` part), which parsePageContent splits apart. Pages without ink may still come
 * back as plain HTML, which the parser handles by returning the whole body as `html`.
 */
export async function getPageContent(getAccessToken: AccessTokenProvider, pageId: string): Promise<{ html: string; inkml: string }> {
    const url = `${GRAPH_BASE}/me/onenote/pages/${pageId}/content?includeInkML=true`;
    const response = await graphFetch(getAccessToken, url);
    if (!response.ok) {
        throw await graphRequestError("Failed to fetch OneNote page content", url, response);
    }
    return parsePageContent(await response.text());
}

/**
 * Splits a OneNote page response into its HTML and InkML parts. A page fetched with
 * `includeInkML=true` comes back as a MIME multipart body whose first line is the boundary; each part
 * carries header lines (including `Content-Type`), then a blank line, then the body. A non-multipart
 * response (no leading `--` boundary) is returned verbatim as the HTML part.
 */
export function parsePageContent(raw: string): { html: string; inkml: string } {
    const normalized = raw.replace(/\r\n/g, "\n");
    const boundary = normalized.slice(0, normalized.indexOf("\n")).trim();
    if (!boundary.startsWith("--")) {
        return { html: raw.trim(), inkml: "" };
    }

    let html = "";
    let inkml = "";
    for (const part of normalized.split(boundary)) {
        const separator = part.indexOf("\n\n");
        if (separator < 0) {
            continue;
        }
        const headers = part.slice(0, separator).toLowerCase();
        const body = part.slice(separator + 2).trim();
        if (headers.includes("text/html")) {
            html = body;
        } else if (headers.includes("application/inkml+xml")) {
            inkml = body;
        }
    }
    return { html, inkml };
}

/**
 * Downloads a binary resource (image or file attachment) referenced from page HTML. The URL is an
 * absolute Graph `…/resources/{id}/$value` link, so it is fetched directly rather than relative to the
 * API base. Returns the raw bytes plus the server-reported content type.
 */
export async function getResource(getAccessToken: AccessTokenProvider, url: string): Promise<{ content: Uint8Array; contentType: string }> {
    const response = await graphFetch(getAccessToken, url);
    if (!response.ok) {
        throw await graphRequestError("Failed to fetch OneNote resource", url, response);
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    getLog().info(`OneNote import: downloaded resource (${contentType}, ${buffer.length} bytes) from ${sanitizeGraphUrl(url)}`);
    return { content: buffer, contentType };
}

interface RawSection {
    id: string;
    displayName: string;
    createdDateTime?: string;
    lastModifiedDateTime?: string;
}

interface RawNotebook {
    id: string;
    displayName: string;
    createdDateTime?: string;
    lastModifiedDateTime?: string;
    sectionGroupsUrl?: string;
    sections?: RawSection[];
    /** id-only, requested just to detect whether the notebook has section groups to follow. */
    sectionGroups?: { id: string }[];
}

interface RawSectionGroup {
    id: string;
    displayName: string;
    createdDateTime?: string;
    lastModifiedDateTime?: string;
    sectionGroupsUrl?: string;
    sections?: RawSection[];
    /** id-only, requested just to detect whether the group has nested section groups to follow. */
    sectionGroups?: { id: string }[];
}

interface RawPage {
    id: string;
    title?: string;
    createdDateTime?: string;
    lastModifiedDateTime?: string;
    level?: number;
    links?: { oneNoteClientUrl?: { href?: string } };
}

async function graphGet<T>(getAccessToken: AccessTokenProvider, path: string): Promise<T> {
    const url = `${GRAPH_BASE}${path}`;
    const response = await graphFetch(getAccessToken, url);
    if (!response.ok) {
        throw await graphRequestError("Microsoft Graph request failed", url, response);
    }
    return response.json() as Promise<T>;
}

/** GETs a Graph collection endpoint, following @odata.nextLink pagination. */
async function graphGetAll<T>(getAccessToken: AccessTokenProvider, pathOrUrl: string): Promise<T[]> {
    const results: T[] = [];
    let next: string | null = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl}`;

    while (next) {
        const response: Response = await graphFetch(getAccessToken, next);
        if (!response.ok) {
            // `next` rather than `pathOrUrl`: on a paginated collection the failing request may be a
            // follow-up @odata.nextLink, not the original URL.
            throw await graphRequestError("Microsoft Graph request failed", next, response);
        }
        const json = (await response.json()) as { value?: T[]; "@odata.nextLink"?: string };
        results.push(...(json.value ?? []));
        next = json["@odata.nextLink"] ?? null;
    }

    return results;
}

/**
 * Builds the error for a failed Graph request. A bare HTTP status is not actionable when an import of
 * thousands of pages fails on one of them, so the message carries the request URL plus whatever error
 * code/message Graph itself returned in the response body.
 */
async function graphRequestError(summary: string, url: string, response: Response): Promise<Error> {
    let body = "";
    try {
        body = await response.text();
    } catch {
        // The status and URL are still worth reporting when the body cannot be read.
    }
    const detail = extractGraphErrorDetail(body);
    return new Error(`${summary} (HTTP ${response.status}${detail ? `: ${detail}` : ""}) from ${sanitizeGraphUrl(url)}`);
}

/**
 * Redacts personal data from a Graph URL before it is logged or embedded in an error message. OneNote
 * resource URLs (taken from page HTML) address the mailbox by the signed-in user's email — e.g.
 * `…/users('jane@example.com')/onenote/resources/…` — so the raw URL is PII. The email (or user id) in
 * the `users('…')` / `users/{id}` segment is replaced with a placeholder; the rest of the path, which
 * is what makes the log line useful for debugging, is kept. The importer's own calls use the `/me`
 * alias and pass through unchanged.
 */
export function sanitizeGraphUrl(url: string): string {
    return url
        .replace(/users\('[^']*'\)/gi, "users('<redacted>')")
        .replace(/users\/[^/?#]+/gi, "users/<redacted>");
}

/**
 * Extracts "code: message" from Graph's standard JSON error envelope
 * (`{"error": {"code": "...", "message": "..."}}`), or "" when the body is not one.
 */
export function extractGraphErrorDetail(body: string): string {
    try {
        const parsed = JSON.parse(body) as { error?: { code?: string; message?: string } };
        return [parsed?.error?.code, parsed?.error?.message].filter(Boolean).join(": ");
    } catch {
        return "";
    }
}

export default {
    getAccount,
    listNotebooks,
    listPages,
    getPageContent,
    getResource,
    getThrottleStats,
    resetThrottleStats
};
