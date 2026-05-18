# Issue 5561 - Task Management Playbook

This note proposes a staged implementation approach for issue [#5561](https://github.com/TriliumNext/Trilium/issues/5561).

## Goals

- Define a minimal but useful task data model in notes metadata.
- Keep compatibility with existing note workflows.
- Support both desktop and mobile interactions.

## Phase 1 - Core Data Model

- Introduce task attributes:
  - `task:status` (`todo`, `in_progress`, `done`, `blocked`)
  - `task:dueDate` (ISO date string)
  - `task:priority` (`low`, `normal`, `high`)
- Keep attributes optional to avoid migration breakage.

## Phase 2 - Basic UX

- Add quick actions in note context menu:
  - mark done
  - set in progress
  - postpone due date
- Add a compact task badge in tree / note header.

## Phase 3 - Views and Filters

- Add built-in search snippets for:
  - overdue tasks
  - tasks due today
  - blocked tasks
- Provide launch bar shortcuts for these views.

## API and Scripting Considerations

- Expose task fields through existing note APIs.
- Keep read/write operations scriptable for automation.
- Do not introduce a separate storage table in initial phase.

## Non-Goals

- Full Kanban board in the first iteration.
- Multi-user assignment workflow in phase 1.
