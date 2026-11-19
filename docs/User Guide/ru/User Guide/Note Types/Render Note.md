# Render Note
<figure class="image"><img style="aspect-ratio:601/216;" src="Render Note_image.png" width="601" height="216"></figure>

Render Note — это особый случай [клиентского скриптинга](../Scripting/Frontend%20Basics.md), который позволяет отображать пользовательское содержимое внутри заметки. Это даёт возможность создавать пользовательские дашборды или использовать пользовательский редактор заметок.

Содержимое может быть как ванильным HTML, так и Preact JSX.

## Создание render-заметки

1.  Создайте <a class="reference-link" href="Code.md">Кодовую</a> заметку с:
    1.  Языком HTML для устаревшего/ванильного метода, с тем, что нужно отобразить (например, `<p>Hello world.</p>`).
    2.  JSX для подхода на основе Preact (см. ниже).
2.  Создайте <a class="reference-link" href="Render%20Note.md">Render Note</a>.
3.  Назначьте [отношение](../Advanced%20Usage/Attributes.md) `renderNote`, указывающее на ранее созданную кодовую заметку.

## Устаревший скриптинг с использованием jQuery

Статического HTML обычно недостаточно для <a class="reference-link" href="../Scripting.md">Скриптинга</a>. Следующий шаг — автоматически изменять части заметки с помощью JavaScript.

Для простого примера мы создадим render-заметку, которая отображает текущую дату в поле.

Для этого сначала создайте HTML-кодовую заметку со следующим содержимым:

```html
<h1>Current date & time</h1>
The current date & time is <span class="date"></span>
```

Теперь нам нужно добавить скрипт. Создайте другую <a class="reference-link" href="Code.md">Кодовую</a> заметку, но на этот раз с языком JavaScript (frontend). Убедитесь, что вновь созданная заметка является прямым потомком ранее созданной HTML-заметки; со следующим содержимым:

```javascript
const $dateEl = api.$container.find(".date");
$dateEl.text(new Date());
```

Теперь создайте render-заметку в любом месте и задайте её отношению `~renderNote` указание на HTML-заметку. При доступе к render-заметке она отобразит:

> **Current date & time**  
> The current date & time is Sun Apr 06 2025 15:26:29 GMT+0300 (Eastern European Summer Time)

## Динамическое содержимое с использованием Preact и JSX

Как более современная альтернатива jQuery, можно использовать Preact и JSX для рендеринга страниц. Поскольку JSX — надмножество JavaScript, больше не нужно предоставлять HTML.

Вот шаги по созданию простой render-заметки:

1.  Создайте заметку типа <a class="reference-link" href="Render%20Note.md">Render Note</a>.
2.  Создайте дочернюю <a class="reference-link" href="Code.md">Кодовую</a> заметку с JSX в качестве языка.  
    В качестве примера используйте следующее содержимое:

    ```
    export default function() {
        return (
            <>
                <p>Hello world.</p>
            </>
        );
    }
    ```
3.  В родительской render-заметке определите отношение `~renderNote`, указывающее на вновь созданную дочернюю заметку.
4.  Обновите render-заметку, и она должна отобразить сообщение «Hello world».

## Обновление заметки

Заметку можно обновить через:

*   Кнопку <span class="tn-icon bx bx-refresh"></span> в области <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20buttons.md">Кнопок заметки</a>.
*   [Сочетание клавиш](../Basic%20Concepts%20and%20Features/Keyboard%20Shortcuts.md) «Перерендерить активную заметку» (по умолчанию не назначено).

## Печать

Render-заметку можно распечатать или экспортировать в PDF из <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20menu.md">Меню заметки</a> после установки её отношения `~renderNote` (см. <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Printing%20%26%20Exporting%20as%20PDF.md">Печать и экспорт в PDF</a>). В отличие от других заметок, она печатается в точности так, как отображается: скрипт не запускается снова, поэтому то, что было набрано, выбрано или загружено в заметке, сохраняется.

*   Содержимое размещается заново по ширине страницы, поэтому элементы, размер которых задан скриптом для экрана (такие как диаграммы), могут не вписаться.
*   Прокручиваемые области, такие как таблица в прокручиваемом контейнере, печатаются в полную высоту, без полосы прокрутки.
*   Чтобы настроить макет для печати, используйте отношение `~printCss`.
*   Для печати используются светлые цвета независимо от текущей темы.

Когда render-заметка печатается как часть коллекции <a class="reference-link" href="../Collections/List%20View.md">Список</a> или из другого вида, такого как её вложения, она не на экране, поэтому её скрипт запускается снова для печати. В коллекции вывод печатается без собственных стилей заметки.

## Примеры

*   <a class="reference-link" href="../Advanced%20Usage/Advanced%20Showcases/Weight%20Tracker.md">Трекер веса</a>, который присутствует в <a class="reference-link" href="../Advanced%20Usage/Database/Demo%20Notes.md">Демонстрационных заметках</a>.
