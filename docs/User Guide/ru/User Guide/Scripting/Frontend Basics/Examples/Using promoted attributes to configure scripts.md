# Использование продвигаемых атрибутов для настройки скриптов
Хороший способ применения продвигаемых атрибутов — удобно задавать различные параметры, которые могут понадобиться скрипту, например входную и выходную заметки при обработке данных или флажок для изменения поведения скрипта.

![](Using%20promoted%20attributes%20to%20configure%20scripts_image.png)

## Использование флажков для переключения параметров

Вместо того чтобы просить пользователя менять логическое значение в коде скрипта, гораздо интуитивнее использовать для этого флажок в виде продвигаемого атрибута.

Для этого сначала определите продвигаемый атрибут:

```
#label:groupByExtension="promoted,alias=Group by extension,single,boolean"
```

Затем используйте его:

```javascript
const byExtension = api.currentNote.getLabelValue("groupByExtension") === "true";
if (byExtension) {
	// Do something.
}
```

Это будет одинаково хорошо работать как во фронтенд-, так и в бэкенд-скриптах.

## Использование связей для выбора заметок

Распространённый сценарий для скрипта — чтение данных из одной заметки и вывод результата в другую заметку. Для этого нужно определить следующие продвигаемые атрибуты:

```
#relation:input="promoted,alias=Input,single" #relation:output="promoted,alias=Output,single"
```

После этого можно добавить базовую обработку ошибок, чтобы убедиться, что пользователь заполнил поля:

```javascript
const inputNoteId = api.currentNote.getRelationValue("input");
if (!inputNoteId) {
	api.showError("Missing input.");
    return;
}

const outputNoteId = api.currentNote.getRelationValue("output");
if (!outputNoteId) {
    api.showError("Missing output.");
    return;
}
```

Обратите внимание, что здесь используется `api.showError`, который доступен только для фронтенд-заметок. Если вы пишете бэкенд-заметку, просто уберите `api.showError`, но тогда пользователь не получит уведомления о том, почему скрипт не выполнился корректно.

После этого можно просто прочитать заметку и выполнить с ней нужные действия:

```javascript
const note = api.getNote(inputNoteId);
if (!note) {
	return;
}
const content = note.getContent().toString("utf-8");
```