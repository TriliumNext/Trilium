import type { Request } from "express";
import type { Content } from "./Content.js";
import type { ParamsDictionary } from "express-serve-static-core";

/**
 * @type {function (Request): Promise<Content>}
 */
export type ContentProvider<P extends ParamsDictionary> = (req: Request<P>) => Promise<Content>;
