import cls from "../services/cls.js";
import sql from "../services/sql.js";

export default () => {
    cls.init(() => {
        const row = sql.getRow<{ value: string }>(
            `SELECT value FROM options WHERE name = 'openNoteContexts'`
        );

        if (!row || !row.value) {
            return;
        }

        let parsed: any;
        try {
            parsed = JSON.parse(row.value);
        } catch {
            return;
        }

        // Already in new format, skip
        if (parsed[0].windowId) {
            return;
        }

        // Old format: just contexts
        const migrated = [
            {
                windowId: "main",
                createdAt: 0,
                closedAt: null,
                contexts: parsed
            }
        ];

        sql.execute(
            `UPDATE options SET value = ? WHERE name = 'openNoteContexts'`,
            [JSON.stringify(migrated)]
        );

    });
};
