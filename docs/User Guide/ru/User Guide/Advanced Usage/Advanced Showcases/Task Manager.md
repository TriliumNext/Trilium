# Менеджер задач
Менеджер задач — это пример использования [продвигаемых атрибутов](../Attributes/Promoted%20Attributes.md) и [скриптов](../../Scripting.md), представленный в [демонстрационных заметках](../Database.md).

## Демонстрация

![](Task%20Manager_task-manager.png)

Менеджер задач управляет невыполненными задачами (TODO) и завершёнными задачами (непустой атрибут doneDate). Невыполненные задачи дополнительно классифицируются по местоположению и произвольным тегам — при изменении атрибута тега в заметке задачи она автоматически перемещается в соответствующее местоположение.

Менеджер задач также интегрируется с [заметками дня](Day%20Notes.md) — заметки [клонируются](../../Basic%20Concepts%20and%20Features/Notes/Cloning%20Notes.md) в заметку дня как в заметку todoDate, так и в заметку doneDate (с [префиксом](../../Basic%20Concepts%20and%20Features/Navigation/Tree%20Concepts.md) «TODO» или «DONE»).

## Реализация

Новые задачи создаются в заметке TODO, у которой [отношение](../Attributes.md) `~child:template` (см. [наследование атрибутов](../Attributes/Attribute%20Inheritance.md)) указывает на шаблон задачи.

### Атрибуты

Шаблон задачи определяет несколько [продвигаемых атрибутов](../Attributes/Promoted%20Attributes.md) — todoDate, doneDate, tags, location. Важно, что он также определяет отношение `~runOnAttributeChange` — обработчик [события](../../Scripting/Backend%20scripts/Backend%20Events.md), который запускается при изменении атрибута. Этот [скрипт](../../Scripting.md) обрабатывает, например, заполнение атрибута doneDate — что означает, что задача выполнена и её следует переместить в заметку «Done» и убрать из TODO, местоположений и тегов.

### Кнопка новой задачи

Также есть заметка-кнопка, содержащая простой скрипт, который добавляет кнопку создания новой заметки (задачи) в заметке TODO.

```
api.addButtonToToolbar({
    title: 'New task',
    icon: 'check',
    shortcut: 'alt+n',
    action: async () => {
        // creating notes is backend (server) responsibility so we need to pass
        // the control there
        const taskNoteId = await api.runOnBackend(async () => {
            const todoRootNote = await api.getNoteWithLabel('taskTodoRoot');
            const {note} = await api.createNote(todoRootNote.noteId, 'new task', '');

            return note.noteId;
        });

        // we got an ID of newly created note and we want to immediatelly display it
        await api.activateNewNote(taskNoteId);
    }
});
```

### CSS

На демонстрационном снимке выше вы могли заметить, что задачи TODO красного цвета, а задачи DONE — зелёного.

Это достигается [кодовой заметкой](../../Note%20Types/Code.md) с CSS, которая определяет дополнительные CSS-классы:

```
span.fancytree-node.todo .fancytree-title {
    color: red !important;
}

span.fancytree-node.done .fancytree-title {
    color: green !important;
}
```

У этой [кодовой заметки](../../Note%20Types/Code.md) есть [метка](../Attributes.md) `#appCss`, которую Trilium распознаёт при запуске и загружает как CSS в приложение.

Вторая часть этой функциональности основана на описанном выше обработчике события, который присваивает задаче метку `#cssClass` со значением «done» или «todo» в зависимости от статуса задачи.
