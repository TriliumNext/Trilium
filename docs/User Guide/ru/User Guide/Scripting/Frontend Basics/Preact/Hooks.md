# Хуки
## Стандартные хуки Preact

Все стандартные хуки Preact доступны для импорта из `trilium:api`.

Например:

```jsx
import { useState } from "trilium:preact";
const [ myState, setMyState ] = useState("Hi");
```

## Пользовательские хуки

Trilium поставляется с большим набором пользовательских хуков для Preact, все они также доступны для пользовательских виджетов и <a class="reference-link" href="../../../Note%20Types/Render%20Note.md">заметок рендеринга</a>.

### `useNoteContext`

В качестве замены <a class="reference-link" href="../Custom%20Widgets/Note%20context%20aware%20widget.md">виджета, учитывающего контекст заметки</a>, Preact предоставляет контекст текущей заметки через хук `useNoteContext`:

```jsx
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

Обратите внимание, что пользовательский виджет должен находиться внутри области содержимого (то есть быть виджетом области просмотра заметки), чтобы это работало корректно, особенно при использовании разделённых панелей (splits).

### `useActiveNoteContext`

`useActiveNoteContext` — это альтернатива `useNoteContext`, которая работает, даже если виджет находится вне области просмотра заметки, и автоматически переключает контекст заметки, когда пользователь переходит между вкладками и разделёнными панелями.

### `useNoteProperty`

Этот хук позволяет «подписаться» на изменения определённого свойства объекта `FNote`, например `title` или `type` заметки. Преимущество использования этого хука в том, что он действительно реагирует на изменения — например, при изменении заголовка или типа заметки.