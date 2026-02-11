import becca from "../becca/becca";
import becca_loader from "../becca/becca_loader";
import cls from "../services/cls.js";

export default () => {
    cls.init(() => {
        becca_loader.load();

        for (const note of Object.values(becca.notes)) {
            if (note.type as string !== "aiChat") {
                continue;
            }

            console.log(`Migrating note '${note.noteId}' from aiChat to code type...`);

            note.type = "code";
            note.mime = "application/json";
            note.save();
        }
    });
};
