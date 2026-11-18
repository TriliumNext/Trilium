# Значки и цвета заметок
## Значки

<figure class="image image-style-align-right image_resized" style="width:48.4%;"><img style="aspect-ratio:1089/995;" src="Note Icons &amp; Colors_image.png" width="1089" height="995"></figure>

Значки полезны для различения заметок и отображаются рядом с заголовком заметки, а также в различных местах, таких как <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Дерево заметок</a>, <a class="reference-link" href="../../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Внутренние (ссылочные) ссылки</a> или <a class="reference-link" href="../Navigation/Jump%20to%20%26%20command%20palette.md">«Переход к» и палитра команд</a>.

При редактировании заметки нажмите на значок рядом с заголовком, чтобы открыть галерею выбора.

Значки могут наследоваться с помощью <a class="reference-link" href="../../Advanced%20Usage/Templates.md">Шаблонов</a> или <a class="reference-link" href="../../Advanced%20Usage/Attributes/Attribute%20Inheritance.md">Наследования атрибутов</a>.

> [!NOTE]
> На техническом уровне они задаются атрибутом `iconClass`, который добавляет CSS-класс к заметке. Например, `#iconClass="bx bx-calendar"` покажет календарь вместо значка страницы или папки по умолчанию. Искать и запоминать имена CSS-классов не нужно.

## Цвета

Заметки также могут иметь пользовательский цвет. Подобно значку заметки, этот цвет будет показан в различных местах, таких как <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Дерево заметок</a> и <a class="reference-link" href="../../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Внутренние (ссылочные) ссылки</a>.

Чтобы задать пользовательский цвет, щёлкните правой кнопкой по заметке в <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Дереве заметок</a> и выберите предопределённый цвет оттуда или используйте палитру (последний вариант).

Альтернативно, пользовательский цвет можно задать вручную через [метку](../../Advanced%20Usage/Attributes/Labels.md) `#color`, чьё значение должно быть корректным hex-цветом с ведущим `#` (например, `#ff0000` для красного). Этот цвет можно переносить на несколько заметок через <a class="reference-link" href="../../Advanced%20Usage/Attributes/Attribute%20Inheritance.md">Наследование атрибутов</a>.
