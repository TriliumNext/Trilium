# Значки
Значки, такие же как [значки заметок](Icons.md), можно вставлять прямо в содержимое заметки, в том числе из любых [пользовательских наборов значков](../../../Basic%20Concepts%20and%20Features/Themes/Icon%20Packs.md).

## Возможности

*   Значок можно форматировать с помощью инструментов <a class="reference-link" href="../General%20formatting.md">Общего форматирования</a> на <a class="reference-link" href="../Formatting%20toolbar.md">Панели форматирования</a>:
    *   Цвет переднего плана / значка
    *   Цвет фона / выделения
    *   Размер шрифта
*   Также поддерживаются пользовательские <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/Themes/Icon%20Packs.md">Наборы значков</a>.
    *   Для эмодзи лучше использовать функцию эмодзи из раздела <a class="reference-link" href="../Insert%20buttons.md">Кнопки вставки</a>.
*   При клике по значку появляется всплывающая панель инструментов со следующими функциями:
    *   <span class="tn-icon bx bx-sticker"></span> — смена значка.
    *   <span class="tn-icon bx bx-reflect-horizontal"></span> — применение трансформаций: поворот (90 / 180 / 270) и отражение по горизонтали/вертикали. Для одного значка можно применить только одну трансформацию.

## Применение

*   Встроенная справка и руководство пользователя используют эти значки для иллюстрации кнопок интерфейса.
*   Импортер <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/Import%20%26%20Export/Importing%20data%20from%20other%20applications/Microsoft%20OneNote.md">Microsoft OneNote</a> также использует их для <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/Import%20%26%20Export/Importing%20data%20from%20other%20applications/Microsoft%20OneNote/Tags.md">тегов</a>.

## Вставка значка

Вставить значок можно двумя способами:

*   Через <a class="reference-link" href="../Formatting%20toolbar.md">Панель форматирования</a>: найдите кнопку <span class="tn-icon bx bx-plus"></span>, а затем значок <span class="tn-icon bx bx-sticker"></span>.
*   Через <a class="reference-link" href="../Slash%20Commands.md">Слэш-команды</a>: введите `/icon`.

Появится окно выбора значка — найдите нужный и кликните по нему, чтобы вставить в документ.

## Поиск заметок по значкам

По значкам можно выполнять [поиск](../../../Basic%20Concepts%20and%20Features/Navigation/Search.md). Заметку со значком <span class="tn-icon bx bx-star"></span> можно найти по запросу `star` или по её `iconClass` (`bx-star`).

Чтобы узнать название значка, наведите на него курсор мыши в окне выбора значков.

## Экспорт в Markdown

При экспорте в <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/Import%20%26%20Export/Markdown.md">Markdown</a> элемент будет представлен в виде исходного HTML-кода значка, используемого в Trilium:

```html
<span class="tn-icon bx bx-star"></span>
```