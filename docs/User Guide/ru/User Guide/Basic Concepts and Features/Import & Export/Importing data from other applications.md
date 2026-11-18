# Импорт данных из других приложений
Начиная с версии v0.104.0 импортёр Trilium был расширен специфичными для приложений импортами. В отличие от стандартного импорта/экспорта HTML или <a class="reference-link" href="Markdown.md">Markdown</a>, эти импортёры адаптированы для поддержки возможностей и структуры заметок конкретного приложения.

## Поддерживаемые приложения

*   <a class="reference-link" href="Importing%20data%20from%20other%20applications/Microsoft%20OneNote.md">Microsoft OneNote</a> — подключением к вашей учётной записи через Microsoft Graph.
*   <a class="reference-link" href="Importing%20data%20from%20other%20applications/Notion.md">Notion</a> — через ZIP-экспорт.
*   <a class="reference-link" href="Importing%20data%20from%20other%20applications/Google%20Keep.md">Google Keep</a> — через ZIP-экспорт из _Google Takeout_ (у Keep нет специального механизма экспорта).
*   <a class="reference-link" href="Importing%20data%20from%20other%20applications/Evernote.md">Evernote</a> — через ENEX-экспорт.
*   <a class="reference-link" href="Importing%20data%20from%20other%20applications/Anytype.md">Anytype</a> — через JSON-экспорт.
*   <a class="reference-link" href="Importing%20data%20from%20other%20applications/Obsidian.md">Obsidian</a> — через ZIP хранилища.

## Импорт данных из другого приложения

Чтобы импортировать из приложения, есть два способа доступа к диалогу импорта:

*   В <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Дереве заметок</a> щёлкните правой кнопкой по заметке и выберите _Импортировать в заметку_.
*   В <a class="reference-link" href="../UI%20Elements/Note%20menu.md">Меню заметки</a> выберите _Импортировать файлы_.

Вверху появится список поддерживаемых приложений, каждое со своей конфигурацией. Просто нажмите на одно и следуйте инструкциям на экране.

## Благодарности

*   Импортёр Trilium вдохновлён [плагином Importer](https://github.com/obsidianmd/obsidian-importer) Obsidian (лицензия MIT), например в части процесса подключения OneNote или управления ID Notion.
