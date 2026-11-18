# Скрытые заметки
<figure class="image image-style-align-right"><img style="aspect-ratio:263/445;" src="Hidden Notes_image.png" width="263" height="445"></figure>

Для лёгкой расширяемости многие возможности Trilium используют настоящие заметки для хранения информации вместо того, чтобы хранить её в отдельном месте базы данных. Это позволяет таким функциям, как <a class="reference-link" href="Attributes.md">Атрибуты</a>, <a class="reference-link" href="Attributes/Relations.md">Отношения</a> или даже <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Search.md">Поиск</a> и <a class="reference-link" href="../Note%20Types/Text/Links.md">Ссылки</a>, работать с ними.

Как следует из названия, эти заметки по умолчанию скрыты от пользователя, чтобы не загромождать дерево заметок и предотвратить их случайное удаление.

Скрытые заметки хранятся в <a class="reference-link" href="Database.md">Базе данных</a> пользователя как обычные заметки, но имеют уникальный <a class="reference-link" href="Note%20ID.md">ID заметки</a>, позволяющий отличить их от обычных.

## Доступ к дереву скрытых заметок

В <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Глобальном меню</a> выберите _Дополнительно_ → _Скрытые заметки_.

## Содержимое дерева скрытых заметок

Вот краткая сводка всех заметок внутри скрытого дерева:

<table class="ck-table-resized">
    <colgroup>
        <col style="width:19.93%;">
        <col style="width:80.07%;">
    </colgroup>
    <thead>
        <tr>
            <th>Заметка</th>
            <th>Описание</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_globalNoteMap">Карта заметок</a></td>
            <td><p>Эта заметка фактически открывается, когда используется возможность <a class="reference-link" href="../Note%20Types/Note%20Map.md">Карта заметок</a>, доступная из <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Панели запуска</a>.</p><p>В ней можно создавать любые дочерние заметки без дополнительного смысла. Например, её можно использовать для хранения списка карт заметок, на которые можно ссылаться из других заметок или которые можно <a href="../Basic%20Concepts%20and%20Features/Navigation/Bookmarks.md">добавить в закладки</a>.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_sqlConsole">История SQL-консоли</a></td>
            <td><p>Когда в <a class="reference-link" href="Database/Manually%20altering%20the%20database/SQL%20Console.md">SQL-консоли</a> выполняются запросы или команды, они сохраняются здесь, сгруппированные по месяцам. Сохраняется только запрос, а не результаты.</p><p>К этому разделу можно получить доступ без перехода в скрытое дерево, открыв <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Глобальное меню</a> и выбрав Дополнительно → История SQL-консоли.</p><p>Заметки можно добавлять как дочерние этого дерева, но обычно не рекомендуется этого делать, чтобы не мешать обычному процессу ведения истории.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_search">История поиска</a></td>
            <td><p>При каждом выполнении поиска из полного <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Search.md">Поиска</a> запрос сохраняется здесь, сгруппированный по месяцам. Сохраняются только параметры поиска, а не сами результаты.</p><p>К этому разделу можно получить доступ без перехода в скрытое дерево, открыв <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Глобальное меню</a> и выбрав Дополнительно → История поиска.</p><p>Заметки можно добавлять как дочерние этого дерева, но обычно не рекомендуется этого делать, чтобы не мешать обычному процессу ведения истории.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_bulkAction">Массовые действия</a></td>
            <td><p>Этот раздел используется для <a class="reference-link" href="Bulk%20Actions.md">Массовых действий</a>. Последняя конфигурация массовых действий сохраняется как часть этой заметки, каждое действие в собственной метке <code>action</code>.</p><p>Заметки можно добавлять как дочерние этого дерева, но пользы в этом не будет.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_backendLog">Журнал сервера</a></td>
            <td><p>Эта заметка соответствует возможности журнала сервера (см. <a class="reference-link" href="../Troubleshooting/Error%20logs.md">Журналы ошибок</a>).</p><p>К этому элементу можно получить доступ без перехода в скрытое дерево, открыв <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Глобальное меню</a> и выбрав Дополнительно → Журнал сервера.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_userHidden">Скрытое пользователем</a></td>
            <td>Этот раздел могут использовать <a href="../Scripting.md">скрипты</a> для создания собственных заметок, которые не должны быть напрямую видимы пользователю. Скрипты могут опознать заметку по её уникальному ID: <code>_userHidden</code></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_lbTplRoot">Шаблоны панели запуска</a></td>
            <td><p>Этот раздел содержит шаблоны для создания элементов запуска в <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Панели запуска</a>. Здесь нельзя создавать дочерние заметки.</p><p>Теоретически некоторые заметки здесь можно настроить, но особой пользы в этом нет.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_share">Опубликованные заметки</a></td>
            <td><p>Это дерево перечисляет все заметки, <a href="Sharing.md">опубликованные</a> публично. Оно может быть полезно для отслеживания того, какие заметки опубликованы независимо от их положения в дереве заметок.</p><p>К этому разделу можно получить доступ без перехода в скрытое дерево, открыв <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Глобальное меню</a> и выбрав <em>Дополнительно</em> → <em>Опубликованные заметки</em>.</p><p>Здесь нельзя создавать подзаметки.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_lbRoot">Панель запуска</a></td>
            <td><p>Это дерево содержит как доступные, так и отображаемые элементы <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Панели запуска</a>.</p><p>К этому разделу можно получить доступ без перехода в скрытое дерево:</p><ul><li>Открыв <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Глобальное меню</a> и выбрав <em>Настроить панель запуска…</em>.</li><li>Щёлкнув правой кнопкой по пустому месту <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Панели запуска</a> и выбрав <em>Настроить панель запуска…</em>.</li></ul><p>Здесь нельзя создавать подзаметки.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_options">Настройки</a></td>
            <td><p>Этот раздел хранит список <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настроек</a>.</p><p>К этому разделу можно получить доступ без перехода в скрытое дерево:</p><ul><li>Открыв <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Глобальное меню</a> и выбрав <em>Настройки</em>.</li><li>Нажав значок Настроек на <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Панели запуска</a>.</li></ul></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_lbMobileRoot">Мобильная панель запуска</a></td>
            <td><p>Это очень похоже на <em>Панель запуска</em>, но предназначено только для мобильного интерфейса.</p><p>Доступ к ней вне <em>Панели запуска</em> тот же, что и у Панели запуска, но выполняется из мобильного интерфейса.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_help">Руководство пользователя</a></td>
            <td>Здесь Руководство пользователя появляется в дереве заметок. Его заметки не хранятся в базе данных: Trilium строит их из файлов, поставляемых с приложением, при каждом запуске, поэтому их нельзя редактировать, перемещать или клонировать, и они не синхронизируются.</td>
        </tr>
    </tbody>
</table>
