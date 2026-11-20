# Пользовательский CSS для всего приложения
Можно подключить CSS-файл, который будет применяться независимо от выбранной пользователем темы.

Самый быстрый способ создать его — выбрать _Вставить дочернюю заметку_ → _Код_ → _Пользовательский CSS_ (_Insert child note_ → _Code_ → _Custom CSS_) в <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree/Note%20tree%20contextual%20menu.md">контекстном меню дерева заметок</a>.

Либо создайте заметку типа <a class="reference-link" href="../Note%20Types/Code.md">Код</a> вручную, выберите язык CSS и добавьте метку `#appCss`.

## Просмотр изменений

Добавление новой _заметки CSS приложения_ или изменение существующей не применяет изменения мгновенно. Чтобы увидеть их, сначала нажмите Ctrl+Shift+R для обновления страницы.

## Примеры использования

### Настройка стилей печати

> [!TIP]
> Начиная с v0.99.2, использовать `#appCss` для настройки CSS печати больше нельзя, так как печать теперь выполняется в изолированной среде.
> 
> Тем не менее вы всё ещё можете настроить CSS с помощью `~printCss`; подробнее см. в разделе <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Printing%20%26%20Exporting%20as%20PDF.md">Печать и экспорт в PDF</a>.

### Стили для отдельных рабочих пространств

При использовании <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Workspaces.md">рабочих пространств</a> бывает полезно визуально различать заметки из разных рабочих пространств.

Для этого:

1.  В заметке с `#workspace` добавьте наследуемый атрибут `#cssClass(inheritable)` со значением, уникально идентифицирующим рабочее пространство (например, `my-workspace`).
2.  В любом месте структуры заметок создайте CSS-заметку с меткой `#appCss`.

#### Изменение цвета значков в <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">дереве заметок</a>

```
.fancytree-node.my-workspace.fancytree-custom-icon {
    color: #ff0000;
}
```

#### Изменение цвета заголовка и значка заметки

Чтобы изменить цвет заголовка заметки и её значка (над содержимым):

```
.note-split.my-workspace .note-icon-widget button.note-icon,
.note-split.my-workspace .note-title-widget input.note-title {
    color: #ff0000;
}
```

#### Добавление водяного знака на содержимое заметки

<figure class="image image-style-align-right image_resized" style="width:39.97%;"><img style="aspect-ratio:641/630;" src="Custom app-wide CSS_image.png" width="641" height="630"></figure>

1.  Вставьте изображение в любую заметку и скопируйте его URL.
2.  Используйте следующий CSS, настроив `background-image`, `width` и `height` по своему усмотрению.

```
.note-split.my-workspace .scrolling-container:after {
    position: fixed;
    content: "";
    background-image: url("/api/attachments/Rvm3zJNITQI1/image/logo.png");
    background-size: contain;
    background-position: center;
    background-repeat: no-repeat;
    width: 237px;
    height: 44px;
    bottom: 1em;
    right: 1em;
    opacity: 0.5;
    z-index: 0;
}
```

## Ограничения

Некоторые части приложения нельзя стилизовать напрямую через пользовательский CSS, поскольку они отображаются в изолированном режиме (shadow DOM), в частности:

*   Слайды в <a class="reference-link" href="../Collections/Presentation.md">презентации</a>.