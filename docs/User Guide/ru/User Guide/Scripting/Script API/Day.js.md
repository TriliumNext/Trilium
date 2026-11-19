# Day.js
Day.js — это библиотека для работы с датами, которую использует Trilium; она также доступна как во фронтенд-, так и в бэкенд-скриптах. Подробнее о самой библиотеке см. в [официальной документации](https://day.js.org/en/).

## Как использовать

Метод `dayjs` доступен напрямую в глобальном объекте `api`:

```javascript
const date = api.dayjs();
api.log(date.format("YYYY-MM-DD"));
```

## Плагины

Day.js использует модульную архитектуру на основе плагинов. Обычно эти плагины нужно импортировать, но внутри скриптов Trilium это не работает из-за использования сборщика.

Начиная с версии v0.100.0, одинаковый набор плагинов доступен как для фронтенд-, так и для бэкенд-скриптов.

Следующие плагины Day.js встроены непосредственно в Trilium:

*   [AdvancedFormat](https://day.js.org/docs/en/plugin/advanced-format)
*   [Duration](https://day.js.org/docs/en/plugin/duration), начиная с v0.100.0.
*   [IsBetween](https://day.js.org/docs/en/plugin/is-between)
*   [IsoWeek](https://day.js.org/docs/en/plugin/iso-week)
*   [IsSameOrAfter](https://day.js.org/docs/en/plugin/is-same-or-after)
*   [IsSameOrBefore](https://day.js.org/docs/en/plugin/is-same-or-before)
*   [QuarterOfYear](https://day.js.org/docs/en/plugin/quarter-of-year)
*   [UTC](https://day.js.org/docs/en/plugin/utc)

> [!NOTE]
> Если для написания скриптов вам понадобится другой плагин Day.js, вы можете создать запрос на добавление функции (feature request). В зависимости от размера плагина и его потенциальной полезности для кодовой базы Trilium он может быть интегрирован.