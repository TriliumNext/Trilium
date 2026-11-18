# Используемые технологии
Один из ключевых аспектов Trilium, позволяющий поддерживать множество [Типов заметок](../Note%20Types.md), — использование различных готовых и переиспользуемых библиотек.

Эта страница демонстрирует некоторые используемые технологии — для лучшего понимания того, как работает Trilium, а также чтобы отдать должное разработчикам этих технологий.

## CKEditor

CKEditor — это редактор за заметками <a class="reference-link" href="../Note%20Types/Text.md">Текст</a>, а также интегрирован в различные части приложения, такие как редактор атрибутов в <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Status%20bar.md">Строке состояния</a> или окно чата в боковой панели или заметках <a class="reference-link" href="../AI.md">ИИ</a>.

Подробнее см. <a class="reference-link" href="Technologies%20used/CKEditor.md">CKEditor</a>.

## Excalidraw

[Excalidraw](https://excalidraw.com/) — технология за заметками <a class="reference-link" href="../Note%20Types/Canvas.md">Холст</a>. Исходный код библиотеки доступен на [GitHub](https://github.com/excalidraw/excalidraw).

Мы используем немодифицированную версию, поэтому она разделяет те же [проблемы](https://github.com/excalidraw/excalidraw/issues), что и оригинал.

## MapLibre GL JS

Trilium v0.105.0 представляет [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) для коллекции <a class="reference-link" href="../Collections/Geo%20Map.md">Геокарта</a>, что приносит улучшенную производительность за счёт графического ускорения (WebGL). Trilium поставляет собственную логику разбора треков, а также большую часть интерфейса, такого как правая панель.

## MindElixir

MindElixir — библиотека, которую мы используем для типов заметок <a class="reference-link" href="../Note%20Types/Mind%20Map.md">Mind Map</a>. Основная библиотека доступна на [GitHub как mind-elixir-core](https://github.com/SSShooter/mind-elixir-core/issues).

Trilium поставляет собственный интерфейс, который покрывает панели инструментов, контекстное меню, кнопки масштаба и правую панель, показываемую при щелчке по узлу.

## FullCalendar

[FullCalendar](https://fullcalendar.io/) — технология за коллекцией <a class="reference-link" href="../Collections/Calendar.md">Календарь</a>, предоставляющая различные виды (день, неделя, месяц, год) и управление событиями. Trilium также поставляет собственный интерфейс в виде всплывающего окна, появляющегося при редактировании, а также заголовка, который появляется в <a class="reference-link" href="../Collections/Collection%20Properties.md">Свойствах коллекции</a>.

Лицензируется под лицензией MIT.
