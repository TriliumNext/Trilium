if (!api.isBackendScriptingEnabled() || !api.isSqlConsoleEnabled()) {
    api.$container.html("<p>Для этой статистики необходимо включить серверные сценарии и консоль SQL (Настройки → Безопасность).</p>");
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