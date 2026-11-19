# CSS
## Встроенные стили

```jsx
<div style={{
    display: "flex",
    height: "53px",
    width: "fit-content",
    fontSize: "0.75em",
    alignItems: "center",
    flexShrink: 0            
}}>/* [...] */</div>
```

## Пользовательский CSS-файл

Просто создайте <a class="reference-link" href="../../../Theme%20development/Custom%20app-wide%20CSS.md">пользовательский CSS для всего приложения</a>. Убедитесь, что имена классов достаточно уникальны и не пересекаются с другими элементами интерфейса — рекомендуется добавлять префикс (например, `x-mywidget-`).