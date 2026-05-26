"use strict";

import { getLog } from "../../services/log.js";
import { t } from "i18next";

function getBackendLog() {
    const contents = getLog().getLogContents();
    if (contents === null) {
        return t("backend_log.log-does-not-exist", { fileName: "current log" });
    }
    return contents;
}

export default {
    getBackendLog
};
