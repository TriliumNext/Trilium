# Виджет правой панели
### Виджет заголовка

Это пример виджета с отслеживанием контекста, который отображает заголовок текущей заметки:

```
class NoteTitleWidget extends api.RightPanelWidget {
    
    get widgetTitle() { return "Note title"; }
    get parentWidget() { return "right-pane" }

    doRenderBody() {
        this.$body.empty();
        if (this.note) {
            this.$body.append($("<div>").text(this.note.title));
        }
    }   
    
    async refreshWithNote() {
    	this.doRenderBody();
    }
}

module.exports = new NoteTitleWidget();
```

### Часы

Простой виджет, показывающий текущее время, в качестве примера периодического динамического обновления содержимого виджета.

=== "<span class="tn-icon bx bxl-react"></span> Preact"

    ```
    import { defineWidget, RightPanelWidget, useEffect, useState } from "trilium:preact";

    export default defineWidget({
        parent: "right-pane",    
        position: 1,
        render() {
            const [ time, setTime ] = useState();
            useEffect(() => {
                const interval = setInterval(() => {
                    setTime(new Date().toLocaleString());
                }, 1000);
                return () => clearInterval(interval);
            });        
            return (
                <RightPanelWidget id="clock-jsx" title="Clock (JSX)">
                    <p>The time is: {time}</p>
                </RightPanelWidget>
            );
        }
    });
    ```

=== "<span class="tn-icon bx bxl-javascript"></span> Legacy"

    ```
    const template = `<div></div>`;

    class ToDoListWidget extends api.RightPanelWidget {
        
        get widgetTitle() { return "Clock"; }        
        get parentWidget() { return "right-pane" }
        
        async doRenderBody() {
            if (!this.timer) {
                this.timer = setInterval(() => {
                    this.$body.empty().append(`The time is: <span>${new Date().toLocaleString()}</span>`);                       
                }, 1000);            
            }

            this.$body.empty().append(`The time is: <span>${new Date().toLocaleString()}</span>`);
        }   
    }

    module.exports = new ToDoListWidget();
    ```

## Изменение позиции на боковой панели

По умолчанию элементы боковой панели отображаются в том порядке, в котором приложение находит заметки с меткой `#widget`.

Можно разместить виджет выше или ниже, настроив его свойство `position`:

=== "<span class="tn-icon bx bxl-react"></span> Preact"

    ```javascript
    import { defineWidget, RightPanelWidget, useEffect, useState } from "trilium:preact";

    export default defineWidget({
    	/* [...] */
        position: 20,
        render() {
    		/* [...] */
        }
    });
    ```

=== "<span class="tn-icon bx bxl-javascript"></span> Legacy"

    ```javascript
    class MyWidget extends api.RightPanelWidget {

        get position() { return 20 };
            
    }
    ```

Как правило, позиция по умолчанию начинается с 10 и увеличивается на 10 для каждого элемента, включая стандартное Оглавление и Список выделений.

## Ключевые особенности устаревших виджетов

*   Метод `doRender` переопределять нельзя — вместо него нужно переопределять `doRenderBody()`.
    *   `doRenderBody` может быть `async`.
*   `parentWidget()` должен возвращать `“rightPane”`.
*   Геттер `widgetTitle()` можно переопределить; в противном случае виджет будет отображаться как «Untitled widget».