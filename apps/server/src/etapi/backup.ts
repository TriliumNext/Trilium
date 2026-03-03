import type { Router } from "express";

import backupService from "../services/backup.js";
import eu from "./etapi_utils.js";

function register(router: Router) {
    eu.route<{ backupName: string }>(router, "put", "/etapi/backup/:backupName", (req, res, next) => {
        backupService.backupNow(req.params.backupName)
            .then(() => res.sendStatus(204))
            .catch(() => res.sendStatus(500));
    });
}

export default {
    register
};
