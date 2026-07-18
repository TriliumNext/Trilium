import type { Request, Response } from "express";

import type BNote from "../becca/entities/bnote.js";
import AbstractBeccaEntity from "../becca/entities/abstract_becca_entity.js";

export interface ApiParams {
    startNote?: BNote | null;
    originEntity?: AbstractBeccaEntity<any> | null;
    pathParams?: string[];
    req?: Request;
    res?: Response;
}
