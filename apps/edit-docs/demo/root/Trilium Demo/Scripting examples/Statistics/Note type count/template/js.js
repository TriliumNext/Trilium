if (!api.isBackendScriptingEnabled() || !api.isSqlConsoleEnabled()) {
    api.$container.html("<p>This statistic requires backend scripting and the SQL console to be enabled (Options → Security).</p>");
    return;
}

const noteCounts = await api.runOnBackend(() => {
    return api.sql.getRows(`
        SELECT
            type,
            isDeleted,
            SUM(CASE WHEN isDeleted=0 THEN 1 ELSE 0 END) AS countNotDeleted,
            SUM(CASE WHEN isDeleted=1 THEN 1 ELSE 0 END) AS countDeleted
        FROM notes
        GROUP BY type
        ORDER BY countNotDeleted DESC`);
});

renderPieChart(noteCounts.map(nc => {
    return {
        name: nc.type,
        count: nc.countNotDeleted
    };
}));

renderTable(noteCounts);