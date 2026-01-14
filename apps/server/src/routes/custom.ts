import type { Request, Response, Router } from "express";

import becca from "../becca/becca.js";
import { namespace } from "../cls_provider.js";
import cls from "../services/cls.js";
import log from "../services/log.js";
import scriptService from "../services/script.js";
import sql from "../services/sql.js";
import { normalizeCustomHandlerPattern,safeExtractMessageAndStackFromError } from "../services/utils.js";
import fileService from "./api/files.js";

function handleRequest(req: Request, res: Response) {

    // handle path from "*path" route wildcard
    // in express v4, you could just add
    // req.params.path + req.params[0], but with v5
    // we get a split array that we have to join ourselves again

    // @TriliumNextTODO: remove typecasting once express types are fixed
    // they currently only treat req.params as string, while in reality
    // it can also be a string[], when using wildcards
    const splitPath = req.params.path as unknown as string[];

    //const path = splitPath.map(segment => encodeURIComponent(segment)).join("/")
    // naively join the "decoded" paths using a slash
    // this is to mimick handleRequest behaviour
    // as with the previous express v4.
    // @TriliumNextTODO: using something like =>
    // splitPath.map(segment => encodeURIComponent(segment)).join("/")
    // might be safer

    const path = splitPath.join("/");

    const attributeIds = sql.getColumn<string>("SELECT attributeId FROM attributes WHERE isDeleted = 0 AND type = 'label' AND name IN ('customRequestHandler', 'customResourceProvider')");

    const attrs = attributeIds.map((attrId) => becca.getAttribute(attrId));

    for (const attr of attrs) {
        if (!attr?.value.trim()) {
            continue;
        }

        // Get normalized patterns to handle both trailing slash cases
        const patterns = normalizeCustomHandlerPattern(attr.value);
        let match: RegExpMatchArray | null = null;

        try {
            // Try each pattern until we find a match
            for (const pattern of patterns) {
                const regex = new RegExp(`^${pattern}$`);
                match = path.match(regex);
                if (match) {
                    break; // Found a match, exit pattern loop
                }
            }
        } catch (e: unknown) {
            const [errMessage, errStack] = safeExtractMessageAndStackFromError(e);
            log.error(`Testing path for label '${attr.attributeId}', regex '${attr.value}' failed with error: ${errMessage}, stack: ${errStack}`);
            continue;
        }

        if (!match) {
            continue;
        }

        if (attr.name === "customRequestHandler") {
            const note = attr.getNote();

            log.info(`Handling custom request '${path}' with note '${note.noteId}'`);

            try {
                scriptService.executeNote(note, {
                    pathParams: match.slice(1),
                    req,
                    res
                });
            } catch (e: unknown) {
                const [errMessage, errStack] = safeExtractMessageAndStackFromError(e);
                log.error(`Custom handler '${note.noteId}' failed with: ${errMessage}, ${errStack}`);
                res.setHeader("Content-Type", "text/plain").status(500).send(errMessage);
            }
        } else if (attr.name === "customResourceProvider") {
            fileService.downloadNoteInt(attr.noteId, res);
        } else {
            throw new Error(`Unrecognized attribute name '${attr.name}'`);
        }

        return; // only the first handler is executed
    }

    const message = `No handler matched for custom '${path}' request.`;

    log.info(message);
    res.setHeader("Content-Type", "text/plain").status(404).send(message);
}

function register(router: Router) {
    // explicitly no CSRF middleware since it's meant to allow integration from external services

    router.all("/custom/*path", (req: Request, res: Response, _next) => {
        namespace.bindEmitter(req);
        namespace.bindEmitter(res);

        cls.init(() => handleRequest(req, res));
    });
}

export default {
    register
};
