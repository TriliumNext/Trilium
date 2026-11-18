# Контекстное меню заметки
<figure class="image image-style-align-right image_resized" style="width:44.65%;"><img style="aspect-ratio:514/291;" src="Note contextual menu_image.png" width="514" height="291"></figure>

Правый щелчок по содержимому некоторых типов заметок, таких как <a class="reference-link" href="../../Note%20Types/Text.md">Текст</a> или <a class="reference-link" href="../../Note%20Types/Code.md">Код</a>, открывает контекстное меню.

В редактируемой текстовой заметке правый щелчок по ссылке открывает вместо этого меню ссылки — то же, что её меню _Дополнительные действия_ (см. <a class="reference-link" href="../../Note%20Types/Text/Links/External%20links.md">Внешние ссылки</a> и <a class="reference-link" href="../../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Внутренние (ссылочные) ссылки</a>). Выделение, содержащее ссылку и ещё текст, сохраняет контекстное меню.

## Возможности

*   На <a class="reference-link" href="../../Installation%20%26%20Setup/Desktop%20Installation.md">Установке на компьютер</a> при правом щелчке по слову с ошибкой показываются предложения <a class="reference-link" href="../../Note%20Types/Text/Spell%20Check.md">Проверки орфографии</a>.
*   Выделенный текст можно искать либо в поисковой системе (настроенной в <a class="reference-link" href="Options.md">Настройках</a> → _Прочее_), либо [внутри Trilium](../Navigation/Search.md).
    *   Чтобы убрать веб-поиск из меню, выберите _Нет_ в качестве поисковой системы.
*   Базовая функциональность буфера обмена (вырезать, копировать, вставить).
*   Копирование выделенного текста как <a class="reference-link" href="../Import%20%26%20Export/Markdown.md">Markdown</a>.
*   Выполнение быстрых операций с помощью <a class="reference-link" href="../../Note%20Types/Text/In-editor%20AI%20assistant.md">Встроенного ИИ-ассистента</a>.

## Различия между десктопом и веб-версией

[Веб-версия](../../Installation%20%26%20Setup/Server%20Installation.md) ведёт себя немного иначе из-за ограничений, накладываемых веб-браузерами:

*   Когда текст не выделен или щелчок правой кнопкой выполнен по слову, показывается контекстное меню браузера по умолчанию.
    *   Это намеренно, так как сохраняет функциональность <a class="reference-link" href="../../Note%20Types/Text/Spell%20Check.md">Проверки орфографии</a>.
*   Когда текст выделен, вместо этого показывается усечённое меню, содержащее только функциональность, доступную в браузерной версии
    *   _Вставить_ недоступна, так как браузер её не предоставляет; используйте вместо неё <kbd>Ctrl</kbd>+<kbd>V</kbd>.
    *   Меню браузера всё равно можно вызвать, нажав <kbd>Shift</kbd> + <kbd>Правый щелчок</kbd>.
