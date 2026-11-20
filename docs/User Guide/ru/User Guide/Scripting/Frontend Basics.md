# Основы фронтенда
Фронтенд-скрипты — это пользовательские JavaScript-заметки, которые выполняются на клиенте (в среде браузера).

Существует четыре разновидности фронтенд-скриптов:

<table>
    <tbody>
        <tr>
            <td>Обычные скрипты</td>
            <td>Выполняются в контексте текущего приложения и заметки. Их можно запускать вручную или автоматически при старте.</td>
        </tr>
        <tr>
            <td><a class="reference-link" href="Frontend%20Basics/Custom%20Widgets.md">Пользовательские виджеты</a></td>
            <td>Позволяют добавлять новые элементы интерфейса в различные области, например рядом с&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">деревом заметок</a>, в области содержимого или даже на&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar.md">правой боковой панели</a>.</td>
        </tr>
        <tr>
            <td><a class="reference-link" href="Frontend%20Basics/Launch%20Bar%20Widgets.md">Виджеты панели запуска</a></td>
            <td>Похожи на&nbsp;<a class="reference-link" href="Frontend%20Basics/Custom%20Widgets.md">пользовательские виджеты</a>, но предназначены специально для&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">панели запуска</a>. Они позволяют добавлять на панель новые кнопки или графические элементы.</td>
        </tr>
        <tr>
            <td><a class="reference-link" href="../Note%20Types/Render%20Note.md">Заметка рендеринга</a></td>
            <td>Позволяет отображать произвольное содержимое внутри заметки с использованием HTML или Preact JSX.</td>
        </tr>
    </tbody>
</table>

Для более сложной логики, не требующей пользовательского интерфейса (например, массового изменения заметок), см. <a class="reference-link" href="Backend%20scripts.md">Бэкенд-скрипты</a>.

## Скрипты

К обычным скриптам не предъявляется особых требований. Их можно запускать вручную с помощью кнопки _Execute_ (Выполнить) в заметке с кодом или автоматически — см. <a class="reference-link" href="Frontend%20Basics/Frontend%20Events.md">События фронтенда</a>.

## Виджеты

Виджеты должны соответствовать определённому формату, чтобы Trilium мог встроить их в интерфейс.

*   Для устаревших виджетов заметка со скриптом должна экспортировать `BasicWidget` или производный от него класс (см. <a class="reference-link" href="Frontend%20Basics/Custom%20Widgets/Note%20context%20aware%20widget.md">Виджет, учитывающий контекст заметки</a> или <a class="reference-link" href="Frontend%20Basics/Custom%20Widgets/Right%20pane%20widget.md">Виджет правой панели</a>).
*   Для виджетов на Preact необходимо использовать встроенную вспомогательную функцию `defineWidget`.

Подробнее см. в разделе <a class="reference-link" href="Frontend%20Basics/Custom%20Widgets.md">Пользовательские виджеты</a>.

## Script API

Фронтенд-API Trilium доступен всем скриптам, выполняющимся во фронтенд-контексте, через глобальную переменную `api`. Справочник по API см. в разделе <a class="reference-link" href="Script%20API/Frontend%20API.md">Frontend API</a>.

### Учебник

Подробнее о создании виджетов см. в руководстве [Основы виджетов](Frontend%20Basics/Custom%20Widgets/Widget%20Basics.md).