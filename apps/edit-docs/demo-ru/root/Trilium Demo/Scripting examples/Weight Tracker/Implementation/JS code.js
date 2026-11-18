async function getChartData() {
    const notes = await api.searchForNotes("#weight");
    const days = [];

    for (const note of notes) {
        const date = note.getLabelValue('dateNote');
        const weight = parseFloat(note.getLabelValue('weight'));

        if (date && weight) {
            days.push({ date, weight });
        }
    }

    days.sort((a, b) => a.date > b.date ? 1 : -1);

    const datasets = [
        {
            label: "Weight (kg)",
            backgroundColor: 'red',
            borderColor: 'red',
            data: days.map(day => day.weight),
            fill: false,
            spanGaps: true,
            datalabels: {
                display: false
            },
            tension: 0.3
        }
    ];

    return {
        datasets: datasets,
        labels: days.map(day => day.date)
    };
}

const ctx = api.$container.find("canvas")[0].getContext("2d");

new chartjs.Chart(ctx, {
    type: 'line',
    data: await getChartData()
});
