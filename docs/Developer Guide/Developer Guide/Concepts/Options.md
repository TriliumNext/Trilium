# Options
## Read an option

Add the import to the service (make sure the relative path is correct):

```javascript
import options from "../../services/options.js";
```

Them simply read the option:

```javascript
this.firstDayOfWeek = options.getInt("firstDayOfWeek");
```

## Adding new options

### Checkbox option

Refer to this example in `backup.tsx`:

```javascript
export function AutomaticBackup() {
    const [ dailyBackupEnabled, setDailyBackupEnabled ] = useTriliumOptionBool("dailyBackupEnabled");

    return (
        <OptionsSection title={t("backup.automatic_backup")}>
            <FormMultiGroup label={t("backup.automatic_backup_description")}>
                <FormCheckbox
                    name="daily-backup-enabled"
                    label={t("backup.enable_daily_backup")}
                    currentValue={dailyBackupEnabled} onChange={setDailyBackupEnabled}
                />
            </FormMultiGroup>

            <FormText>{t("backup.backup_recommendation")}</FormText>
        </OptionsSection>
    )
}
```

> [!TIP]
> To trigger a UI refresh (e.g. `utils#reloadFrontendApp`), simply pass a `true` as the second argument to `useTriliumOption` methods.

### How a section is laid out

An `OptionsSection` is a card, and each option row is a segment of it — its own box, seamed off from the rows around it. Rows do this for themselves, so a row keeps its segment wherever it is written, including inside a wrapper component that the section itself cannot see into.

Anything in a section that is *not* a row — explanatory text, a list of checkboxes, an empty state, a preview pane — has no segment of its own, so wrap it in an `OptionsBlock`:

```javascript
<OptionsSection title={t("highlights_list.title")}>
    <OptionsBlock>
        <FormText>{t("highlights_list.description")}</FormText>
        <CheckboxList values={...} />
    </OptionsBlock>
</OptionsSection>
```

Group content that belongs together in a single `OptionsBlock`, or each piece of it becomes a segment of its own. Pass `noPadding` for content that should fill its segment edge to edge, such as a preview pane or an admonition.

The same components are reused by dialogs (import, delete, login), where there is no options card. There a row falls back to the divided layout those dialogs were designed with, and an `OptionsBlock` simply passes its content through.

### Sub-options that depend on another option

Wrap them in an `OptionsGroup`. Its rows stay segments of the same card but indent and tint, so that they read as governed by the row above rather than as merely following it:

```javascript
<OptionsSection title={t("llm.mcp_title")}>
    <OptionsRowWithToggle
        name="mcp-enabled" label={t("llm.mcp_enabled")}
        currentValue={mcpEnabled} onChange={setMcpEnabled}
    />

    <OptionsGroup visible={mcpEnabled}>
        <OptionsRow name="mcp-endpoint" label={t("llm.mcp_endpoint_title")}>
            <FormTextBox currentValue={endpointUrl} readOnly />
        </OptionsRow>
    </OptionsGroup>
</OptionsSection>
```

Match `visible` to how the governing option already behaves, rather than changing it along the way: reveal on enable where the rows appear and disappear today, or pass a constant `true` and keep the rows `disabled` where they are currently visible-but-disabled — visible-but-disabled controls advertise what a toggle unlocks, so hiding them instead costs discoverability.

The group nests wherever it is placed, at any depth and inside any wrapper component, because it carries only the nesting level and no box of its own.