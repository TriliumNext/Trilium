# Компоновка ELK
Mermaid поддерживает альтернативный движок компоновки для более сложных диаграмм — [Eclipse Layout Kernel (ELK)](https://eclipse.dev/elk/). Trilium также поддерживает его, но по умолчанию он не включён.

Чтобы активировать ELK для любой диаграммы, вставьте следующий YAML-заголовок (frontmatter) в самое начало диаграммы:

```yaml
---
config:
  layout: elk
---
```

| ELK выключен | ELK включён |
| --- | --- |
| ![](ELK%20layout_ELK%20off.svg) | ![](ELK%20layout_ELK%20on.svg) |