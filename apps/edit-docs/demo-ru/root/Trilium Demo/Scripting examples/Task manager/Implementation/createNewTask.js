// Создание заметок — задача серверной части, поэтому нужно передать
// управление туда
const taskNoteId = await api.runOnBackend(() => {
    const todoRootNote = api.getNoteWithLabel('taskTodoRoot');
    const resp = api.createTextNote(todoRootNote.noteId, 'Новая задача', '');

    return resp.note.noteId;
});

// Дождаться синхронизации интерфейса с изменениями, внесёнными выше на сервере
await api.waitUntilSynced();

// Получен идентификатор новой заметки; теперь её нужно отобразить
await api.activateNewNote(taskNoteId);