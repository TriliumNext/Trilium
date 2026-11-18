# Трекер веса
![](Weight%20Tracker_image.jpg)

`Трекер веса` — это пример использования [Script API](../../Scripting/Script%20API.md), представленный в [демонстрационных заметках](../Database.md).

Добавив `weight` как [продвигаемый атрибут](../Attributes/Promoted%20Attributes.md) в [шаблон](../Templates.md), из которого создаются [заметки дня](Day%20Notes.md), можно агрегировать данные и строить график изменения веса с течением времени.

## Реализация

Заметка `Weight Tracker` на снимке выше имеет тип `Render Note`. Этот тип заметки сам по себе не имеет содержимого. Вместо этого это место, куда [скрипт](../../Scripting.md) может выводить результат своей работы.

Скрипты для `Render Note` определяются в [отношении](../Attributes.md) с именем `~renderNote`. В этом примере это дочерняя заметка `Implementation` у `Weight Tracker`. Implementation состоит из двух [кодовых заметок](../../Note%20Types/Code.md), содержащих HTML и JavaScript соответственно, которые загружают все заметки с атрибутом `weight` и отображают их значения на диаграмме.

Для построения диаграммы используется сторонняя библиотека [chart.js](https://www.chartjs.org/), импортированная как вложение, так как она не встроена в Trilium.

### Код

Вот содержимое скрипта, помещённого в [кодовую заметку](../../Note%20Types/Code.md) типа `JS Frontend`:

```
async function getChartData() {
    const days = await api.runOnBackend(async () => {
        const notes = api.getNotesWithLabel('weight');
        const days = [];

        for (const note of notes) {
            const date = note.getLabelValue('dateNote');
            const weight = parseFloat(note.getLabelValue('weight'));

            if (date && weight) {
                days.push({ date, weight });
            }
        }

        days.sort((a, b) => a.date > b.date ? 1 : -1);

        return days;
    });

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
            }
        }
    ];

    return {
        datasets: datasets,
        labels: days.map(day => day.date)
    };
}

const ctx = $("#canvas")[0].getContext("2d");

new chartjs.Chart(ctx, {
    type: 'line',
    data: await getChartData()
});
```

## Как убрать кнопку Weight Tracker из верхней панели

В карте ссылок `Weight Tracker` есть заметка `Button`. Откройте её и удалите или закомментируйте её содержимое. Кнопка `Weight Tracker` исчезнет после перезапуска Trilium.
