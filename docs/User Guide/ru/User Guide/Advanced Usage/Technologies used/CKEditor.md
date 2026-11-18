# CKEditor
## Ядро редактора

CKEditor — это WYSIWYG-редактор (What You See Is What You Get — «что видишь, то и получаешь») за заметками [Текст](../../Note%20Types/Text.md).

Их сайт — [ckeditor.com](https://ckeditor.com/).

Сам CKEditor — коммерческий продукт, но ядро имеет открытый исходный код. Как описано в [его документации](https://ckeditor.com/docs/ckeditor5/latest/features/index.html), редактор поддерживает довольно большое число возможностей. Учтите, что не все возможности включены в Trilium.

## Премиум-возможности

CKEditor поставляет некоторые плагины как премиум-команд (слэш-команды, шаблоны, интеграция ИИ). Изначально Trilium (начиная с v0.96.0) поставлял некоторые из них, такие как слэш-команды, в рамках лицензионного гранта CKEditor разработчикам Trilium Notes.

В v0.105.0 мы решили заменить эти премиум-плагины собственными реализациями с открытым исходным кодом. Это также означает, что мы можем лучше адаптировать эти плагины под приложение Trilium.

## Плагины

Экосистема CKEditor весьма расширяема в том смысле, что можно писать пользовательские плагины, расширяющие функциональность редактора за пределы её исходного объёма.

Trilium использует такие возможности:

*   Возможность математики добавлена версией [isaul32/ckeditor5-math: Math feature for CKEditor 5.](https://github.com/isaul32/ckeditor5-math), модифицированной нами под наши нужды.
*   [mlewand/ckeditor5-keyboard-marker: Plugin adds support for the keyboard input element (`<kbd>`) to CKEditor 5.](https://github.com/mlewand/ckeditor5-keyboard-marker)
*   Модифицированная версия [ThomasAitken/ckeditor5-footnotes: Footnotes plugin for CKEditor5](https://github.com/ThomasAitken/ckeditor5-footnotes) для поддержки сносок.

Помимо этого, у Trilium есть собственный набор специфических плагинов, таких как:

*   <a class="reference-link" href="../../Note%20Types/Text/Cut%20to%20subnote.md">Вырезать в подзаметку</a>
*   <a class="reference-link" href="../../Note%20Types/Text/Include%20Note.md">Включение заметки</a>, который также показывает холсты для рисования и [диаграммы Mermaid](../../Note%20Types/Text/Insert%20buttons.md) на месте.
*   Упоминания для ссылок на страницы.
*   <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Import%20%26%20Export/Markdown.md">Markdown</a>
*   [Ссылки-референсы](../../Note%20Types/Text/Links.md)
*   [Замечания (admonitions)](../../Note%20Types/Text/Block%20quotes%20%26%20admonitions.md); в итоге мы создали собственный плагин, но [aarkue/ckeditor5-admonition](https://github.com/aarkue/ckeditor5-admonition) был хорошим источником вдохновения (включая значок на панели инструментов).
