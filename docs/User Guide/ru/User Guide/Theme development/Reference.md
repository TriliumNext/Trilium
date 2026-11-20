# Справочник
## Определение мобильной и настольной версии

Мобильная разметка отличается от настольной. Используйте `body.mobile` и `body.desktop`, чтобы различать их.

```css
body.mobile #root-widget {
	/* Действие для мобильной версии */
}

body.desktop #root-widget {
	/* Действие для настольной версии */
}
```

Обратите внимание, что в мобильной разметке также есть «планшетный режим». Для этого случая требуются медиазапросы:

```css
@media (max-width: 991px) {
    #launcher-pane {
        /* Действие для мобильной разметки */
    }
}



@media (min-width: 992px) {
    #launcher-pane {
        /* Действие для планшетной и настольной разметки */
    }
}
```

## Определение горизонтальной и вертикальной разметки

Пользователь может выбирать между вертикальной разметкой (классической, где панель запуска находится слева) и горизонтальной разметкой (где панель запуска находится сверху, а вкладки занимают всю ширину).

Различные стили можно применять с помощью классов на уровне `body`:

```css
body.layout-vertical #left-pane {
	/* Действие */
}

body.layout-horizontal #center-pane {
	/* Другое действие */	
}
```

Эти две разметки используют разные контейнеры (хотя оба присутствуют в DOM независимо от выбора пользователя): например, `#horizontal-main-container` и `#vertical-main-container` можно использовать для настройки фона области содержимого.

## Определение платформы (Windows, macOS) или Electron

=== "<span class="tn-icon bx bxl-windows"></span> Windows"

    ```css
    body.platform-win32 {
    	background: red;
    }
    ```

=== "<span class="tn-icon bx bxl-apple"></span> macOS"

    ```css
    body.platform-darwin {
    	background: red;
    }
    ```

=== "<span class="tn-icon bx bx-windows"></span> Electron (настольное приложение)"

    Чтобы отличить <a class="reference-link" href="../Installation%20%26%20Setup/Desktop%20Installation.md">настольную установку</a> от <a class="reference-link" href="../Installation%20%26%20Setup/Server%20Installation.md">серверной установки</a>:

    ```
    body.electron {
    	background: blue;
    }
    ```

    Можно комбинировать с определением Windows/macOS (например, `body.electron.platform-win32`).

### Системная строка заголовка

Можно определить, выбрал ли пользователь системную строку заголовка или пользовательскую, проверив класс у `body`:

```
body.electron.native-titlebar {
	/* Действие */
}

body.electron:not(.native-titlebar) {
	/* Другое действие */
}
```

### Системные кнопки окна

При запуске в Electron с отключённой системной строкой заголовка была добавлена возможность использовать платформенные кнопки окна, такие как «светофор» в macOS.

См. [Native title bar buttons by eliandoran · Pull Request #702 · TriliumNext/Notes](https://github.com/TriliumNext/Notes/pull/702) для ознакомления с исходной реализацией этой функции, включая скриншоты.

=== "<span class="tn-icon bx bxl-windows"></span> Windows"

    Цвета области системных кнопок окна можно настроить с помощью RGB hex-цвета:

    ```
    body {
    	--native-titlebar-foreground: #ffffff;
    	--native-titlebar-background: #ff0000;
    }
    ```

    Также можно использовать прозрачность (ценой менее выраженного цвета при наведении) с помощью RGBA hex-цвета:

    ```
    body {
    	--native-titlebar-background: #ff0000aa;
    }
    ```

    Обратите внимание, что значение считывается при инициализации окна, а затем обновляется только тогда, когда пользователь меняет настройку светлого/тёмного режима.

=== "<span class="tn-icon bx bxl-apple"></span> macOS"

    В macOS кнопки окна «светофор» включены по умолчанию при отключённой системной строке заголовка. Смещение кнопок можно настроить с помощью:

    ```css
    body {
        --native-titlebar-darwin-x-offset: 12;
        --native-titlebar-darwin-y-offset: 14 !important;
    }
    ```

### Фоновые эффекты и прозрачность (Mica и vibrancy)

Когда в настольном приложении включены фоновые эффекты, Trilium отрисовывает полупрозрачный фон за окном: Mica в Windows 11 (вариант `tabbed` в горизонтальной разметке) и vibrancy в macOS. Trilium выбирает фон самостоятельно и применяет его только к темам Next и пользовательским темам на их основе через `#appThemeBase` (см. <a class="reference-link" href="Customize%20the%20Next%20theme.md">Настройка темы Next</a>). Другие темы не получают фонового эффекта.

Фоновый эффект виден только там, где тема оставляет страницу (полу)прозрачной. Используйте тему Next в качестве примера.

## Значки заметок, акцентный цвет рабочего пространства на вкладках

Возможности темы — это небольшие настройки с помощью CSS-переменных, которые могут влиять на разметку или внешний вид приложения.

Чтобы на панели вкладок отображались значки заметок вместо значка рабочего пространства:

```css
:root {
	--tab-note-icons: true;
}
```

Когда для вкладки выбрано рабочее пространство, можно получить цвет фона этого рабочего пространства, например чтобы отобразить тонкую полоску на вкладке вместо заливки всего фона:

```css
.note-tab .note-tab-wrapper {
    --tab-background-color: initial !important;
}

.note-tab .note-tab-wrapper::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background-color: var(--workspace-tab-background-color);
}
```

## Пользовательские шрифты

Рекомендуемый способ использования пользовательских шрифтов — импортировать шрифт непосредственно в Trilium. Подробнее см. в разделе <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Themes/Personalizing%20the%20font.md">Настройка шрифта</a>.

В качестве альтернативы для темы, поставляющей собственный шрифт, можно использовать [пользовательские поставщики ресурсов](../Advanced%20Usage/Custom%20Resource%20Providers.md): импортируйте шрифт в Trilium, назначьте ему `#customResourceProvider=fonts/myfont.ttf`, а затем подключите шрифт в CSS через `/custom/fonts/myfont.ttf`. Используйте `../../../custom/fonts/myfont.ttf`, если ваш сервер Trilium работает по пути, отличному от `/`.

## Тёмные и светлые темы

Светлая тема должна содержать следующий CSS:

```css
:root {
	--theme-style: light;
}
```

Если тема тёмная, то `--theme-style` должно иметь значение `dark`. Значение `dark` для `--theme-style` также сообщает расширению браузера Dark Reader, что страницу не нужно изменять.

Если тема автоматическая (т. е. поддерживает и светлый, и тёмный режим на основе `prefers-color-scheme`), она также должна объявить (в дополнение к установке `--theme-style` в `light` или `dark`):

```css
:root {

    --theme-style-auto: true;

}
```

Это повлияет на поведение приложения Electron, сообщив операционной системе о предпочтительной цветовой схеме (например, фоновые эффекты в Windows будут отображаться корректно).

## Адаптивные цвета текста и таблиц

Цвета, применённые в текстовой заметке с помощью кнопок цвета шрифта и цвета фона (см. <a class="reference-link" href="../Note%20Types/Text/General%20formatting.md">Общее форматирование</a>), из свойств таблиц и ячеек (см. <a class="reference-link" href="../Note%20Types/Text/Tables.md">Таблицы</a>) или к выноскам (см. <a class="reference-link" href="../Note%20Types/Text/Aside%20blocks.md">Блоки-выноски</a>), отображаются в оттенке, подходящем для текущей темы: цветовой тон сохраняется, а светлота и насыщенность удерживаются в заданных пределах. Тема может изменить эти пределы, например если фон её страницы намного темнее или светлее, чем у встроенных тем:

```css
:root {
    --adaptive-text-light-max-lightness: 35;
    --adaptive-text-dark-min-lightness: 80;
}
```

Каждая переменная имеет имя `--adaptive-<role>-<light|dark>-<limit>`:

*   `role` — это `text` (цвет шрифта), `background` (цвет фона шрифта), `table-border` или `table-background` (таблицы и ячейки), либо `aside-background` (блоки-выноски).
*   `light` или `dark` — тип темы, к которому применяется ограничение, как указано в `--theme-style`.
*   `limit` — это `min-lightness` или `max-lightness` (светлота в CIELAB, от 0 для чёрного до 100 для белого), либо `max-chroma` (максимальная насыщенность цвета; `150` фактически снимает ограничение). Каждое значение должно быть простым числом, иначе цвета потеряют адаптацию.

Значения по умолчанию:

| Роль | Светлые темы | Тёмные темы |
| --- | --- | --- |
| `text` | `max-lightness: 45`, `max-chroma: 150` | `min-lightness: 75`, `max-chroma: 55` |
| `background` | `min-lightness: 90`, `max-chroma: 20` | `max-lightness: 30`, `max-chroma: 30` |
| `table-border` | `max-lightness: 60`, `max-chroma: 150` | `min-lightness: 47`, `max-chroma: 150` |
| `table-background` | `min-lightness: 90`, `max-chroma: 20` | `max-lightness: 30`, `max-chroma: 30` |
| `aside-background` | `min-lightness: 95`, `max-chroma: 15` | `max-lightness: 26`, `max-chroma: 19` |

Ограничения применяются во время отображения заметки, поэтому их изменение сразу влияет на все заметки. Сама заметка сохраняет каждый цвет в том виде, в каком он был выбран, в стиле `color`, `background-color` или `border-color`, а также повторно в переменной `--tn-color`, `--tn-background` или `--tn-border-color`, которую считывает механизм адаптации.