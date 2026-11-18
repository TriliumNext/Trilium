# Пользовательский обработчик запросов
Trilium предоставляет механизм для открытия публичного REST-endpoint из [скриптов](../Scripting.md). Это открывает путь к различным интеграциям с другими сервисами — простой пример: создание заметки из Slack с помощью слэш-команды (например, `/trilium buy milk`).

## Создание заметки извне Trilium

Посмотрим на пример. Цель — предоставить REST-endpoint, на который можно отправить заголовок и содержимое, а Trilium создаст заметку.

Начнём с создания серверной JavaScript [кодовой заметки](../Note%20Types/Code.md), содержащей:

```
const {req, res} = api;
const {secret, title, content} = req.body;

if (req.method == 'POST' && secret === 'secret-password') {
    // notes must be saved somewhere in the tree hierarchy specified by a parent note. 
    // This is defined by a relation from this code note to the "target" parent note
    // alternatively you can just use constant noteId for simplicity (get that from "Note info" dialog of the desired parent note)
    const targetParentNoteId = api.currentNote.getRelationValue('targetNote');
    
    const {note} = api.createTextNote(targetParentNoteId, title, content);
    const notePojo = note.getPojo();

    res.status(201).json(notePojo);
}
else {
    res.send(400);
}
```

У этой скриптовой заметки также есть два атрибута:

*   метка `#customRequestHandler` со значением `create-note`
*   отношение `~targetNote`, указывающее на заметку, куда должны сохраняться новые заметки

### Пояснение

Проверим это с помощью HTTP-клиента, отправив запрос:

```
POST http://your-trilium-server/custom/create-note
Content-Type: application/json

{
  "secret": "secret-password",
  "title": "hello",
  "content": "world"
}+++++++++++++++++++++++++++++++++++++++++++++++
```

Обратите внимание на часть `/custom` в пути запроса — Trilium считает любой запрос с этим префиксом «пользовательским» и пытается найти подходящий обработчик, просматривая все заметки с меткой `customRequestHandler`. Значение этой метки содержит регулярное выражение, которое сопоставляется с путём запроса (в нашем случае тривиальное регулярное выражение «create-note»).

Затем Trilium найдёт созданную выше кодовую заметку и выполнит её. `api.req`, `api.res` устанавливаются в объекты [request](https://expressjs.com/en/api.html#req) и [response](https://expressjs.com/en/api.html#res), из которых можно получить детали запроса и также ответить.

В кодовой заметке мы проверяем метод запроса и используем тривиальную аутентификацию — имейте в виду, что эти endpoints по умолчанию полностью неаутентифицированы, и о безопасности нужно позаботиться самостоятельно.

Пройдя эти проверки, мы создаём нужную заметку с помощью [Script API](../Scripting/Script%20API.md).

## Пользовательский поставщик ресурсов

Другой распространённый сценарий — просто отдать файл-заметку: в этом случае создайте метку `customResourceProvider` (значение — снова регулярное выражение пути).

Подробнее см. [Пользовательские поставщики ресурсов](Custom%20Resource%20Providers.md).

## Продвинутые концепции

`api.req` и `api.res` — это объекты Express.js; подробности всегда можно найти в его [документации](https://expressjs.com/en/api.html).

### Параметры

Пути REST-запросов часто содержат параметры в URL, например:

```
http://your-trilium-server/custom/notes/123
```

Последняя часть динамическая, поэтому сопоставление URL также должно быть динамическим — поэтому сопоставление выполняется регулярными выражениями. Следующее значение `customRequestHandler` сопоставилось бы с ним:

```
notes/([0-9]+)
```

Кроме того, это определяет группу совпадения с помощью круглых скобок, что упрощает извлечение значения. Совпавшие группы доступны в `api.pathParams`:

```
const noteId = api.pathParams[0];
```

Часто нужны также параметры запроса (как в `http://your-trilium-server/custom/notes?noteId=123`); их можно получить через стандартный express `req.query.noteId`.
