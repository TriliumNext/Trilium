# Troubleshooting
## Why is my widget clipped by other UI elements

For performance and layout reasons, the size of widgets in Trilium is independent from its children. At CSS level, this means that the widget container has `contain: size` applied to it.

This works well if the widget has a fixed size (or based on its parent container), however to make a widget resize to fit its content, apply the following change:

```diff
class MyWidget extends api.RightPanelWidget {

+   constructor() {
+       super();
+       this.contentSized();
+   }
        
}
```

Alternatively apply `contain: none` to its CSS.