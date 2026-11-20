# Загрузка ответов из Google Forms
В этом руководстве показана базовая интеграция с Google Forms, позволяющая загружать ответы формы с помощью функции «Связать с Таблицами» (Link to Sheets).

Обратите внимание, что ссылка будет общедоступна всем (однако она имеет трудноугадываемый формат, например `https://docs.google.com/spreadsheets/d/e/2PACX-1vTA8NU2_eZFhc8TFadCZPreBfvP7un8IHd6J0SchrLLw3ueGmntNZjwRmsH2ZRcp1pJYDAzMz1FmFaj/pub?output=csv`). Убедитесь, что вы случайно не публикуете конфиденциальную информацию.

## Получение ссылки на CSV

1.  Откройте Google Forms в браузере.
2.  Перейдите на вкладку «Ответы» и нажмите «Связать с Таблицами» (Link to Sheets).
3.  Выберите «Создать новую таблицу» и нажмите «Создать».
4.  В Google Таблицах выберите Файл → Поделиться → Опубликовать в интернете.
5.  В окне «Опубликовать в интернете» убедитесь, что выбрана вкладка «Ссылка», и вместо «Веб-страница» выберите «Значения, разделённые запятыми (.csv)».
6.  Скопируйте полученную ссылку — она понадобится для скрипта.

## Создание скрипта

Создайте скрипт типа «JS Frontend»:

```
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTiwooLV2whjCSVa49dJ99p_G3_qhqHHRqttMjYCJVfLXVdTgUSNJu5K0rpqmaHYF2k7Vofi3o7gW82/pub?output=csv";

async function fetchData() {
    try {
        const response = await fetch(CSV_URL);
        return await response.text();
    } catch (e) {
        api.showError(e.message);
    }
}

const data = await fetchData();
console.log(data);
// Do something with the data.
```

Обратите внимание, что данные придут в виде строки, а встроенной библиотеки для разбора CSV нет. Для максимально простого разбора CSV можно использовать следующий код:

```
const content = data
	.split("\n")
	.slice(1)
	.map((row) => row.split(","));
```

Это вернёт данные в виде массива массивов.