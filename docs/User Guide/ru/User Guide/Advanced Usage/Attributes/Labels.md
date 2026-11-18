# Метки
Метка — это [атрибут](../Attributes.md) заметки, имеющий имя и, опционально, значение.

## Типичные сценарии использования

*   **Метаданные для личного использования**: присваивайте метки с опциональными значениями для категоризации, например `#year=1999`, `#genre="sci-fi"` или `#author="Neal Stephenson"`. Это можно сочетать с <a class="reference-link" href="Promoted%20Attributes.md">Продвигаемыми атрибутами</a>, чтобы сделать их отображение более удобным.
*   **Конфигурация**: метки могут настраивать расширенные возможности или параметры (см. справочник ниже).
*   **Скрипты и плагины**: используются для пометки заметок специальными метаданными, например атрибутом «вес» в <a class="reference-link" href="../Advanced%20Showcases/Weight%20Tracker.md">Трекере веса</a>.

## Создание метки в визуальном редакторе

1.  Откройте <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar/Attributes%20tab.md">Вкладку атрибутов</a> в <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar.md">Правой боковой панели</a>.
2.  Нажмите кнопку <span class="tn-icon bx bx-plus"></span> (Добавить атрибут) в конце списка или кнопку <span class="tn-icon bx bx-plus"></span> в правом верхнем углу раздела → _Добавить новую метку_.

В визуальном редакторе:

*   Задайте нужное имя.
*   Опционально задайте значение метки. Метки могут существовать без значения.
*   Дочерние заметки могут наследовать это отношение — нажмите на отношение и отметьте _Наследуемый_. Подробнее см. <a class="reference-link" href="Attribute%20Inheritance.md">Наследование атрибутов</a>.

> [!TIP]
> Альтернативно нажмите <kbd>Alt</kbd>+<kbd>L</kbd> — откроются детали атрибута (тот же вид, что и при нажатии на существующий атрибут) в <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Status%20bar.md">Строке состояния</a>.

## Создание метки вручную

В <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Status%20bar.md">Строке состояния</a> нажмите кнопку <span class="tn-icon bx bx-list-check"></span>, чтобы показать список атрибутов.

*   Нажмите на поле ввода, чтобы сфокусировать его.
*   Чтобы создать метку с именем `myLabel` без значения, просто введите `#myLabel`.
*   Чтобы создать метку с именем `myLabel` и значением `value`, просто введите `#myLabel=value`.
*   Если значение содержит пробелы, текст нужно заключить в кавычки: `#myLabel="Hello world"`.
*   Если строка содержит кавычки (независимо от пробелов), текст нужно заключить в апострофы: `#myLabel='Hello "world"'`.
*   Чтобы создать наследуемую метку с именем `myLabel`, просто напишите `#myLabel(inheritable)` без значения или `#myLabel(inheritable)=value`, если значение есть.

## Предопределённые метки

Это список меток, которые Trilium поддерживает нативно.

> [!TIP]
> Некоторые приведённые здесь метки заканчиваются на `*`. Это означает, что существует несколько меток с тем же префиксом; подробности см. на странице, указанной в описании такой метки.

| Метка | Описание |
| --- | --- |
| `disableVersioning` | Отключает автоматическое создание <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20Revisions.md">Ревизий заметки</a> для конкретной заметки. Полезно, например, для больших, но неважных заметок — например, больших JS-библиотек, используемых в скриптах. |
| `versioningLimit` | Ограничивает максимальное количество <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20Revisions.md">Ревизий заметки</a> для конкретной заметки, переопределяя глобальные настройки. |
| `calendarRoot` | Помечает заметку, которая должна использоваться как корень <a class="reference-link" href="../Advanced%20Showcases/Day%20Notes.md">Заметок дня</a>. Такой должна быть только одна. |
| `archived` | Скрывает заметки из результатов поиска по умолчанию и диалогов. Архивные заметки можно дополнительно скрыть в <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Дереве заметок</a>. |
| `excludeFromExport` | Исключает эту заметку и её дочерние заметки при экспорте. |
| `run`, `runOnInstance`, `runAtHour` | См. <a class="reference-link" href="../../Scripting/Backend%20scripts/Backend%20Events.md">Серверные события</a>. |
| `disableInclusion` | Скрипты с этой меткой не будут включены в выполнение родительского скрипта. |
| `sorted`, `sortDirection`, `sortFoldersFirst`, `sortNatural`, `sortLocale`, `top`, `bottom` | Управляет автоматической/постоянной сортировкой. См. <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Sorting%20Notes.md">Сортировка заметок</a>. |
| `hidePromotedAttributes` | Скрывает <a class="reference-link" href="Promoted%20Attributes.md">Продвигаемые атрибуты</a> на этой заметке. Обычно полезно при определении наследуемых атрибутов, когда родительской заметке они не нужны. |
| `readOnly` | Помечает заметку всегда [доступной только для чтения](../../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md), если это поддерживаемый тип заметки (текст, код, mermaid). |
| `autoReadOnlyDisabled` | Отключает автоматический [режим только для чтения](../../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md) для данной заметки. |
| `appCss` | Помечает CSS-заметки, которые загружаются в приложение Trilium и таким образом могут изменять его внешний вид. Подробнее см. <a class="reference-link" href="../../Theme%20development/Custom%20app-wide%20CSS.md">Пользовательский CSS для всего приложения</a>. |
| `appTheme` | Помечает CSS-заметки, которые являются полноценными темами Trilium и таким образом доступны в настройках Trilium. Подробнее см. <a class="reference-link" href="../../Theme%20development">Разработка тем</a>. |
| `appThemeBase` | Установите в `next`, `next-light` или `next-dark`, чтобы использовать соответствующую тему TriliumNext (авто, светлую или тёмную) как основу пользовательской темы вместо устаревшей. Подробнее см. <a class="reference-link" href="../../Theme%20development/Customize%20the%20Next%20theme.md">Настройка темы Next</a>. |
| `customFont` | Помечает шрифт, доступный для выбора в Настройки → Внешний вид. См. <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Themes/Personalizing%20the%20font.md">Персонализация шрифта</a>. |
| `cssClass` | Значение этой метки добавляется как CSS-класс к узлу, представляющему данную заметку в <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Дереве заметок</a>. Это может быть полезно для продвинутой настройки тем. Можно использовать в шаблонах заметок. |
| `iconClass` | Значение этой метки добавляется как CSS-класс к значку в дереве, что помогает визуально различать заметки в дереве. Пример: bx bx-home — значки берутся из boxicons. Можно использовать в шаблонах заметок. |
| `pageSize` | Задаёт количество элементов на странице в <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20List.md">Списке заметок</a>. |
| `customRequestHandler` | См. <a class="reference-link" href="../Custom%20Request%20Handler.md">Пользовательский обработчик запросов</a>. |
| `customResourceProvider` | См. <a class="reference-link" href="../Custom%20Resource%20Providers.md">Пользовательские поставщики ресурсов</a>. |
| `widget` | Помечает эту заметку как пользовательский виджет, который будет добавлен в дерево компонентов Trilium. Подробнее см. <a class="reference-link" href="../../Scripting/Frontend%20Basics/Custom%20Widgets.md">Пользовательские виджеты</a>. |
| `searchHome` | Новые заметки поиска будут созданы как дочерние этой заметки (см. <a class="reference-link" href="../../Note%20Types/Saved%20Search.md">Сохранённый поиск</a>). |
| `workspace` и связанные атрибуты | См. <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Navigation/Workspaces.md">Рабочие области</a>. |
| `inbox` | Местоположение входящих заметок по умолчанию для новых заметок. Подробнее см. <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20Inbox.md">Входящие заметки</a>. |
| `sqlConsoleHome` | Местоположение сохранённых запросов <a class="reference-link" href="../Database/Manually%20altering%20the%20database/SQL%20Console.md">SQL-консоли</a> по умолчанию. |
| `bookmarked` | Указывает, что эта заметка — [закладка](../../Basic%20Concepts%20and%20Features/Navigation/Bookmarks.md). |
| `bookmarkFolder` | Заметка с этой меткой появится в закладках или на панели запуска при перетаскивании на неё как папка (давая доступ к дочерним заметкам). Пункт _Показывать как папку_ в контекстном меню кнопки переключает это. Подробнее см. <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Navigation/Bookmarks.md">Закладки</a>. |
| `bookmarkOpenMode` | Где открывает щелчок по кнопке заметки на панели запуска: `currentTab` (по умолчанию), `newTab`, `newSplit`, `newWindow` или `quickEdit`. Применяется к закладкам, заметкам, перетащенным на панель запуска, и заметкам в папке закладок. Подменю _Режим открытия_ в контекстном меню кнопки задаёт его как наследуемую метку на папке, чтобы заметки в ней ему следовали. Подробнее см. <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Navigation/Bookmarks.md">Закладки</a>. |
| `share*` | См. справочник атрибутов в разделе <a class="reference-link" href="../Sharing.md">Публикация (Sharing)</a>. |
| `displayRelations`, `hideRelations` | Имена отношений через запятую, которые должны отображаться/скрываться в <a class="reference-link" href="../../Note%20Types/Relation%20Map.md">Карте отношений</a> (и в общей функциональности <a class="reference-link" href="../Note%20Map%20(Link%20map%2C%20Tree%20map).md">Карты заметок (Link map, Tree map)</a>). |
| `titleTemplate` | Заголовок по умолчанию для заметок, создаваемых как дочерние этой заметки. Значение вычисляется как JavaScript-строка и поэтому может обогащаться динамическим содержимым через внедрённые переменные `now` и `parentNote`.       <br>  <br>Подробнее см. <a class="reference-link" href="../Default%20Note%20Title.md">Заголовок заметки по умолчанию</a>. |
| `template:titleTemplate` | Задаётся на заметке-шаблоне: заголовок по умолчанию заметок, создаваемых из шаблона, имеет приоритет над `titleTemplate` родителя. Вычисляется так же, как `titleTemplate`. См. <a class="reference-link" href="../Default%20Note%20Title.md">Заголовок заметки по умолчанию</a>. |
| `template` | Эта заметка появится в выборе доступных шаблонов при создании новой заметки. Подробнее см. <a class="reference-link" href="../Templates.md">Шаблоны</a>. |
| `color` | Задаёт цвет заметки в дереве заметок, ссылках и т.д. Используйте любое допустимое CSS-значение цвета, например 'red' или #a13d5f.        <br>Примечание: цвет может быть автоматически скорректирован при отображении для обеспечения достаточного контраста с фоном. |
| `keyboardShortcut` | Задаёт сочетание клавиш, по которому происходит немедленный переход к этой заметке. Пример: 'ctrl+alt+e'. Требуется перезагрузка клиента, чтобы изменение вступило в силу. |
| `keepCurrentHoisting` | Открытие этой ссылки не изменит хостинг (hoisting), даже если заметку нельзя отобразить в текущем поддереве хостинга. |
| `executeButton` | Заголовок кнопки, которая выполнит текущую кодовую заметку |
| `executeDescription` | Более длинное описание текущей кодовой заметки, отображаемое вместе с кнопкой выполнения |
| `excludeFromNoteMap` | Заметки с этой меткой будут скрыты из <a class="reference-link" href="../../Note%20Types/Note%20Map.md">Карты заметок</a>. |
| `excludeFromLlm` | Скрывает эту заметку от ИИ-чата и MCP-сервера. Сделайте её наследуемой, чтобы скрыть и заметки ниже. См. <a class="reference-link" href="../../AI/Privacy.md">Конфиденциальность</a>. |
| `newNotesOnTop` | Новые заметки будут создаваться вверху родительской заметки, а не внизу. |
| `hideChildrenOverview` | Скрывает <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20List.md">Список заметок</a> для этой конкретной заметки. |
| `subtreeHidden` | Скрывает все дочерние заметки этой заметки из дерева, показывая значок с количеством скрытых дочерних заметок. Дочерние заметки остаются доступны через поиск или прямые ссылки. |
| `printLandscape` | При экспорте в PDF изменяет ориентацию страницы на альбомную вместо портретной. |
| `printPageSize` | При экспорте в PDF изменяет размер страницы. Поддерживаемые значения: `A0`, `A1`, `A2`, `A3`, `A4`, `A5`, `A6`, `Legal`, `Letter`, `Tabloid`, `Ledger`. |
| `printScale`, `printMargins` | Дополнительные параметры печати, обычно настраиваются через диалог <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Printing%20%26%20Exporting%20as%20PDF.md">Печать и экспорт в PDF</a>. |
| `geolocation` | Указывает широту и долготу заметки для отображения на <a class="reference-link" href="../../Collections/Geo%20Map.md">Геокарте</a>. |
| `geoShape` | Указывает координаты точек [фигуры](../../Collections/Geo%20Map/Drawing%20shapes.md), нарисованной на <a class="reference-link" href="../../Collections/Geo%20Map.md">Геокарте</a> (например, области, прямоугольника, круга). |
| `map:*` | Задаёт определённые опции для <a class="reference-link" href="../../Collections/Geo%20Map.md">Геокарты</a>. |
| `calendar:*` | Задаёт определённые опции для <a class="reference-link" href="../../Collections/Calendar.md">Календаря</a>. |
| `viewType` | Задаёт вид дочерних заметок (например, сетка или список). Подробнее см. <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20List.md">Список заметок</a>. |
| `webViewSrc` | Задаёт URL для <a class="reference-link" href="../../Note%20Types/Web%20View.md">Веб-представления (Web View)</a>. |
| `tabWidth`, `indentWithTabs`, `wrapLines` | Настройки редактора кода для отдельной заметки: ширина отступа, отступы табуляцией или пробелами и перенос строк. См. <a class="reference-link" href="../../Note%20Types/Code.md">Код</a>. |
| `datePattern`, `weekPattern`, `monthPattern`, `quarterPattern`, `yearPattern` | Настраивает шаблон именования заголовков заметок дня / недели / месяца / квартала / года. См. <a class="reference-link" href="../Advanced%20Showcases/Day%20Notes.md">Заметки дня</a>. |
| `enableWeekNote`, `enableQuarterNote` | Включает опциональные заметки недели и квартала в иерархии календаря; задаётся на корне календаря. См. <a class="reference-link" href="../Advanced%20Showcases/Day%20Notes.md">Заметки дня</a>. |
| `fullContentWidth` | Расширяет заметку на полную ширину редактора, игнорируя настроенную ширину содержимого (полезно для широких таблиц). См. <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Content%20width.md">Ширина содержимого</a>. |
| `iconPack` | Идентифицирует пользовательский набор значков по его префиксу. См. <a class="reference-link" href="../../Theme%20development/Creating%20an%20icon%20pack.md">Создание набора значков</a>. |
| `clipperInbox` | Переопределяет местоположение по умолчанию, куда Web Clipper сохраняет вырезки (по умолчанию — заметка дня). См. <a class="reference-link" href="../../Installation%20%26%20Setup/Web%20Clipper.md">Web Clipper</a>. |
| `docName` , `docUrl` | Используются внутренне для встроенной справки. |
| `aiQuickAction` | Задаёт пользовательский промпт для быстрых действий <a class="reference-link" href="../../Note%20Types/Text/In-editor%20AI%20assistant.md">встроенного ИИ-ассистента</a>. |
