# Romanian (`ro`) grammar rules

The recurring lagging locale. These rules came out of real review feedback (Gemini Code Assist) on the Romanian PR — get them right up front.

## Diacritics
Use proper Romanian diacritics: **ă â î ș ț** (comma-below ș/ț, not cedilla). Capitalize months and standalone nouns as the existing file does (e.g. `"August"`, `"Septembrie"`).

## Plurals — Romanian needs THREE CLDR categories: `one` / `few` / `other`

i18next knows Romanian's plural rule. Every count+noun string needs all three:

| Category | Applies to (count) | Form |
|---|---|---|
| `_one` | exactly 1 | singular noun: `{{count}} notiță` |
| `_few` | 0, and 2–19 (and n%100 in 1–19) | plain plural, **no "de"**: `{{count}} notițe` |
| `_other` | ≥ 20 (20, 21, 100, …) | **plural noun preceded by "de"**: `{{count}} de notițe` |

The single most-missed rule: **`_other` must use the preposition "de"** before the noun ("21 **de** notițe"), and `_few` must **not** ("5 notițe"). The file already follows this (e.g. pre-existing `"{{count}} de taburi"`).

Examples that shipped:
```jsonc
"annotations_one":   "{{count}} adnotare",
"annotations_few":   "{{count}} adnotări",
"annotations_other": "{{count}} de adnotări",

"pages_one":   "{{count}} pagină",
"pages_few":   "{{count}} pagini",
"pages_other": "{{count}} de pagini",
```
For strings with no number-modified noun (e.g. a tooltip), `_few` and `_other` are identical and may both omit "de".

## Gender & number agreement

Adjectives and past participles **must agree** with the noun's gender and number. Watch feminine nouns — `clonă`/`clone` (clone), `căutare` (search), `notiță`/`notițe` (note), `opțiune` (option) are all **feminine**.

| Wrong (masculine/neuter) | Right (feminine) | Why |
|---|---|---|
| `Poate fi anulat` | `Poate fi anulată` (sg.) / `Pot fi anulate` (pl.) | "clonă/clone" feminine |
| `Indisponibil pe modelele…` | `Indisponibilă pe modelele…` | subject is "căutarea (web)", feminine |
| `{{count}} notițe au fost convertit` | `…au fost convertite` (pl.) / `o notiță a fost convertită` (sg.) | participle agrees with notiță(e) |

**Interpolated noun of unknown gender** (e.g. `{{settingLabel}}` which can be "Consolă SQL" *or* "Execuția scripturilor"): don't try to agree with it. Prefix a **known-gender head noun** so agreement is fixed:
```jsonc
// EN: "{{settingLabel}} will be disabled."
"disable-message": "Opțiunea {{settingLabel}} va fi dezactivată."  // "Opțiunea" is feminine → "dezactivată"
```

## Terminology (match the existing file)

| English | Romanian |
|---|---|
| note | notiță (pl. notițe) |
| child note / subnote | subnotiță |
| label / attribute | etichetă / atribut |
| relation | relație |
| attachment | atașament |
| revision | revizie (pl. revizii) |
| Cancel | Anulează |
| Save | Salvează |
| Delete | Șterge |
| Close | Închide |
| Enable / Disable | Activează / Dezactivează |
| Search | Căutare / Caută |
| code (note type) | Cod sursă |
| backup | copie de rezervă |
| Preview | Previzualizare |

Keep in English: ETAPI, MCP, OAuth/OpenID, Markdown, Widget, Mermaid, search-engine names, and words identical in Romanian (Text, Editor, Calendar, Vertical, Zoom, August, Logo, Alias).
