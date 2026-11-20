# Preact
Начиная с версии v0.101.0, Trilium включает интеграцию с Preact для фронтенд-скриптов, включая поддержку JSX.

Preact можно использовать для:

*   <a class="reference-link" href="../../Note%20Types/Render%20Note.md">заметок рендеринга</a>, где вместо HTML-заметки используется заметка типа «Код» с языком JSX;
*   <a class="reference-link" href="Custom%20Widgets.md">пользовательских виджетов</a>, где JSX может заменить старый механизм на базе jQuery.

Чтобы начать, сначала включите JSX в списке языков заметок с кодом. Перейдите в Options (Настройки) → Code Notes (Заметки с кодом) и отметьте язык «JSX». После этого переходите к документации по <a class="reference-link" href="../../Note%20Types/Render%20Note.md">заметкам рендеринга</a> или <a class="reference-link" href="Custom%20Widgets.md">пользовательским виджетам</a> — в обоих разделах описано, как использовать новую интеграцию с Preact.

> [!IMPORTANT]
> Документация предполагает предварительное знакомство с React или Preact. Для начала можно изучить [курс FreeCodeCamp по библиотекам фронтенд-разработки](https://www.freecodecamp.org/learn/front-end-development-libraries-v9/) или [учебник по Preact](https://preactjs.com/tutorial/).

## Импорт и экспорт

При использовании Preact с JSX доступен специальный синтаксис, предоставляющий импорты в стиле ES. Такой синтаксис `import` делает код более интуитивным, избавляет от необходимости обращаться к глобальным объектам и закладывает основу для улучшенного автодополнения в будущем.

### Импорт API

Вместо:

```jsx
api.showMessage("Hello");
```

версия на JSX выглядит так:

```jsx
import { showMessage } from "trilium:api";
showMessage("hello");
```

### Импорт Preact API (хуки, компоненты)

Доступен новый <a class="reference-link" href="../Script%20API.md">Script API</a>, предназначенный для Preact, который предоставляет, например, общие компоненты, используемые внутри самого Trilium, а также хуки.

```jsx
import { useState } from "trilium:preact";
const [ myState, setMyState ] = useState("Hi");
```

### Экспорт

JSX-заметки могут экспортировать компонент для использования в <a class="reference-link" href="../../Note%20Types/Render%20Note.md">заметке рендеринга</a> или в <a class="reference-link" href="Preact/Component%20libraries.md">библиотеках компонентов</a>: 

```jsx
export default function() {
    return (
        <>
            <p>Hello world.</p>
        </>
    );
}
```

### Импорт и экспорт не обязательны

Эти импорты — синтаксический сахар, предназначенный для замены обращения к глобальному объекту `api` (см. <a class="reference-link" href="../Script%20API.md">Script API</a>).

> [!NOTE]
> Синтаксис `import` и `export` работает только для JSX-заметок. Обычные заметки с кодом (в том числе на jQuery) по-прежнему должны использовать глобальный объект `api` и `module.exports`.

## Как это работает внутри

В отличие от JavaScript, JSX требует предварительной обработки для преобразования в JavaScript (как и TypeScript). Для этого Trilium использует [Sucrase](https://github.com/alangpierce/sucrase) — JavaScript-библиотеку, которая компилирует JSX в чистый JavaScript. Обработка выполняется при каждом запуске скрипта (для виджетов — при каждом запуске программы). Если вы заметите снижение производительности из-за длительной компиляции, пожалуйста, [сообщите нам об этой проблеме](../../Troubleshooting/Reporting%20issues.md).