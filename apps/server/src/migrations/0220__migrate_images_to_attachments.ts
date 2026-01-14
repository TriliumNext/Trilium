import { becca_loader } from "@triliumnext/core";

import becca from "../becca/becca.js";
import cls from "../services/cls.js";
import log from "../services/log.js";
import sql from "../services/sql.js";

export default () => {
    cls.init(() => {
        // emergency disabling of image compression since it appears to make problems in migration to 0.61
        sql.execute(/*sql*/`UPDATE options SET value = 'false' WHERE name = 'compressImages'`);

        becca_loader.load();

        for (const note of Object.values(becca.notes)) {
            try {
                const attachment = note.convertToParentAttachment({ autoConversion: true });

                if (attachment) {
                    log.info(`Auto-converted note '${note.noteId}' into attachment '${attachment.attachmentId}'.`);
                }
            } catch (e: any) {
                log.error(`Cannot convert note '${note.noteId}' to attachment: ${e.message} ${e.stack}`);
            }
        }
    });
};
