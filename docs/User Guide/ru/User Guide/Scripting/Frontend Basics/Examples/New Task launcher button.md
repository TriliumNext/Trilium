# Кнопка «Новая задача» на панели запуска
> [!WARNING]
> Эта документация устарела, так как в ней используется устаревший API `addButtonToToolbar`, который создаёт виджеты только для десктопной версии.
> 
> Вместо этого пользовательский виджет панели запуска можно создать с помощью документации <a class="reference-link" href="../Launch%20Bar%20Widgets.md">Виджеты панели запуска</a>.

В этом примере мы расширим функциональность демонстрационного примера <a class="reference-link" href="../../../Advanced%20Usage/Advanced%20Showcases/Task%20Manager.md">Менеджер задач</a> (который поставляется по умолчанию с Trilium), добавив на <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">панель запуска</a> кнопку (<span class="tn-icon bx bx-task"></span>) для автоматического создания и открытия новой задачи.

## Создание заметки

1.  Сначала создайте новую заметку типа <a class="reference-link" href="../../../Note%20Types/Code.md">Код</a> с языком _JavaScript (Trilium frontend)_.
2.  Задайте метку `#run=frontendStartup` в разделе <a class="reference-link" href="../../../Advanced%20Usage/Attributes.md">Атрибуты</a>.

## Содержимое скрипта

Скопируйте и вставьте следующий скрипт:

```javascript
api.addButtonToToolbar({
	title: "New task",
    icon: "task",
    shortcut: "alt+n",
    action: async () => {
    	const taskNoteId = await api.runOnBackend(() => {
        	const todoRootNote = api.getNoteWithLabel("taskTodoRoot");
            const resp = api.createTextNote(todoRootNote.noteId, "New task", "")           
            return resp.note.noteId;
        });
        
        await api.waitUntilSynced();
        await api.activateNewNote(taskNoteId);
    }
});
```

## Проверка работы

Поскольку мы настроили запуск скрипта при старте, достаточно [обновить приложение](../../../Troubleshooting/Refreshing%20the%20application.md).

## Как работает скрипт

<table class="ck-table-resized">
    <colgroup>
        <col style="width:50%;">
        <col style="width:50%;">
    </colgroup>
    <tbody>
        <tr>
            <td><pre><code class="language-text-x-trilium-auto">api.addButtonToToolbar({
	title: "New task",
    icon: "task",
    shortcut: "alt+n",
    action: async () =&gt; {
    	// [...]
    }
});</code></pre></td>
            <td><p>Здесь используется <a href="../../Frontend%20Basics.md">фронтенд-API</a> для создания значка на&nbsp;<a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">панели запуска</a> с указанием:</p><ul><li>заголовка;</li><li>соответствующего значка boxicons (без префикса <code>bx-</code>);</li><li>необязательного сочетания клавиш;</li><li>действия, которое будет выполняться при нажатии на кнопку.</li></ul></td>
        </tr>
        <tr>
            <td><pre><code class="language-text-x-trilium-auto">const taskNoteId = await api.runOnBackend(() =&gt; {
    // Shown below.           
    return resp.note.noteId;
});</code></pre></td>
            <td><ul><li>Эта часть кода фактически выполняется на сервере (бэкенде), а не на клиенте (то есть в браузере).<ul><li>Причина в том, что за создание заметок отвечает сервер.</li></ul></li><li>Здесь также видно, что можно возвращать результаты выполнения с сервера и считывать их на клиенте (<code>taskNoteId</code>).</li></ul></td>
        </tr>
        <tr>
            <td><pre><code class="language-text-x-trilium-auto">const todoRootNote = api.getNoteWithLabel("taskTodoRoot");</code></pre></td>
            <td><ul><li>Здесь мы находим заметку с <a href="../../../Advanced%20Usage/Attributes.md">меткой</a> <code>#taskTodoRoot</code>. Именно так демонстрационный пример&nbsp;<a class="reference-link" href="../../../Advanced%20Usage/Advanced%20Showcases/Task%20Manager.md">Менеджер задач</a>&nbsp;узнаёт, куда помещать все задачи.</li><li>В обычной ситуации это может вернуть <code>null</code>, если такая заметка не найдена, но обработка ошибок выходит за рамки данного примера.&nbsp;</li></ul></td>
        </tr>
        <tr>
            <td><pre><code class="language-text-x-trilium-auto">const resp = api.createTextNote(todoRootNote.noteId, "New task", "")</code></pre></td>
            <td><ul><li>Мы создаём новую дочернюю заметку внутри корневой заметки задач (первый аргумент) с заголовком «New task» (второй аргумент) и пустым содержимым по умолчанию (третий аргумент).</li></ul></td>
        </tr>
        <tr>
            <td><pre><code class="language-text-x-trilium-auto">await api.waitUntilSynced();</code></pre></td>
            <td><ul><li>Вернувшись на клиент, поскольку мы создали новую заметку на сервере, нам нужно дождаться, пока это изменение отобразится на клиенте.</li></ul></td>
        </tr>
        <tr>
            <td><pre><code class="language-text-x-trilium-auto">await api.activateNewNote(taskNoteId);</code></pre></td>
            <td><ul><li>Поскольку нам известен <a href="../../../Advanced%20Usage/Note%20ID.md">ID</a> только что созданной заметки, остаётся только показать эту заметку пользователю.</li></ul></td>
        </tr>
    </tbody>
</table>