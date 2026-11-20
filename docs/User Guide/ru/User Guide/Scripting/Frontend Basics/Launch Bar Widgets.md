# Виджеты панели запуска
Виджеты панели запуска — это разновидность <a class="reference-link" href="Custom%20Widgets.md">пользовательских виджетов</a>, которые позволяют отображать собственные кнопки и виджеты внутри <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">панели запуска</a>.

## Создание виджета панели запуска для десктопной компоновки

В отличие от <a class="reference-link" href="Custom%20Widgets.md">пользовательских виджетов</a>, процесс настройки виджета панели запуска немного отличается:

1.  Создайте заметку типа «Код» с языком _JavaScript (front-end)_ или JSX (для виджетов на базе Preact).
    *   Сам скрипт использует те же концепции, что и <a class="reference-link" href="Custom%20Widgets.md">пользовательские виджеты</a>, включая использование `NoteContextAwareWidget` или `BasicWidget` (в зависимости от задачи).
    *   Примеры в устаревшем формате и в формате Preact см. на страницах <a class="reference-link" href="Launch%20Bar%20Widgets/Note%20Title%20Widget.md">Виджет заголовка заметки</a> и <a class="reference-link" href="Launch%20Bar%20Widgets/Analog%20Watch.md">Аналоговые часы</a>.
2.  Не добавляйте `#widget`, так как этот атрибут зарезервирован для <a class="reference-link" href="Custom%20Widgets.md">пользовательских виджетов</a>.
3.  В <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">глобальном меню</a> выберите _Configure launchbar_ (Настроить панель запуска).
4.  В разделе _Visible Launchers_ (Видимые элементы запуска) выберите _Add a custom widget_ (Добавить пользовательский виджет).
5.  Задайте новому элементу панели запуска название.
6.  В разделе <a class="reference-link" href="../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">продвигаемых атрибутов</a> измените поле _widget_, чтобы оно указывало на созданную заметку.
7.  [Обновите](../../Troubleshooting/Refreshing%20the%20application.md) интерфейс.

## Мобильная компоновка

Пользовательские виджеты панели запуска также поддерживаются в <a class="reference-link" href="../../Installation%20%26%20Setup/Mobile%20Frontend.md">мобильном интерфейсе</a>. Чтобы настроить их:

1.  Перейдите в <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">глобальное меню</a> → _Advanced_ (Дополнительно) → _Hidden notes_ (Скрытые заметки).
2.  Найдите _Mobile Launch Bar_ (Мобильная панель запуска) и выполните те же действия по созданию, что описаны в предыдущем разделе.