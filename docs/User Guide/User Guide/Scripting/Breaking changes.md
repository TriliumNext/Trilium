# Breaking changes
## v0.102.0: Upgrade to jQuery 4.0.0

jQuery 4 removes legacy browser support (such as IE11 support), but it also removes some APIs that are considered deprecated such as:

> `jQuery.isArray`, `jQuery.parseJSON`, `jQuery.trim`, `jQuery.type`, `jQuery.now`, `jQuery.isNumeric`, `jQuery.isFunction`, `jQuery.isWindow`, `jQuery.camelCase`, `jQuery.nodeName`, `jQuery.cssNumber`, `jQuery.cssProps`, and `jQuery.fx.interval`.
> 
> Use native equivalents like `Array.isArray()`, `JSON.parse()`, `String.prototype.trim()`, and `Date.now()` instead.

This may affect custom scripts if they (or the custom jQuery libraries used) depend on the deprecated APIs.

Note that Trilium polyfills `jQuery.isArray`, `isFunction` and `isPlainObject` because they were required by one of our dependencies (the autocomplete).

For more information, consult [the official blog post](https://blog.jquery.com/2026/01/17/jquery-4-0-0/).