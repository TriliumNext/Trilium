return api.res.send(404);

/**
 * Чтобы активировать этот пример, закомментируйте (или удалите) самую первую строку этой заметки типа «Код». 
 * Обработчик отключён, поскольку подобные пользовательские обработчики запросов могут представлять угрозу безопасности.
 * Для проверки выполните следующий запрос curl: curl -X POST http://localhost:37740/custom/create-note -H "Content-Type: application/json" -d "{ \"secret\": \"secret-password\", \"title\": \"hello\", \"content\": \"world\" }"
 * (в зависимости от конфигурации может потребоваться изменить адрес узла и порт)
 *
 * Подробнее: https://github.com/zadam/trilium/wiki/Custom-request-handler.
 */

const {req, res} = api;
const {secret, title, content} = req.body;

if (req.method == 'POST' && secret === 'secret-password') {
    // заметки необходимо сохранять в дереве под указанной родительской заметкой. 
    // Это задаётся связью из данной заметки типа «Код» с родительской заметкой «target».
    // В качестве более простого варианта можно указать постоянный noteId (его можно узнать в окне «Информация о заметке» для нужной родительской заметки).
    const targetParentNoteId = api.currentNote.getRelationValue('targetNote');
    
    const {note} = api.createTextNote(targetParentNoteId, title, content);
    const notePojo = note.getPojo();

    res.status(201).json(notePojo);
}
else {
    res.send(400);
}