# Основы создания виджетов
Это руководство проведёт вас через создание базового виджета в Trilium. Следуя этим шагам, вы научитесь создавать простой элемент интерфейса, который взаимодействует с пользователем.

### Шаг 1: Базовая структура виджета

Для начала создадим максимально простой виджет. Вот базовый пример:

```
class MyWidget extends api.BasicWidget {
    get position() { return 1; }
    get parentWidget() { return "left-pane"; }
    
    doRender() {
        this.$widget = $("<div id='my-widget'>");
        return this.$widget;
    }
}

module.exports = new MyWidget();
```

Чтобы реализовать этот виджет:

1.  Создайте новую заметку типа `JS Frontend` в Trilium и вставьте приведённый выше код.
2.  Добавьте [атрибут](../../../Advanced%20Usage/Attributes.md) `#widget` к этой [заметке](../../../Basic%20Concepts%20and%20Features/Notes.md).
3.  Перезапустите Trilium или перезагрузите окно.

Чтобы убедиться, что виджет работает, откройте инструменты разработчика (<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>I</kbd>) и выполните `document.querySelector("#my-widget")`. Если элемент найден, виджет работает корректно. Если возвращается `undefined`, проверьте, что у [заметки](../../../Basic%20Concepts%20and%20Features/Notes.md) установлен [атрибут](../../../Advanced%20Usage/Attributes.md) `#widget`.

### Шаг 2: Добавление элемента интерфейса

Далее улучшим виджет, добавив в него кнопку.

```
const template = `<div id="my-widget"><button>Click Me!</button></div>`;

class MyWidget extends api.BasicWidget {
    get position() {return 1;}
    get parentWidget() {return "left-pane"}

    doRender() {
        this.$widget = $(template);
        return this.$widget;
    }
}

module.exports = new MyWidget();
```

После внесения этого изменения перезагрузите Trilium. Теперь в левом верхнем углу левой панели должна появиться кнопка.

### Шаг 3: Стилизация виджета

Чтобы кнопка выглядела аккуратнее и располагалась в нужном месте, добавим пользовательские стили. В Trilium встроены иконки [Box Icons](https://boxicons.com), с помощью которых мы заменим текст кнопки на иконку, например <span class="tn-icon bx bxs-magic-wand"></span> `bx bxs-magic-wand`.

Вот обновлённый шаблон:

```
const template = `<div id="my-widget"><button class="tree-floating-button bx bxs-magic-wand tree-settings-button"></button></div>`;
```

Затем настроим положение кнопки с помощью CSS:

```
class MyWidget extends api.BasicWidget {
    get position() { return 1; }
    get parentWidget() { return "left-pane"; }
    
    doRender() {
        this.$widget = $(template);
        this.cssBlock(`#my-widget {
            position: absolute;
            bottom: 40px;
            left: 60px;
            z-index: 1;
        }`);
        return this.$widget;
    }
}

module.exports = new MyWidget();
```

После перезагрузки Trilium кнопка должна появиться в левом нижнем углу левой панели, рядом с остальными кнопками действий.

### Шаг 4: Добавление взаимодействия с пользователем

Сделаем кнопку интерактивной, чтобы при нажатии на неё отображалось сообщение. Для этого воспользуемся методом `api.showMessage` из [Script API](../../Script%20API.md).

```
class MyWidget extends api.BasicWidget {
    get position() { return 1; }
    get parentWidget() { return "left-pane"; }
    
    doRender() {
        this.$widget = $(template);
        this.cssBlock(`#my-widget {
            position: absolute;
            bottom: 40px;
            left: 60px;
            z-index: 1;
        }`);
        this.$widget.find("button").on("click", () => api.showMessage("Hello World!"));
        return this.$widget;
    }
}

module.exports = new MyWidget();
```

Список возможных значений для `parentWidget()` см. в разделе <a class="reference-link" href="../Custom%20Widgets.md">Пользовательские виджеты</a>.

[Перезагрузите](../../../Troubleshooting/Refreshing%20the%20application.md) приложение в последний раз. При нажатии на кнопку должно появиться сообщение «Hello World!», подтверждающее, что ваш виджет полностью работает.