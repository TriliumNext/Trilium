# ELK layout
Mermaid supports a different layout engine which supports slightly more complex diagrams, called the [Eclipse Layout Kernel (ELK)](https://eclipse.dev/elk/). Trilium has support for these as well, but it's not enabled by default.

In order to activate ELK for any diagram, insert the following YAML frontmatter right at the beginning of the diagram:

```yaml
---
config:
  layout: elk
---
```

| With ELK off | With ELK on |
| --- | --- |
| ![](ELK%20layout_ELK%20off.svg) | ![](ELK%20layout_ELK%20on.svg) |