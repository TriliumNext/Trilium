module.exports = counts => {
    const $statsTable = api.$container.find('.stats-table');
    
    addRow('total', counts.reduce((acc, cur) => acc + cur.count, 0));
    
    for (const count of counts) {     
        addRow(count.name, count.count);
    }

    function addRow(name, count) {
        $statsTable.append(
            $("<tr>")
                .append($("<td>").text(name))
                .append($("<td>").text(count))
        );
    }
}