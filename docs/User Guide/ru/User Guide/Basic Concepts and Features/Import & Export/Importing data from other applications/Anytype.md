# Anytype
Начиная с v0.104.0, Trilium умеет импортировать данные из Anytype из JSON-импортов, которые сохраняют большую часть форматирования и метаинформации.

## Процесс импорта

Первый шаг — экспорт данных из Anytype:

*   Чтобы экспортировать одну страницу:
    *   Выберите страницу для экспорта.
    *   Нажмите \[…\] в правом верхнем углу окна и выберите _Экспорт_.
    *   Убедитесь, что заданы следующие опции:
        *   Export format: Any-Block
        *   File Format: JSON
        *   Zip archive: On
        *   Include linked objects: On
        *   Include files: On
        *   Include archived objects: On
*   Чтобы экспортировать весь канал:
    *   Выберите нужный канал на левой панели.
    *   Под значком канала на левой боковой панели нажмите на название канева со стрелкой и выберите _Channel Settings_.
    *   На левой боковой панели найдите раздел _Integrations_ и выберите _Экспорт_.
    *   Нажмите _Any-Block_.
    *   Убедитесь, что заданы следующие опции:
        *   File Format: JSON
        *   Zip archive: On
        *   Include files: On
        *   Include archived objects: On

В Trilium Notes:

1.  В <a class="reference-link" href="../../UI%20Elements/Note%20Tree.md">Дереве заметок</a> щёлкните правой кнопкой и выберите _Импортировать в заметку_.
2.  В разделе _Импорт из_ выберите <span class="tn-icon tn-brand tn-brand-anytype"></span> _Anytype_.
3.  Загрузите ZIP.

> [!NOTE]
> Экспорт коллекций по отдельности иногда может упускать информацию, которая иначе была бы получена из экспорта всего канала. Причина в том, что Anytype опускает некоторую информацию при экспорте отдельных страниц/коллекций.

## Поддерживаемые возможности

Следующие возможности сохраняются Trilium в процессе импорта:

*   Базовое форматирование (полужирный, курсив, подчёркивание, зачёркивание, заголовки, цвета, выделения, встроенный код).
*   <a class="reference-link" href="../../../Note%20Types/Text/Lists.md">Списки</a> (нумерованные или маркированные)
*   <a class="reference-link" href="../../../Note%20Types/Text/Images.md">Изображения</a> и файлы обрабатываются как <a class="reference-link" href="../../Notes/Attachments.md">Вложения</a>.
*   Списки дел (to-do)
*   Сворачиваемые разделы (toggles)
*   <a class="reference-link" href="../../../Note%20Types/Text/Tables.md">Таблицы</a>
*   Встроенные <a class="reference-link" href="../../../Note%20Types/Mermaid%20Diagrams.md">Диаграммы Mermaid</a>
*   <a class="reference-link" href="../../../Note%20Types/Text/Math%20Equations.md">Математические формулы</a>
*   Блоки выделения импортируются как цитаты.
*   <a class="reference-link" href="../../../Note%20Types/Text/Developer-specific%20formatting/Code%20blocks.md">Блоки кода</a> с попыткой восстановить язык по мере возможности.
*   Ссылки между другими импортированными страницами конвертируются в <a class="reference-link" href="../../../Note%20Types/Text/Links/Internal%20(reference)%20links.md">внутренние (ссылочные) ссылки</a>, если они являются частью того же импорта.
    *   Применяется как к блочным, так и к встроенным ссылкам.
*   Коллекции импортируются как нативные Trilium <a class="reference-link" href="../../../Collections.md">Коллекции</a> (см. ниже).
    *   Файлы внутри коллекций импортируются как заметки <a class="reference-link" href="../../../Note%20Types/File.md">Файл</a>.
*   Разделители (линия, точки) импортируются как горизонтальные линейки.
*   [Замечания (admonitions)](../../../Note%20Types/Text/Block%20quotes%20%26%20admonitions.md) сохраняются, включая их эмодзи (добавленные как часть содержимого).
*   Даты создания и изменения страниц сохраняются.

## Коллекции

Коллекции, созданные в Anytype, импортируются по возможности, сохраняя и режим вида, и свойства страницы как <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Продвигаемые атрибуты</a>.

Поддерживаются следующие режимы вида:

*   List как <a class="reference-link" href="../../../Collections/List%20View.md">Список</a>
*   Gallery как <a class="reference-link" href="../../../Collections/Grid%20View.md">Сетка</a>
*   <a class="reference-link" href="../../../Collections/Calendar.md">Календарь</a>, сохраняя атрибут, определяющий дату.
*   <a class="reference-link" href="../../../Collections/Kanban%20Board.md">Kanban-доска</a>, сохраняя столбец группировки доски.
*   <a class="reference-link" href="../../../Collections/Table.md">Таблица</a>, также используемая как запасной вариант для неподдерживаемых макетов коллекций.

Поддерживаются следующие типы:

<table>
    <thead>
        <tr>
            <th scope="col">Тип свойства Anytype</th>
            <th scope="col">Trilium</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td>Text / Select</td>
            <td>Однозначная метка <code>text</code></td>
        </tr>
        <tr>
            <td>Number</td>
            <td>Однозначная метка <code>number</code></td>
        </tr>
        <tr>
            <td>Multi-select</td>
            <td>По одной метке <code>text</code> на вариант (multi)</td>
        </tr>
        <tr>
            <td>Date / Date with time</td>
            <td><ul><li><code>datetime</code>, если время включено.</li><li><code>date</code>, если только даты.</li></ul></td>
        </tr>
        <tr>
            <td>File</td>
            <td>Файлы сохраняются как вложения, а ссылка на них добавляется в начало содержимого заметки для видимости.</td>
        </tr>
        <tr>
            <td>Checkbox</td>
            <td>Метка <code>boolean</code> (<code>true</code>/<code>false</code>).</td>
        </tr>
        <tr>
            <td>URL / Email / Phone</td>
            <td>Метка <code>url</code> (префикс <code>mailto:</code>, <code>tel:</code>)</td>
        </tr>
    </tbody>
</table>

## Сообщение о проблемах

При импорте ваших заметок Anytype вы можете обнаружить проблемы в том, как импортируется заметка; в этом случае рассмотрите возможность [сообщить о них](../../../Troubleshooting/Reporting%20issues.md).

При сообщении о такой проблеме обязательно предоставьте следующую информацию:

*   .zip-экспорт исходной заметки (и дочерних, если применимо). Это позволяет нам воспроизвести проблему.
*   Снимок экрана того, как это выглядело изначально до импорта и как выглядит после импорта.
