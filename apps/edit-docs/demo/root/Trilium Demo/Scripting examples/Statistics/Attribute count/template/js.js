if (!api.isBackendScriptingEnabled() || !api.isSqlConsoleEnabled()) {
    api.$container.html("<p>This statistic requires backend scripting and the SQL console to be enabled (Options → Security).</p>");
    return;
}

const attrCounts = await api.runOnBackend(() => {
    return api.sql.getRows(`
        SELECT
            name, COUNT(*) AS count
        FROM attributes
        WHERE isDeleted = 0
        GROUP BY name
        ORDER BY count DESC`);
});

renderPieChart(attrCounts.length <= 10 ? attrCounts : attrCounts.splice(0, 10));
renderTable(attrCounts);