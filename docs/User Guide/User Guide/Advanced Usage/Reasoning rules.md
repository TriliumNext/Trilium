# Reasoning rules
A reasoning rule is a note whose content is a list of if-then rules. The rules add [labels and relations](Attributes.md) to other notes. By default they describe only the note they sit under: in a rule, `?this` is that parent. A rule that should apply to every note in the database belongs on a concept note, and has to say so.

## Creating a rule note

To add rules to a note, right-click it in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> and select _Insert child note_, then choose _Reasoning rule_ (<span class="tn-icon bx bx-network-chart"></span>) under _Built-in templates_.

The new note is a code note. Its content starts as comments that show the shape of a rule. Remove the `//` from a line to turn that rule on, or replace the comments with your own rules. Any text or code note with the `#reasoningRule` label is read the same way; the template already carries that label.

A rule note placed directly under the root describes itself, not the whole tree.

## Rules on one note

Under a note called _The Lord of the Rings_, a rule note can say:

```
#priority(?task, "high") :- child(?this, ?task), #status(?task, "todo").
~listed(?citing, ?this) :- ~cites(?citing, ?this).
```

The first rule gives `#priority=high` to every direct child that has `#status=todo`. The second gives `~listed`, pointing back at the book, to every note that has `~cites` pointing at the book. That citing note does not have to live under the book. What it has to be is named in the rule by a path that starts at `?this`.

A rule that names a note with no such path is refused. The rule note then gets a `#reasoningError` label, and nothing is written. That is what keeps a note that only records a fact, such as `#role=priest` on a person, from quietly defining a rule about every person.

## Rules on a template

Put the rule note inside a <a class="reference-link" href="Templates.md">Templates</a> note (one that has the `#template` label). Then `?this` is each instance of that template, and the same rules run for every instance.

```
#priority(?task, "high") :- child(?this, ?task), #status(?task, "todo").
#blocked(?this) :- descendant(?this, ?task), #status(?task, "blocked").
```

On a _Project_ template, every instance marks its to-do children with `#priority=high`, and marks itself `#blocked` when any note under it has `#status=blocked`.

## Rules for the whole database

A rule that should match notes with no connection to one parent is a rule about a concept. Add the `#reasoningSchema` label to that concept note, put the rule note under it, and add `#reasoningScope=global` on the rule note itself (the label has to be owned there, not only inherited).

```
#authority(?person, "yes") :- #role(?person, "priest").
```

The concept note can also be a template: `#template` counts the same way as `#reasoningSchema`. Without one of those labels, a global rule is refused and the rule note gets `#reasoningError`.

## Writing a rule

*   One rule per clause, ending with a period. `//` starts a comment that runs to the end of the line.
*   `#name(?note)` matches a label with no value. `#name(?note, "value")` matches a label with that value. A number is written without quotes, as in `#age(?person, ?years), ?years > 18`. A label whose value is a plain number is compared as a number; `"21"` in quotes stays text.
*   `~name(?source, ?target)` matches a relation from the source note to the target note.
*   `child(?parent, ?child)` is a direct child, and `parent(?child, ?parent)` is the reverse. `descendant(?ancestor, ?note)` is a child, or a child of a child, and so on. `title(?note, "Exact title")` and `type(?note, "text")` read the title and the note type.
*   `@"Exact title"` names the one note with that title. Zero matches, or more than one, is an error.
*   `not` in front of a condition excludes it, as in `not #status(?task, "done")`. Comparisons are `=`, `!=`, `<`, `>`, `<=` and `>=`.
*   Every name in the conclusion, and every name used under `not` or in a comparison, has to appear in an ordinary condition. `?this` already counts, except in a global rule.

## What the rules write

The conclusions are ordinary labels and relations, shown in _Owned Attributes_. When a rule no longer concludes one, it is removed. An attribute created by hand, with the same name and value, is left in place.

Rules run shortly after a note, a title, or an attribute changes, and once when Trilium opens the database, if any rule notes exist. A problem in a rule is the `#reasoningError` label on the rule note. Fix the rule and the label is cleared on the next run.

Deleting the rule note removes its conclusions on the next run. Deleting the note it describes deletes the child rule note with it.

## Limitations

*   Rules read attributes owned by a note. Inherited attributes are not seen, apart from the `~template` relation that binds `?this` on a template.
*   A rule does not see the attributes it wrote itself, so a conclusion cannot be the condition of that same rule. It does see attributes written by hand, and the conclusions of other rules.
*   The names `reasoningRule`, `reasoningError`, `reasoningScope`, `reasoningSchema`, `template` and `inherit` cannot be conclusions.
*   The rule note is not treated as a child of its parent, so a rule about every child does not match the rule note.
*   Hidden notes are not part of the rules.
*   A protected rule note is read only while the protected session is unlocked.
*   `descendant` does not follow a cycle of clones. A note that is also a direct child is still reached by `child`.