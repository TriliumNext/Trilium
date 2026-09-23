import type { ScriptRequest, ScriptResponse } from "@triliumnext/commons/src/lib/script_api.js";

import becca from "../becca/becca";
import type BNote from "../becca/entities/bnote";
import type { Request, Response } from "../http_interface";
import { getLog } from "../services/log";
import scriptService from "../services/script";
import { getSql } from "../services/sql/index";
import { normalizeCustomHandlerPattern, safeExtractMessageAndStackFromError } from "../services/utils/index";
import { downloadNoteInt } from "./helpers";

/**
 * The response a custom handler writes to: core's {@link Response}, which `downloadNoteInt` needs,
 * plus the {@link ScriptResponse} surface a handler script reaches through `api.res`. Express's
 * `Response` and standalone's mock response both satisfy it.
 */
export type CustomRequestResponse = Response & ScriptResponse;

/**
 * Answers a `/custom/` request from the first `customRequestHandler` or `customResourceProvider`
 * note whose pattern matches `path`, and writes a 404 when none does.
 *
 * @param path the path below `/custom/`, without a leading slash.
 * @param isScriptingEnabled reads the host's backend-scripting toggle. A request handler executes a
 *     script and is gated by it; a resource provider only serves a note's content and is not.
 * @returns what the handler script returned. A caller that cannot hold the response open past this
 *     call — standalone — awaits it to let an asynchronous handler finish writing.
 */
export function handleCustomRequest(
    path: string, req: Request, res: CustomRequestResponse, isScriptingEnabled: () => boolean
): unknown {
    const attributeIds = getSql().getColumn<string>(
        "SELECT attributeId FROM attributes WHERE isDeleted = 0 AND type = 'label' "
        + "AND name IN ('customRequestHandler', 'customResourceProvider')"
    );

    for (const attributeId of attributeIds) {
        const attr = becca.getAttribute(attributeId);

        if (!attr?.value.trim()) {
            continue;
        }

        const match = matchPath(path, attr.value, attr.attributeId);

        if (!match) {
            continue;
        }

        // Only the first matching handler runs.
        if (attr.name === "customRequestHandler") {
            return runHandler(attr.getNote(), path, match, req, res, isScriptingEnabled);
        } else if (attr.name === "customResourceProvider") {
            downloadNoteInt(attr.noteId, res);
            return;
        } else {
            throw new Error(`Unrecognized attribute name '${attr.name}'`);
        }
    }

    const message = `No handler matched for custom '${path}' request.`;

    getLog().info(message);
    res.setHeader("Content-Type", "text/plain").status(404).send(message);
}

/**
 * Matches `path` against a handler's pattern, trying both the trailing-slash and no-trailing-slash
 * forms {@link normalizeCustomHandlerPattern} produces. A pattern that is not a valid regex is
 * logged and skipped, so one bad label cannot take the whole route down.
 */
function matchPath(path: string, pattern: string, attributeId: string): RegExpMatchArray | null {
    try {
        for (const candidate of normalizeCustomHandlerPattern(pattern)) {
            const match = path.match(new RegExp(`^${candidate}$`));

            if (match) {
                return match;
            }
        }
    } catch (e: unknown) {
        const [errMessage, errStack] = safeExtractMessageAndStackFromError(e);
        getLog().error(`Testing path for label '${attributeId}', regex '${pattern}' failed with error: ${errMessage}, stack: ${errStack}`);
    }

    return null;
}

function runHandler(
    note: BNote, path: string, match: RegExpMatchArray, req: Request, res: CustomRequestResponse,
    isScriptingEnabled: () => boolean
): unknown {
    // Custom request handlers execute backend scripts, so they remain gated behind the
    // scripting toggle. Resource providers only serve static note content and are not.
    if (!isScriptingEnabled()) {
        res.status(403).send("Backend script execution is disabled on this server.");
        return;
    }

    getLog().info(`Handling custom request '${path}' with note '${note.noteId}'`);

    try {
        return scriptService.executeNote(note, {
            pathParams: match.slice(1),
            // `ScriptRequest` declares `params` flat, while Express 5 types a wildcard as
            // `string | string[]` — the same widening the server's path join works around. A
            // handler reads its path through `pathParams` rather than through `params`.
            req: req as unknown as ScriptRequest,
            res
        });
    } catch (e: unknown) {
        const [errMessage, errStack] = safeExtractMessageAndStackFromError(e);
        getLog().error(`Custom handler '${note.noteId}' failed with: ${errMessage}, ${errStack}`);
        res.setHeader("Content-Type", "text/plain").status(500).send(errMessage);
    }
}
