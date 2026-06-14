/**
 * TEMPLATE — JS/TS data migration.
 *
 * Copy to: packages/trilium-core/src/migrations/0NNN__<description>.ts
 * (replace 0NNN with the zero-padded version number, e.g. 0239).
 *
 * Use a JS migration ONLY when the transform needs becca / note APIs
 * (content, attachments, relations, templates). For pure schema or data
 * SQL, use an `{ version, sql }` entry instead — see sql-migration.snippet.md.
 *
 * Models in-tree: 0233__migrate_geo_map_to_collection.ts,
 *                 0234__migrate_ai_chat_to_code.ts
 *
 * ---------------------------------------------------------------------------
 * Wire it into packages/trilium-core/src/migrations/migrations.ts by adding
 * this object at the TOP of the MIGRATIONS array (newest first). Note the
 * `.js` extension on the import — the build emits ESM:
 *
 *     // <one-line description of what this migration does>
 *     {
 *         version: 239,
 *         module: async () => import("./0239__<description>.js")
 *     },
 *
 * Do NOT bump appInfo.dbVersion — it is derived from MIGRATIONS[0].version.
 * ---------------------------------------------------------------------------
 */

import becca from "../becca/becca";
import becca_loader from "../becca/becca_loader";
import { getContext } from "../services/context";

export default () => {
    // CLS context is mandatory: without it note.save() / note.setContent()
    // throw. becca_loader.load() (re)populates the in-memory cache from the
    // DB the runner just migrated up to this point.
    getContext().init(() => {
        becca_loader.load();

        for (const note of Object.values(becca.notes)) {
            // Narrow to just the rows this migration cares about.
            if (note.type as string !== "someOldType") {
                continue;
            }

            console.log(`Migrating note '${note.noteId}' ...`);

            // Mutate via becca/note APIs so EntityChange records are created
            // for sync. Do NOT issue raw UPDATEs against the cached tables here.
            note.type = "code";
            note.mime = "application/json";
            note.save();

            // Content / attachment / relation transforms also go here, e.g.:
            //   const content = note.getContent();
            //   note.saveAttachment({ role: "...", title: "...", mime: "...", content });
            //   note.setContent("");
            //   note.setRelation("template", "_template_xyz");
        }
    });
};
