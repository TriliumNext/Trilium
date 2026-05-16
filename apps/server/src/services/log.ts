import { getLog } from "@triliumnext/core";
import type { Request, Response } from "express";
import ServerLogService from "../log_provider.js";

function getServerLog(): ServerLogService | undefined {
    const log = getLog();
    return log instanceof ServerLogService ? log : undefined;
}

function info(message: string | Error) {
    getLog().info(message);
}

function error(message: string | Error | unknown) {
    getLog().error(message);
}

function request(req: Request, res: Response, timeMs: number, responseLength: number | string = "?") {
    getServerLog()?.request(req, res, timeMs, responseLength);
}

export default {
    info,
    error,
    request
};
