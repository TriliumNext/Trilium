# Task Management for Trilium

This feature adds task management capabilities to Trilium Notes.

## Installation

1. Create a new **Render** type note
2. Add a relation `renderNote` pointing to the code note
3. The widget will display on your Kanban or task notes

## Features

### Task Progress Bar
Automatically calculates progress from checkboxes.

### Due Dates
Add `[due::2026-03-01]` to any task.

### Repetition
Add `[repeat::weekly]` for recurring tasks.

## Usage

See the JavaScript code in `src/widgets/`.
