module.exports = data => {
    const ctx = api.$container.find('.stats-canvas')[0].getContext("2d");
    
    const myPieChart = new Chart(ctx, {
        type: 'pie',
        data: {
            datasets: [{
                data: data.map(nc => nc.count),
                backgroundColor: ['#3366CC','#DC3912','#FF9900','#109618','#990099','#3B3EAC','#0099C6','#DD4477','#66AA00','#B82E2E','#316395','#994499','#22AA99','#AAAA11','#6633CC','#E67300','#8B0707','#329262','#5574A6','#3B3EAC'],
                datalabels: {
                    anchor: 'end'
                }
            }],
            labels: data.map(nc => nc.name)
        },
        options: {
            legend: {
                display: false
            },
            plugins: {
                datalabels: {
                    backgroundColor: function(context) {
                        return context.dataset.backgroundColor;
                    },
                    borderColor: 'white',
                    borderRadius: 25,
                    borderWidth: 2,
                    color: 'white',
                    display: function(context) {
                        var dataset = context.dataset;
                        var count = dataset.data.length;
                        var value = dataset.data[context.dataIndex];
                        return value > count * 1.5;
                    },
                    font: {
                        weight: 'bold'
                    },
                    formatter: function(value, context) {
                        return context.chart.data.labels[context.dataIndex] + ": " + Math.round(value);
                    }
                }
            }
        }
    });
}