# CSS
## Inline styles

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

## Custom CSS file

Simply create a <a class="reference-link" href="../../../Theme%20development/Custom%20app-wide%20CSS.md">Custom app-wide CSS</a>. Make sure the class names are unique enough to not intersect with other UI elements, consider adding a prefix (e.g. `x-mywidget-`).