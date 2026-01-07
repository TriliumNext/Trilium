/**
 * Browser-compatible router that mimics Express routing patterns.
 * Supports path parameters (e.g., /api/notes/:noteId) and query strings.
 */

import { getContext } from "@triliumnext/core";

export interface BrowserRequest {
    method: string;
    url: string;
    path: string;
    params: Record<string, string>;
    query: Record<string, string | undefined>;
    body?: unknown;
}

export interface BrowserResponse {
    status: number;
    headers: Record<string, string>;
    body: ArrayBuffer;
}

export type RouteHandler = (req: BrowserRequest) => unknown | Promise<unknown>;

interface Route {
    method: string;
    pattern: RegExp;
    paramNames: string[];
    handler: RouteHandler;
}

const encoder = new TextEncoder();

/**
 * Convert an Express-style path pattern to a RegExp.
 * Supports :param syntax for path parameters.
 *
 * Examples:
 *   /api/notes/:noteId -> /^\/api\/notes\/([^\/]+)$/
 *   /api/notes/:noteId/revisions -> /^\/api\/notes\/([^\/]+)\/revisions$/
 */
function pathToRegex(path: string): { pattern: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];

    // Escape special regex characters except for :param patterns
    const regexPattern = path
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
        .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, paramName) => {
            paramNames.push(paramName);
            return '([^/]+)';
        });

    return {
        pattern: new RegExp(`^${regexPattern}$`),
        paramNames
    };
}

/**
 * Parse query string into an object.
 */
function parseQuery(search: string): Record<string, string | undefined> {
    const query: Record<string, string | undefined> = {};
    if (!search || search === '?') return query;

    const params = new URLSearchParams(search);
    for (const [key, value] of params) {
        query[key] = value;
    }
    return query;
}

/**
 * Convert a result to a JSON response.
 */
function jsonResponse(obj: unknown, status = 200, extraHeaders: Record<string, string> = {}): BrowserResponse {
    const body = encoder.encode(JSON.stringify(obj)).buffer as ArrayBuffer;
    return {
        status,
        headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
        body
    };
}

/**
 * Convert a string to a text response.
 */
function textResponse(text: string, status = 200, extraHeaders: Record<string, string> = {}): BrowserResponse {
    const body = encoder.encode(text).buffer as ArrayBuffer;
    return {
        status,
        headers: { "content-type": "text/plain; charset=utf-8", ...extraHeaders },
        body
    };
}

/**
 * Browser router class that handles route registration and dispatching.
 */
export class BrowserRouter {
    private routes: Route[] = [];

    /**
     * Register a route handler.
     */
    register(method: string, path: string, handler: RouteHandler): void {
        const { pattern, paramNames } = pathToRegex(path);
        this.routes.push({
            method: method.toUpperCase(),
            pattern,
            paramNames,
            handler
        });
    }

    /**
     * Convenience methods for common HTTP methods.
     */
    get(path: string, handler: RouteHandler): void {
        this.register('GET', path, handler);
    }

    post(path: string, handler: RouteHandler): void {
        this.register('POST', path, handler);
    }

    put(path: string, handler: RouteHandler): void {
        this.register('PUT', path, handler);
    }

    patch(path: string, handler: RouteHandler): void {
        this.register('PATCH', path, handler);
    }

    delete(path: string, handler: RouteHandler): void {
        this.register('DELETE', path, handler);
    }

    /**
     * Dispatch a request to the appropriate handler.
     */
    async dispatch(method: string, urlString: string, body?: unknown, headers?: Record<string, string>): Promise<BrowserResponse> {
        const url = new URL(urlString);
        const path = url.pathname;
        const query = parseQuery(url.search);
        const upperMethod = method.toUpperCase();

        // Parse JSON body if it's an ArrayBuffer and content-type suggests JSON
        let parsedBody = body;
        if (body instanceof ArrayBuffer && headers) {
            const contentType = headers['content-type'] || headers['Content-Type'] || '';
            if (contentType.includes('application/json')) {
                try {
                    const text = new TextDecoder().decode(body);
                    if (text.trim()) {
                        parsedBody = JSON.parse(text);
                    }
                } catch (e) {
                    console.warn('[Router] Failed to parse JSON body:', e);
                    // Keep original body if JSON parsing fails
                    parsedBody = body;
                }
            }
        }
        // Find matching route
        for (const route of this.routes) {
            if (route.method !== upperMethod) continue;

            const match = path.match(route.pattern);
            if (!match) continue;

            // Extract path parameters
            const params: Record<string, string> = {};
            for (let i = 0; i < route.paramNames.length; i++) {
                params[route.paramNames[i]] = decodeURIComponent(match[i + 1]);
            }

            const request: BrowserRequest = {
                method: upperMethod,
                url: urlString,
                path,
                params,
                query,
                body: parsedBody
            };

            try {
                const result = await getContext().init(async () => await route.handler(request));
                return this.formatResult(result);
            } catch (error) {
                return this.formatError(error);
            }
        }

        // No route matched
        return textResponse(`Not found: ${method} ${path}`, 404);
    }

    /**
     * Format a handler result into a response.
     * Follows the same patterns as the server's apiResultHandler.
     */
    private formatResult(result: unknown): BrowserResponse {
        // Handle [statusCode, response] format
        if (Array.isArray(result) && result.length > 0 && Number.isInteger(result[0])) {
            const [statusCode, response] = result;
            return jsonResponse(response, statusCode);
        }

        // Handle undefined (no content) - 204 should have no body
        if (result === undefined) {
            return {
                status: 204,
                headers: {}
            };
        }

        // Default: JSON response with 200
        return jsonResponse(result, 200);
    }

    /**
     * Format an error into a response.
     */
    private formatError(error: unknown): BrowserResponse {
        console.error('[Router] Handler error:', error);

        // Check for known error types
        if (error && typeof error === 'object') {
            const err = error as { constructor?: { name?: string }; message?: string };

            if (err.constructor?.name === 'NotFoundError') {
                return jsonResponse({ message: err.message || 'Not found' }, 404);
            }

            if (err.constructor?.name === 'ValidationError') {
                return jsonResponse({ message: err.message || 'Validation error' }, 400);
            }
        }

        // Generic error
        const message = error instanceof Error ? error.message : String(error);
        return jsonResponse({ message }, 500);
    }
}

/**
 * Create a new router instance.
 */
export function createRouter(): BrowserRouter {
    return new BrowserRouter();
}
