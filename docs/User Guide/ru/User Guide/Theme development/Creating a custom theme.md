# Создание собственной темы
## Шаг 1. Найдите место для хранения тем

Организация — важный аспект управления базой знаний. При разработке новой темы или импорте существующей рекомендуется хранить их в одном месте.

Поэтому первый шаг — создать новую заметку, в которой будут собраны все темы.

![](Creating%20a%20custom%20theme_5_Creating%20a%20custom%20theme_im.jpg)

## Шаг 2. Создайте тему

<table>
    <tbody>
        <tr>
            <td><img src="Creating a custom theme_3_Creating a custom theme_im.jpg"></td>
            <td>Темы — это заметки с кодом и специальным атрибутом. Начните с создания новой заметки с кодом.</td>
        </tr>
        <tr>
            <td><img src="Creating a custom theme_1_Creating a custom theme_im.jpg"></td>
            <td>Затем измените тип кода заметки на CSS.</td>
        </tr>
        <tr>
            <td><img src="Creating a custom theme_Creating a custom theme_im.jpg"></td>
            <td>В атрибутах заметки (кнопка&nbsp;<span class="tn-icon bx bx-list-check"></span> в&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Status%20bar.md">строке состояния</a>) задайте атрибут <code>#appTheme</code> со значением любого желаемого названия. Именно это название будет отображаться в разделе внешнего вида в настройках.</td>
        </tr>
    </tbody>
</table>

## Шаг 3. Определите CSS темы

В качестве очень простого примера изменим цвет фона панели запуска на оттенок синего.

Чтобы изменить различные переменные темы:

```css
:root {
	--launcher-pane-background-color: #0d6efd;
}
```

## Шаг 4. Активация темы

Обновите приложение (для этого удобно нажать Ctrl+Shift+R) и перейдите в настройки. Вы должны увидеть созданную тему:

![](Creating%20a%20custom%20theme_2_Creating%20a%20custom%20theme_im.jpg)

После этого приложение обновится с новой темой:

![](Creating%20a%20custom%20theme_4_Creating%20a%20custom%20theme_im.jpg)

Обратите внимание, что тема будет основана на устаревшей (legacy) теме. Чтобы переопределить это и создать тему на основе современной темы (Modern / Next), см. <a class="reference-link" href="Customize%20the%20Next%20theme.md">Настройка темы Next</a>.

## Шаг 5. Внесение изменений

Просто вернитесь к заметке и внесите нужные изменения. Чтобы применить их в текущем окне, нажмите <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> для обновления.

Удобно держать открытыми два окна: одно для редактирования, а другое для предпросмотра изменений.