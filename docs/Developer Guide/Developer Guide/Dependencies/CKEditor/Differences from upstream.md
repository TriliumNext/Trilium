# Differences from upstream
*   Embeds [`~~isaul32/ckeditor5-math~~`](https://github.com/isaul32/ckeditor5-math)  <a class="reference-link" href="ckeditor5-math.md">ckeditor5-math</a>, which is a third-party plugin for adding math support. CKEditor itself also has a [math plugin](https://ckeditor.com/docs/ckeditor5/latest/features/math-equations.html) with MathType and ChemType but it's premium-only.
*   Zadam left a TODO in `findandreplaceUI`: `// FIXME: keyboard shortcut doesn't work:` [`https://github.com/ckeditor/ckeditor5/issues/10645`](https://github.com/ckeditor/ckeditor5/issues/10645)
*   `packages\ckeditor5-build-balloon-block\src\mention_customization.js` introduces note insertion via `@` character.

| Affected file | Affected method | Changed in | Reason for change |
| --- | --- | --- | --- |
| `packages/ckeditor5-mention/src/mentionui.ts` | `createRegExp()` | `6db05043be24bacf9bd51ea46408232b01a1b232` (added back) | Allows triggering the autocomplete for labels and attributes in the attribute editor. |
| `init()` | `55a63a1934efb9a520fcc2d69f3ce55ac22aca39` | Allows dismissing @-mention permanently after pressing ESC, otherwise it would automatically show up as soon as a space was entered. |     |

## Checking the old repo

Use the following command to identify commits from Zadam:

```
git log --oneline --author="adam" --all
```

It's best to run the command from zadam's fork of `trilium-ckeditor5` instead of the TriliumNext once since it might not contain all the unmerged branches.

To show a filtered diff of a commit:

```
git show d42e772783 -- ':!*yarn.lock' ':!*packages/ckeditor5-build-balloon-block/build/*' ':!*package.json'
```