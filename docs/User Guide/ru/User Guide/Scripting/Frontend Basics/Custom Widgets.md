# Пользовательские виджеты
Пользовательские виджеты — это особая разновидность скриптов, отображающих графические элементы в определённых частях приложения. Их можно использовать для добавления новой функциональности в Trilium.

## Preact с JSX против обычного jQuery

В более старых версиях Trilium пользовательские виджеты писались исключительно с использованием jQuery и внутренней архитектуры виджетов Trilium (например, `BasicWidget`, `NoteContextAwareWidget`).

Начиная с v0.101.0, пользовательские виджеты также можно писать на JSX с использованием фреймворка <a class="reference-link" href="Preact.md">Preact</a>. Устаревшие виджеты и виджеты Preact обладают одинаковыми возможностями, с одним отличием:

*   Виджеты Preact по умолчанию подстраиваются под размер содержимого, тогда как для устаревших виджетов требуется вызывать `this.contentSized()` в конструкторе. Подробнее см. в соответствующем разделе <a class="reference-link" href="Custom%20Widgets/Troubleshooting.md">Устранения неполадок</a>.

Где это возможно, примеры виджетов приводятся как в устаревшем формате, так и в формате Preact.

## Создание пользовательского виджета

Самый быстрый способ — выбрать _Вставить дочернюю заметку_ → _Код_ → _Виджет_ в <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree/Note%20tree%20contextual%20menu.md">контекстном меню дерева заметок</a>. Это создаст JSX-заметку с меткой `#widget` и минимальным шаблоном виджета Preact.

Чтобы настроить виджет вручную:

1.  Создайте <a class="reference-link" href="../../Note%20Types/Code.md">заметку с кодом</a>.
2.  Установите язык:
    1.  JavaScript (frontend) — для устаревших виджетов на jQuery.
    2.  JSX — для виджетов Preact. Возможно, сначала потребуется включить этот язык в Настройках → Код.
3.  Добавьте [метку](../../Advanced%20Usage/Attributes/Labels.md) `#widget`.

## Начало работы с простым примером

Начнём с создания виджета, который показывает сообщение рядом с областью содержимого. Следуйте предыдущему разделу, чтобы создать заметку с кодом, и вставьте следующее содержимое.

=== "<span class="tn-icon bx bxl-react"></span> Preact"

    ```
    import { defineWidget } from "trilium:preact";

    export default defineWidget({
        parent: "center-pane",
        render: () => <span>Center pane from Preact.</span>
    });
    ```

=== "<span class="tn-icon bx bxl-javascript"></span> Legacy"

    ```
    class HelloCenterPane extends api.BasicWidget {

        constructor() {
            super();
            this.contentSized();
        }

        get parentWidget() { return "center-pane" }

        doRender() {
            this.$widget = $("<span>Center pane</span>");
        }
        
    }

    module.exports = new HelloCenterPane();
    ```

[Обновите приложение](../../Troubleshooting/Refreshing%20the%20application.md), и виджет появится под областью содержимого.

## Расположение виджета (родительский виджет)

Виджет можно разместить в одной из следующих областей приложения:

<table class="ck-table-resized">
    <colgroup>
        <col style="width:15.59%;">
        <col style="width:30.42%;">
        <col style="width:16.68%;">
        <col style="width:37.31%;">
    </colgroup>
    <thead>
        <tr>
            <th>Значение для <code>parentWidget</code></th>
            <th>Описание</th>
            <th>Пример виджета</th>
            <th>Особые требования</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <th><code>left-pane</code></th>
            <td>Отображается в той же панели, где находится&nbsp;<a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Дерево заметок</a>.</td>
            <td>То же, что и выше, но с другим значением <code>parentWidget</code>.</td>
            <td>Нет.</td>
        </tr>
        <tr>
            <th><code>center-pane</code></th>
            <td>В области содержимого. Если открыто разделение экрана, виджет будет охватывать все разделённые области.</td>
            <td>См. пример выше.</td>
            <td>Нет.</td>
        </tr>
        <tr>
            <th><code>note-detail-pane</code></th>
            <td><p>В области содержимого, внутри области деталей заметки. Если открыто разделение экрана, виджет будет находиться внутри конкретной разделённой области.</p><p>Идеально подходит, если виджет привязан к конкретной заметке.</p></td>
            <td><a class="reference-link" href="Custom%20Widgets/Note%20context%20aware%20widget.md">Виджет, отслеживающий контекст заметки</a></td>
            <td><ul><li>Виджет должен экспортировать <code>class</code>, а не экземпляр класса (то есть без <code>new</code>), поскольку его нужно создавать отдельно для каждой заметки, чтобы разделение экрана работало корректно.</li><li>Поскольку экспортируется <code>class</code>, а не экземпляр, геттер <code>parentWidget</code> должен быть <code>static</code>, иначе виджет будет проигнорирован.</li></ul></td>
        </tr>
        <tr>
            <th><code>right-pane</code></th>
            <td>На&nbsp;<a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar.md">Правой боковой панели</a> в виде отдельного раздела.</td>
            <td><a class="reference-link" href="Custom%20Widgets/Right%20pane%20widget.md">Виджет правой панели</a></td>
            <td><ul><li>Хотя это не обязательно, лучше использовать <code>RightPanelWidget</code> вместо <code>BasicWidget</code> или <code>NoteContextAwareWidget</code>.</li></ul></td>
        </tr>
    </tbody>
</table>

Чтобы разместить виджет в другом месте, просто измените значение, возвращаемое `get parentWidget()` (для устаревших виджетов), или поле `parent` (для Preact). Учтите, что для некоторых расположений, таких как `note-detail-pane` и `right-pane`, действуют особые требования (см. таблицу выше).

## Несколько виджетов в одной заметке

Обычно заметка-виджет возвращает один виджет, но она также может возвращать массив виджетов. Это удобно, когда несколько виджетов используют общий код или состояние, так как все они могут находиться в одной заметке, а не разделяться на несколько заметок с общим модулем.

Каждый виджет в массиве регистрируется отдельно, поэтому у них могут быть разные родительские панели и позиции. Если у какого-то виджета отсутствует `parentWidget` (или `parent` в Preact), об этом сообщается как об ошибке, не затрагивая остальные виджеты в заметке.

=== "<span class="tn-icon bx bxl-react"></span> Preact"

    ```
    import { defineWidget } from "trilium:preact";

    export default [
        defineWidget({
            parent: "left-pane",
            render: () => <span>Left pane from Preact.</span>
        }),
        defineWidget({
            parent: "right-pane",
            render: () => <span>Right pane from Preact.</span>
        })
    ];
    ```

=== "<span class="tn-icon bx bxl-javascript"></span> Legacy"

    ```
    class TreeWidget extends api.BasicWidget {
        get parentWidget() { return "left-pane"; }
        doRender() { this.$widget = $("<span>Left pane</span>"); }
    }

    class SidebarWidget extends api.BasicWidget {
        get parentWidget() { return "right-pane"; }
        doRender() { this.$widget = $("<span>Right pane</span>"); }
    }

    module.exports = [ new TreeWidget(), new SidebarWidget() ];
    ```

## Виджеты панели запуска

Виджеты панели запуска похожи на _пользовательские виджеты_, но предназначены специально для <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">панели запуска</a>. Подробнее см. в разделе <a class="reference-link" href="Launch%20Bar%20Widgets.md">Виджеты панели запуска</a>.

## Пользовательская позиция

Позиция пользовательского виджета задаётся целым числом `position`.

=== "<span class="tn-icon bx bxl-react"></span> Preact"

    ```
    export default defineWidget({
        // [...]
        position: 10
    });
    ```

=== "<span class="tn-icon bx bxl-javascript"></span> Legacy"

    ```
    class MyWidget extends api.BasicWidget {
    	// [..
    	get position() { return 10; }
    }
    ```