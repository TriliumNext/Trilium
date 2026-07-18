if (!api.isBackendScriptingEnabled() || !api.isSqlConsoleEnabled()) {
    api.$container.html("<p>This statistic requires backend scripting and the SQL console to be enabled (Options → Security).</p>");
    return;
}

const notes = await api.runOnBackend(() => {
    return api.sql.getRows(`
        SELECT
            notes.noteId,
            COUNT(attributes.attributeId) AS count
        FROM notes
        JOIN attributes ON attributes.value = notes.noteId
        WHERE notes.isDeleted = 0
          AND attributes.isDeleted = 0
          AND attributes.type = 'relation'
        GROUP BY notes.noteId
        ORDER BY count DESC
        LIMIT 100`);
});

const $statsTable = api.$container.find('.stats-table');

for (const note of notes) {     
    $statsTable.append(
        $("<tr>")
            .append(
                $("<td>").append(await api.createLink(note.noteId, {showNotePath: true}))
            ) 
            .append($("<td nowrap>").text(note.count))
    );
}