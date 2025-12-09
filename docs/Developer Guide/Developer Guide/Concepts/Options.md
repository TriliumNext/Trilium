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