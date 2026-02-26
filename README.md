# Trilium Task Management Enhancement

This PR implements three requested task management features for Trilium Notes:

## 🎯 Features Implemented

### 1. Task Progress Bar
- Automatically calculates completion percentage from checkboxes
- Visual progress bar displayed on Kanban cards
- Shows `(completed/total)` task count

**Usage:**
```markdown
- [x] Task 1
- [x] Task 2  
- [ ] Task 3
```
Result: `67% (2/3)`

### 2. Task Timeline / Due Dates
- Support for due date markers: `[due::2026-03-01]`
- Visual indicators for overdue, today, and upcoming tasks
- Color-coded urgency levels

**Usage:**
```markdown
Project Deadline [due::2026-03-01]
```

### 3. Task Repetition
- Support recurring tasks with `[repeat::pattern]`
- Patterns: daily, weekly, monthly, quarterly, yearly
- Special patterns: weekdays, weekends

**Usage:**
```markdown
Daily Standup [repeat::daily]
Weekly Review [repeat::weekly]
```

## 🛠️ Implementation Details

### Files Added
- `src/widgets/kanban-task-widget.js` - Main widget integration
- `src/components/task-progress-bar.js` - Progress calculation
- `src/components/task-timeline.js` - Due date handling
- `src/components/task-repetition.js` - Recurrence logic

### Integration
The widget integrates with existing Kanban board cards by:
1. Parsing note content for task markers
2. Rendering progress indicators
3. Displaying due dates and repeat patterns

## 🎬 Demo

[Video demonstration of features]

## ✅ Testing

- [x] Progress bar calculates correctly
- [x] Due dates display in correct format
- [x] Repeat patterns recognized
- [x] Widget renders in Kanban view
- [x] Responsive design works

## 📝 Notes

- All features use Trilium's CSS variables for theme compatibility
- No external dependencies added
- Backwards compatible with existing notes

---

Closes #5561
