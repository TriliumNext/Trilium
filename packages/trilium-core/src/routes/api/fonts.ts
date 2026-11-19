import { buildFontCss } from "@triliumnext/commons";
import type { Request, Response } from "../../http_interface";

import optionService from "../../services/options.js";
import sqlInit from "../../services/sql_init.js";

/**
 * The stylesheet of the user's font options. The client reads it from `/bootstrap` instead; this
 * route serves stylesheets and scripts that still link to it.
 */
function getFontCss(req: Request, res: Response) {
    res.setHeader("Content-Type", "text/css");
    res.send(sqlInit.isDbInitialized() ? buildFontCss(optionService.getOptionMap()) : "");
}

export default {
    getFontCss
};
