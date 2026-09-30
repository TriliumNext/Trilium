# Reasoning rules
A reasoning rule is a note whose content is a list of if-then rules. The rules add [labels and relations](Attributes.md) to other notes. In a rule, `?this` is the parent of the rule note. A name with no path back to `?this` matches the [workspace](../Basic%20Concepts%20and%20Features/Navigation/Workspaces.md) the rule note is in, or the whole database when the rule note is not inside one.

## Creating a rule note

To add rules to a note, right-click it in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> and select _Insert child note_, then choose _Reasoning rule_ (<span class="tn-icon bx bx-network-chart"></span>) under _Built-in templates_.

The new note is a code note. Its content starts as comments that show the shape of a rule. Remove the `//` from a line to turn that rule on, or replace the comments with your own rules. Any text or code note with the `#reasoningRule` label is read the same way; the template already carries that label.

A rule note placed directly under the root uses itself as `?this`. A rule that does not use `?this` still matches the whole database, unless the rule note sits inside a workspace.

## Rules on one note

Under a note called _The Lord of the Rings_, a rule note can say:

```
#priority(?task, "high") :- child(?this, ?task), #status(?task, "todo").
~listed(?citing, ?this) :- ~cites(?citing, ?this).
```

The first rule gives `#priority=high` to every direct child that has `#status=todo`. The second gives `~listed`, pointing back at the book, to every note that has `~cites` pointing at the book. That citing note does not have to live under the book, or inside the same workspace. A path that starts at `?this` can leave the workspace.

A name with no such path matches every note in the workspace, or every note in the database when there is no workspace. `#mark(?task, "yes") :- #status(?task, "todo").` is that kind of rule.

## Rules on a template

Put the rule note inside a <a class="reference-link" href="Templates.md">Templates</a> note (one that has the `#template` label). Then `?this` is each instance of that template, and the same rules run for every instance.

```
#priority(?task, "high") :- child(?this, ?task), #status(?task, "todo").
#blocked(?this) :- descendant(?this, ?task), #status(?task, "blocked").
```

On a _Project_ template, every instance marks its to-do children with `#priority=high`, and marks itself `#blocked` when any note under it has `#status=blocked`.

## Rules in a workspace

Put the rule note inside a workspace and a free name matches that workspace only.

```
#authority(?person, "yes") :- #role(?person, "priest").
```

Under a workspace, that rule marks every note in the workspace that has `#role=priest`, and leaves notes outside it alone. Add `#reasoningScope=global` on the rule note itself (the label has to be owned there, not only inherited) to match the whole database even inside a workspace.

## Writing a rule

*   One rule per clause, ending with a period. `//` starts a comment that runs to the end of the line.
*   `#name(?note)` matches a label with no value. `#name(?note, "value")` matches a label with that value. A number is written without quotes, as in `#age(?person, ?years), ?years > 18`. A label whose value is a plain number is compared as a number; `"21"` in quotes stays text.
*   `~name(?source, ?target)` matches a relation from the source note to the target note.
*   `child(?parent, ?child)` is a direct child, and `parent(?child, ?parent)` is the reverse. `descendant(?ancestor, ?note)` is a child, or a child of a child, and so on. `title(?note, "Exact title")` and `type(?note, "text")` read the title and the note type.
*   `@"Exact title"` names the one note with that title. Zero matches, or more than one, is an error.
*   `not` in front of a condition excludes it, as in `not #status(?task, "done")`. Comparisons are `=`, `!=`, `<`, `>`, `<=` and `>=`.
*   Every name in the conclusion, and every name used under `not` or in a comparison, has to appear in an ordinary condition. `?this` already counts when the rule uses it.

## What the rules write

The conclusions are ordinary labels and relations, shown in the attributes list with a <span class="tn-icon bx bx-network-chart"></span> mark. When a rule no longer concludes one, it is removed. An attribute created by hand, with the same name and value, is left in place.

To keep an inferred attribute after the rule stops concluding it, press <span class="tn-icon bx bx-pin"></span> _Keep this attribute_ on its row. Changing the value does the same: the attribute becomes a normal one, and the rule leaves it alone. Deleting it removes it, and the next run brings it back while the rule still holds. If the rule later concludes a different value, that value appears beside the one you kept.

An edit rechecks the notes next to the change. Opening a note applies the rules to that note, and then to notes that gained a conclusion. Opening the database, or editing a rule note, rechecks the workspace or the whole database. A problem in a rule is the `#reasoningError` label on the rule note. Fix the rule and the label is cleared on the next run.

Deleting the rule note removes its conclusions on the next run. Deleting the note it describes deletes the child rule note with it.

## Limitations

*   Rules read attributes owned by a note. Inherited attributes are not seen, apart from the `~template` relation that binds `?this` on a template.
*   A rule does not see the attributes it wrote itself, so its own conclusion cannot be one of its conditions. It does see attributes written by hand, and the conclusions other rules derive in the same run. A stored conclusion cannot keep itself true after the ordinary condition is gone.
*   The names `reasoningRule`, `reasoningError`, `reasoningScope`, `reasoningSchema`, `template` and `inherit` cannot be conclusions.
*   The rule note is not treated as a child of its parent, so a rule about every child does not match the rule note.
*   Hidden notes are not part of the rules.
*   A protected rule note is read only while the protected session is unlocked.
*   `descendant` follows a cycle of clones. A note is not a descendant of itself. A note that is also a direct child is still reached by `child`.
*   Opening or editing a note does not walk every descendant of a very large tree. That check runs when the database opens or a rule note is edited.