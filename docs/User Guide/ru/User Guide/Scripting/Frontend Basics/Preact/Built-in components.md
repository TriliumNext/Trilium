# Встроенные компоненты
<figure class="image image_resized" style="width:54.58%;"><img style="aspect-ratio:896/712;" src="Built-in components_image.png" width="896" height="712"><figcaption>Фрагмент скриншота из примера демонстрации виджетов (см. ниже).</figcaption></figure>

Trilium поставляется с собственным набором компонентов Preact, часть из которых также доступна для <a class="reference-link" href="../Custom%20Widgets.md">пользовательских виджетов</a> и <a class="reference-link" href="../../../Note%20Types/Render%20Note.md">заметок рендеринга</a>.

Чтобы использовать эти компоненты, просто импортируйте их из `trilium:preact`:

```jsx
import { ActionButton, Button, LinkButton } from "trilium:preact";
```

а затем используйте их:

```jsx
export default function MyRenderNote() {
    const onClick = () => showMessage("A button was pressed");
    
    return (
        <>
            <h2>Buttons</h2>
            <div style={{ display: "flex", gap: "1em", alignItems: "center" }}>
                <ActionButton icon="bx bx-rocket" text="Action button" onClick={onClick} />
                <Button icon="bx bx-rocket" text="Simple button" onClick={onClick} />
                <LinkButton text="Link button" onClick={onClick} />                
            </div>
        </>
    )
}
```

## Демонстрация виджетов

> [!TIP]
> Начиная с версии v0.101.0, демонстрация виджетов также доступна в <a class="reference-link" href="../../../Advanced%20Usage/Database/Demo%20Notes.md">демонстрационных заметках</a>.

Это пример <a class="reference-link" href="../../../Note%20Types/Render%20Note.md">заметки рендеринга</a> с JSX, который показывает большинство встроенных компонентов, доступных для пользовательских виджетов и JSX-заметок рендеринга.

Чтобы воспользоваться им:

1.  Создайте заметку рендеринга.
2.  Создайте дочернюю заметку типа «Код» с языком JSX и содержимым этого файла: <a class="reference-link" href="Built-in%20components/Widget%20showcase.jsx">Демонстрация виджетов</a>
3.  Задайте связь `~renderNote` родительской заметки на эту дочернюю заметку.
4.  Обновите заметку рендеринга, чтобы увидеть результат.