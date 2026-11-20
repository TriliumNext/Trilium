// Добавляет ярлык запуска на левую боковую панель
api.createOrUpdateLauncher({
    id: 'taskmanager',
    type: 'script',
    title: 'Новая задача',
    icon: 'bx-task',
    keyboardShortcut: 'alt+n',
    scriptNoteId: api.currentNote.getRelationValue('createNewTask'),
    isVisible: true
});