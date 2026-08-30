import type { ScriptModuleSearchResult } from "@triliumnext/commons";

import { ValidationError } from "../../errors.js";
import request from "../request.js";
import { decodeUtf8 } from "../utils/binary.js";

export const NPM_REGISTRY_ORIGIN = "https://registry.npmjs.org";

const NOT_A_SEARCH_RESULT =
    "The package registry answered with something that is not a search result.";

/** How many packages one search asks for. */
const SEARCH_SIZE = 10;
/** A search answer is a page of summaries; anything approaching this is not one. */
const MAX_SEARCH_BYTES = 512 * 1024;

export interface SearchOptions {
    /** Where to search. Point it at a private registry to keep queries off npmjs.com. */
    origin?: string;
}

/**
 * Asks the npm registry which packages match a query.
 *
 * Every call leaves the instance and tells a third party what someone is looking for, so this is
 * reached only from an action taken on purpose — never from typing.
 */
export async function searchPackages(
    query: string,
    options: SearchOptions = {}
): Promise<ScriptModuleSearchResult[]> {
    const text = query.trim();
    if (!text) {
        throw new ValidationError("A search needs something to search for.");
    }

    const origin = (options.origin ?? NPM_REGISTRY_ORIGIN).replace(/\/+$/, "");
    const url = `${origin}/-/v1/search?text=${encodeURIComponent(text)}&size=${SEARCH_SIZE}`;

    const response = await request.fetchResource(url, {
        maxBytes: MAX_SEARCH_BYTES,
        headers: { Accept: "application/json" }
    });
    if (!response.ok) {
        throw new ValidationError(`The package registry answered HTTP ${response.status}.`);
    }

    return readSearchResults(decodeUtf8(response.bytes));
}

/**
 * Reads the registry's answer, keeping the entries that name a package and a version and dropping
 * whatever else it carries — a search answer is a third party's shape, not ours.
 */
export function readSearchResults(body: string): ScriptModuleSearchResult[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        throw new ValidationError(NOT_A_SEARCH_RESULT);
    }

    const objects = (parsed as { objects?: unknown })?.objects;
    if (!Array.isArray(objects)) {
        throw new ValidationError(NOT_A_SEARCH_RESULT);
    }

    const results: ScriptModuleSearchResult[] = [];
    for (const object of objects) {
        const entry = object as { package?: unknown } | null;
        const pkg = entry?.package as Record<string, unknown> | undefined;
        if (!pkg || typeof pkg.name !== "string" || typeof pkg.version !== "string") {
            continue;
        }

        results.push({
            name: pkg.name,
            version: pkg.version,
            ...(typeof pkg.description === "string" ? { description: pkg.description } : {})
        });
    }

    return results;
}
