# Component libraries
Using the concept of <a class="reference-link" href="../../Common%20concepts/Script%20bundles.md">Script bundles</a>, it's possible to create components that are shared for multiple widgets or <a class="reference-link" href="../../../Note%20Types/Render%20Note.md">Render Note</a>.

## Exporting a single component

This is generally useful for big components.

Here's an example child hierarchy using <a class="reference-link" href="../../../Note%20Types/Render%20Note.md">Render Note</a>: 

*   _My render note_  
    Note type: Render Note  
    Link `~renderNote` to the child note (_Render note with subcomponents_)
    *   _Render note with subcomponents_  
        Type: JSX
        
        ```jsx
        export default function() {
            return (
                <MyComponent />        
            );
        }
        ```
        
        *   _MyComponent_  
            Type: Code / JSX
            
            ```jsx
            export default function MyComponent() {
                return <p>Hi</p>;
            }
            ```

## Multiple components per note

To export multiple components, use the `export` keyword next to each of the function components.

Here's how a sub-note called `MyComponents` would look like:

```jsx
export function MyFirstComponent() {
    return <p>First</p>;
}

export function MySecondComponent() {
    return <p>Bar</p>;
}
```

Then in its parent note:

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

Alternatively, it's also possible to use the components directly without assigning them to a `const` first:

```jsx
<MyComponents.MyFirstComponent />
<MyComponents.MySecondComponent />
```