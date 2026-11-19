# Виджет, отслеживающий контекст заметки
Виджеты, отслеживающие контекст заметки (note context-aware widgets), — это отдельный тип виджетов, которые автоматически реагируют на изменения текущей заметки.

Важные особенности:

*   Виджет должен экспортировать `class`, а не экземпляр класса (то есть без `new`), поскольку его необходимо создавать отдельно для каждой заметки, чтобы разделение экрана работало корректно.
*   Поскольку экспортируется `class`, а не экземпляр, геттер `parentWidget` должен быть `static`, иначе виджет будет проигнорирован.

## Пример отображения заголовка текущей заметки

Это виджет с отслеживанием контекста заметки, который просто отображает название текущей заметки.

### Классический пример

```
class HelloNoteDetail extends api.NoteContextAwareWidget {

    constructor() {
        super();
        this.contentSized();
    }

    doRender() {
        this.$widget = $("<div>");
    }

    async refreshWithNote(note) {
        this.$widget.text("Current note: " + note.title);
    }
    
    static get parentWidget() { return "note-detail-pane" }    
    get position() { return 10 }
    
}

module.exports = HelloNoteDetail;
```

### Preact (v0.101.0+)

```
import { defineWidget, useNoteContext, useNoteProperty } from "trilium:preact";

export default defineWidget({    
    parent: "note-detail-pane",
    position: 10,
    render: () => {
        const { note } = useNoteContext();
        const title = useNoteProperty(note, "title");
        return <span>Current note JSX: {title}</span>;
    }
});
```