import { getBackup } from "@triliumnext/core";
import type { Router } from "express";

import eu from "./etapi_utils.js";

function register(router: Router) {
    eu.route<{ backupName: string }>(router, "put", "/etapi/backup/:backupName", (req, res, next) => {
        getBackup().backupNow(req.params.backupName)
            .then(() => res.sendStatus(204))
            .catch(() => res.sendStatus(500));
    });
}

export default {
    register
};
