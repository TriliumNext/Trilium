import type { BranchRow } from "@triliumnext/commons";
import type { Router } from "express";

import becca from "../becca/becca.js";
import BBranch from "../becca/entities/bbranch.js";
import entityChangesService from "../services/entity_changes.js";
import eu from "./etapi_utils.js";
import mappers from "./mappers.js";
import v from "./validators.js";

function register(router: Router) {
    eu.route<{ branchId: string }>(router, "get", "/etapi/branches/:branchId", (req, res, next) => {
        const branch = eu.getAndCheckBranch(req.params.branchId);

        res.json(mappers.mapBranchToPojo(branch));
    });

    const ALLOWED_PROPERTIES_FOR_CREATE_BRANCH = {
        noteId: [v.mandatory, v.notNull, v.isNoteId],
        parentNoteId: [v.mandatory, v.notNull, v.isNoteId],
        notePosition: [v.notNull, v.isInteger],
        prefix: [v.isString],
        isExpanded: [v.notNull, v.isBoolean]
    };

    eu.route(router, "post", "/etapi/branches", (req, res, next) => {
        const _params = {};
        eu.validateAndPatch(_params, req.body, ALLOWED_PROPERTIES_FOR_CREATE_BRANCH);
        const params: BranchRow = _params as BranchRow;

        const existing = becca.getBranchFromChildAndParent(params.noteId, params.parentNoteId);

        if (existing) {
            existing.notePosition = params.notePosition as number;
            existing.prefix = params.prefix as string;
            existing.isExpanded = params.isExpanded as boolean;
            existing.save();

            return res.status(200).json(mappers.mapBranchToPojo(existing));
        } 
        try {
            const branch = new BBranch(params).save();

            res.status(201).json(mappers.mapBranchToPojo(branch));
        } catch (e: any) {
            throw new eu.EtapiError(400, eu.GENERIC_CODE, e.message);
        }
        
    });

    const ALLOWED_PROPERTIES_FOR_PATCH = {
        notePosition: [v.notNull, v.isInteger],
        prefix: [v.isString],
        isExpanded: [v.notNull, v.isBoolean]
    };

    eu.route<{ branchId: string }>(router, "patch", "/etapi/branches/:branchId", (req, res, next) => {
        const branch = eu.getAndCheckBranch(req.params.branchId);

        eu.validateAndPatch(branch, req.body, ALLOWED_PROPERTIES_FOR_PATCH);
        branch.save();

        res.json(mappers.mapBranchToPojo(branch));
    });

    eu.route<{ branchId: string }>(router, "delete", "/etapi/branches/:branchId", (req, res, next) => {
        const branch = becca.getBranch(req.params.branchId);

        if (!branch) {
            return res.sendStatus(204);
        }

        branch.deleteBranch();

        res.sendStatus(204);
    });

    eu.route<{ parentNoteId: string }>(router, "post", "/etapi/refresh-note-ordering/:parentNoteId", (req, res, next) => {
        eu.getAndCheckNote(req.params.parentNoteId);

        entityChangesService.putNoteReorderingEntityChange(req.params.parentNoteId, "etapi");

        res.sendStatus(204);
    });
}

export default {
    register
};
