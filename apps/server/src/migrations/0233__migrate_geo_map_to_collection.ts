import { becca_loader } from "@triliumnext/core";

import becca from "../becca/becca";
import cls from "../services/cls.js";
import hidden_subtree from "../services/hidden_subtree";

export default () => {
    cls.init(() => {
        becca_loader.load();

        // Ensure the geomap template is generated.
        hidden_subtree.checkHiddenSubtree(true);

        for (const note of Object.values(becca.notes)) {
            if (note.type as string !== "geoMap") {
                continue;
            }

            console.log(`Migrating note '${note.noteId}' from geoMap to book type...`);

            note.type = "book";
            note.mime = "";
            note.save();

            if (!note.isProtected) {
                const content = note.getContent();
                if (content) {
                    const title = "geoMap.json";
                    const existingAttachment = note.getAttachmentsByRole("viewConfig")
                        .filter(a => a.title === title)[0];
                    if (existingAttachment) {
                        existingAttachment.setContent(content);
                    } else {
                        note.saveAttachment({
                            role: "viewConfig",
                            title,
                            mime: "application/json",
                            content,
                            position: 0
                        });
                    }

                }
                note.setContent("");
            }

            note.setRelation("template", "_template_geo_map");
        }
    });
};
