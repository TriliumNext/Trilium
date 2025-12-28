# Day.js
Day.js is a date manipulation library that's used by Trilium, but it's also shared with both front-end and back-end scripts. For more information about the library itself, consult the [official documentation](https://day.js.org/en/).

## How to use

The `dayjs` method is provided directly in the `api` global:

```javascript
const date = api.dayjs();
api.log(date.format("YYYY-MM-DD"));
```

## Plugins

Day.js uses a modular, plugin-based architecture. Generally these plugins must be imported, but this process doesn't work inside Trilium scripts due to the use of a bundler.

Since v0.100.0, the same set of plugins is available for both front-end and back-end scripts.

The following Day.js plugins are directly integrated into Trilium:

*   [AdvancedFormat](https://day.js.org/docs/en/plugin/advanced-format)
*   [Duration](https://day.js.org/docs/en/plugin/duration), since v0.100.0.
*   [IsBetween](https://day.js.org/docs/en/plugin/is-between)
*   [IsoWeek](https://day.js.org/docs/en/plugin/iso-week)
*   [IsSameOrAfter](https://day.js.org/docs/en/plugin/is-same-or-after)
*   [IsSameOrBefore](https://day.js.org/docs/en/plugin/is-same-or-before)
*   [QuarterOfYear](https://day.js.org/docs/en/plugin/quarter-of-year)
*   [UTC](https://day.js.org/docs/en/plugin/utc)

> [!NOTE]
> If another Day.js plugin might be needed for scripting purposes, feel free to open a feature request for it. Depending on the size of the plugin and the potential use of it inside the Trilium code base, it has a chance of being integrated.