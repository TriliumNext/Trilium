import type { AbstractBeccaEntity } from "@triliumnext/core";
import type { Request, Response } from "express";

import type BNote from "../becca/entities/bnote.js";

export interface ApiParams {
    startNote?: BNote | null;
    originEntity?: AbstractBeccaEntity<any> | null;
    pathParams?: string[];
    req?: Request;
    res?: Response;
}
