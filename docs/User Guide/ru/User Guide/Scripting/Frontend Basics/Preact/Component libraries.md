# Библиотеки компонентов
Используя концепцию <a class="reference-link" href="../../Common%20concepts/Script%20bundles.md">пакетов скриптов</a>, можно создавать компоненты, которые используются совместно в нескольких виджетах или <a class="reference-link" href="../../../Note%20Types/Render%20Note.md">заметках рендеринга</a>.

## Экспорт одного компонента

Обычно это полезно для крупных компонентов.

Вот пример иерархии дочерних заметок с использованием <a class="reference-link" href="../../../Note%20Types/Render%20Note.md">заметки рендеринга</a>: 

*   _My render note_  
    Тип заметки: Render Note (Заметка рендеринга)  
    Укажите связь `~renderNote` на дочернюю заметку (_Render note with subcomponents_)
    *   _Render note with subcomponents_  
        Тип: JSX
        
        ```jsx
        export default function() {
            return (
                <MyComponent />        
            );
        }
        ```
        
        *   _MyComponent_  
            Тип: Код / JSX
            
            ```jsx
            export default function MyComponent() {
                return <p>Hi</p>;
            }
            ```

## Несколько компонентов в одной заметке

Чтобы экспортировать несколько компонентов, используйте ключевое слово `export` перед каждым функциональным компонентом.

Вот как может выглядеть подзаметка с названием `MyComponents`:

```jsx
export function MyFirstComponent() {
    return <p>First</p>;
}

export function MySecondComponent() {
    return <p>Bar</p>;
}
```

Затем в родительской заметке:

```jsx
const { MyFirstComponent, MySecondComponent } = MyComponents;

export default function() {
    return (
        <>
            <MyFirstComponent />
            <MySecondComponent />
        </>
    );
}
```

В качестве альтернативы компоненты можно использовать напрямую, без предварительного присваивания в `const`:

```jsx
<MyComponents.MyFirstComponent />
<MyComponents.MySecondComponent />
```