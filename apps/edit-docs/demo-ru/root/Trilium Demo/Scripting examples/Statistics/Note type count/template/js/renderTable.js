module.exports = counts => {
    const $statsTable = api.$container.find('.stats-table');
    
    addRow('total', 
           counts.reduce((acc, cur) => acc + cur.countNotDeleted, 0), 
           counts.reduce((acc, cur) => acc + cur.countDeleted, 0)
    );
    
    for (const count of counts) {
        addRow(count.type, count.countNotDeleted, count.countDeleted);
    }

    function addRow(type, countNotDeleted, countDeleted) {
        $statsTable.append(
            $("<tr>")
                .append($("<td>").text(type))
                .append($("<td>").text(countNotDeleted))
                .append($("<td>").text(countDeleted))
        );
    }
}