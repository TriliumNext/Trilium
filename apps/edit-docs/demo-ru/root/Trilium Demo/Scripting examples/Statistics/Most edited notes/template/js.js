if (!api.isBackendScriptingEnabled() || !api.isSqlConsoleEnabled()) {
    api.$container.html("<p>Для этой статистики необходимо включить серверные сценарии и консоль SQL (Настройки → Безопасность).</p>");
    return;
}

const notes = await api.runOnBackend(() => {
    return api.sql.getRows(`
        SELECT
            notes.noteId,
            COUNT(revisions.revisionId) AS count
        FROM notes
        JOIN revisions USING (noteId)
        WHERE notes.isDeleted = 0
        GROUP BY notes.noteId
        ORDER BY count DESC
        LIMIT 100`);
});

const $statsTable = api.$container.find('.stats-table');

for (const note of notes) {     
    $statsTable.append(
        $("<tr>")
            .append(
                $("<td>").append(await api.createNoteLink(note.noteId, {showNotePath: true}))
            ) 
            .append($("<td nowrap>").text(note.count))
    );
}