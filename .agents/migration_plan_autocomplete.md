# Migration Plan: `autocomplete.js` → `@algolia/autocomplete-js`

> Issue: https://github.com/TriliumNext/Trilium/issues/5134
> 
> 目标：将旧的 `autocomplete.js@0.38.1`（jQuery 插件）迁移到 `@algolia/autocomplete-js`（独立组件）

---

## 当前状态总览

### 两个库的架构差异
| | 旧 `autocomplete.js` | 新 `@algolia/autocomplete-js` |
|---|---|---|
| 模式 | jQuery 插件，**增强已有 `<input>`** | 独立组件，**传入容器 `<div>`，自己创建 `<input>`** |
| 初始化 | `$el.autocomplete(config, [datasets])` | `autocomplete({ container, getSources, ... })` 返回 `api` |
| 操作 | `$el.autocomplete("open"/"close"/"val")` | `api.setIsOpen()`, `api.setQuery()`, `api.refresh()` |
| 销毁 | `$el.autocomplete("destroy")` | `api.destroy()` |
| 事件 | jQuery 事件 `autocomplete:selected` | `onSelect` 回调、`onStateChange` 回调 |
| DOM | 增强已有 input，添加 `.aa-input` 类 | 替换容器内容为自己的 DOM（`.aa-Form`、`.aa-Panel` 等） |

### 关键迁移原则
1. **不使用 wrapper/适配层**，直接在各 service 中调用 `autocomplete()` API
2. 消费者代码需要适配：传入容器 `<div>` 而非 `<input>`，通过 API/回调读写值
3. 增量迁移：每个使用点独立迁移，逐一验证

### 涉及的功能区域
1. **属性名称自动补全** — `attribute_autocomplete.ts` → `attribute_detail.ts`、`RelationMap.tsx`
2. **标签值自动补全** — `attribute_autocomplete.ts` → `attribute_detail.ts`
3. **笔记搜索自动补全** — `note_autocomplete.ts` → `NoteAutocomplete.tsx`、`attribute_detail.ts`
4. **关闭弹出窗口** — `dialog.ts`、`entrypoints.ts`、`tab_manager.ts`
5. **CKEditor 提及** — 不使用 autocomplete.js，**无需迁移**

---

## 迁移步骤

### Step 0: 安装新依赖 ✅ 完成
**文件变更：**
- `apps/client/package.json` — 添加 `@algolia/autocomplete-js@1.19.6`，暂时保留 `autocomplete.js`

**验证方式：**
- ✅ 新依赖安装成功

---

### Step 1: 迁移属性名称自动补全 ✅ 完成
**文件变更：**
- `apps/client/src/services/attribute_autocomplete.ts` — 将 `initAttributeNameAutocomplete()` 完全使用 **Headless API (`@algolia/autocomplete-core`)** 重写，移除遗留的 jQuery autocomplete 调用。
- `apps/client/src/widgets/attribute_widgets/attribute_detail.ts` — 维持原有 `<input>` 模型不变，仅需增加 `onValueChange` 处理回调。
- `apps/client/src/widgets/type_widgets/relation_map/RelationMap.tsx` — 维持原有回调逻辑，新旧无感替换。
- `apps/client/src/stylesheets/style.css` — 增加自定义 Headless 渲染面板样式 (`.aa-core-panel`，`.aa-core-list` 等)。

**架构说明：**
由于 Trilium 依赖同一页面同时运行多个 autocomplete 生命周期（边栏属性列表，底部编辑器等），原生 `@algolia/autocomplete-js` 会因为单例 DOM 冲突强行报错 "doesn't support multiple instances running at the same time"。
解决方案是退化使用纯状态机的 `@algolia/autocomplete-core`，自己进行 DOM 劫持与面板渲染。
- `requestAnimationFrame`：针对下拉层自动跟踪光标位置，适配面板的高频大小变化
- 事件阻断：拦截了选择时候的 `Enter` 返回键事件气泡，避免误触外层 Dialog 销毁。

**验证方式：**
- ✅ 打开一个笔记 → 点击属性面板弹出 "Label detail" → 输入属性名称时正常显示下拉自动补全框
- ✅ 放大/缩小/变形整个面板，下拉菜单粘连位置准确
- ✅ 键盘上下方向键可高亮，按 Enter 可选中当前项填充，且对话框不关闭
- ✅ 关系图 (Relation map) 创建关系时，关系名输入框的自动补全同样工作正常

---

### Step 2: 迁移标签值自动补全
**文件变更：**
- `apps/client/src/services/attribute_autocomplete.ts` — `initLabelValueAutocomplete()` 改为直接调用 `autocomplete()`
- `apps/client/src/widgets/attribute_widgets/attribute_detail.ts` — 标签值输入框同步调整

**说明：**
与 Step 1 类似，但标签值补全有一个特殊点：每次 focus 都会重新初始化（因为属性名可能变了，需要重新获取可选值列表）。

**验证方式：**
- 打开属性面板 → 输入一个标签名 → 切换到值输入框 → 应能看到该标签的已有值列表

---

### Step 3: 迁移笔记搜索自动补全核心
**文件变更：**
- `apps/client/src/services/note_autocomplete.ts` — `initNoteAutocomplete()` 改为直接调用 `autocomplete()`

**说明：**
这是迁移中最复杂的部分，`initNoteAutocomplete()` 包含：
- 复杂的 source 函数（带防抖、IME 处理）
- 自定义 suggestion 模板（图标、路径高亮）
- 多种选择类型分发（笔记、外部链接、命令）
- `autocomplete("val", ...)` 等操作性 API 调用
- 附带的辅助按钮（清除、最近笔记、全文搜索、跳转按钮）

消费者通过自定义 jQuery 事件（`autocomplete:noteselected` 等）接收结果，需要保持这些事件或改为回调。

**验证方式：**
- 搜索栏 → 输入笔记名称 → 应能看到搜索结果
- 选择结果 → 应正确跳转到对应笔记
- 命令面板（`>` 前缀）正常工作
- 中文输入法不应中途触发搜索
- Shift+Enter 全文搜索、Ctrl+Enter 搜索笔记

---

### Step 4: 迁移辅助函数
**文件变更：**
- `apps/client/src/services/note_autocomplete.ts` — `clearText`, `setText`, `showRecentNotes` 等函数

**说明：**
这些函数使用旧库的操作 API（`$el.autocomplete("val", value)` 等），需要改为新库的 `api.setQuery()` / `api.setIsOpen()` / `api.refresh()`。

**验证方式：**
- 最近笔记按钮 → 下拉菜单正常打开
- 清除按钮 → 输入框被清空
- Shift+Enter → 触发全文搜索

---

### Step 5: 迁移 `NoteAutocomplete.tsx` (React/Preact 组件)
**文件变更：**
- `apps/client/src/widgets/react/NoteAutocomplete.tsx` — 传入容器 `<div>`，管理 `api` 生命周期

**验证方式：**
- 关系属性的目标笔记选择正常工作
- `noteId` 和 `text` props 的动态更新正确

---

### Step 6: 迁移"关闭弹窗"逻辑 + `attribute_detail.ts` 引用
**文件变更：**
- `apps/client/src/services/dialog.ts` — 替换 `$(".aa-input").autocomplete("close")`
- `apps/client/src/components/entrypoints.ts` — 替换 `$(".aa-input").autocomplete("close")`
- `apps/client/src/components/tab_manager.ts` — 替换 `$(".aa-input").autocomplete("close")`
- `apps/client/src/widgets/attribute_widgets/attribute_detail.ts` — 更新 `.algolia-autocomplete` 选择器

**说明：**
需要一个全局的"关闭所有 autocomplete"机制。方案：维护一个全局 `Set<AutocompleteApi>`，在各处调用时遍历关闭。可以放在 `note_autocomplete.ts` 中导出。

**验证方式：**
- autocomplete 弹窗打开时切换标签页 → 弹窗自动关闭
- autocomplete 弹窗打开时打开对话框 → 弹窗自动关闭
- 点击 autocomplete 下拉菜单时属性面板不应关闭

---

### Step 7: 更新 CSS 样式
**文件变更：**
- `apps/client/src/stylesheets/style.css`（第 895-961 行）

**说明：**
新库使用的 CSS 类名：
- `.aa-Autocomplete` — 容器
- `.aa-Form` — 搜索表单（含 input）
- `.aa-Input` — 输入框
- `.aa-Panel` — 下拉面板
- `.aa-List` — 列表
- `.aa-Item` — 列表项
- `.aa-Item[aria-selected="true"]` — 选中项

**验证方式：**
- 下拉菜单样式正常（亮色/暗色模式）
- 选中项高亮正确

---

### Step 8: 更新类型声明
**文件变更：**
- `apps/client/src/types.d.ts` — 移除 `AutoCompleteConfig`、`AutoCompleteArg`、jQuery `.autocomplete()` 方法

**验证方式：**
- TypeScript 编译无错误

---

### Step 9: 移除旧库和 Polyfill
**文件变更：**
- `apps/client/package.json` — 移除 `"autocomplete.js": "0.38.1"`
- `apps/client/src/desktop.ts` — 移除 `import "autocomplete.js/index_jquery.js";`
- `apps/client/src/mobile.ts` — 移除 `import "autocomplete.js/index_jquery.js";`
- `apps/client/src/runtime.ts` — 移除 jQuery polyfill
- `apps/client/src/index.ts` — 移除 jQuery polyfill

**验证方式：**
- 完整回归测试
- 构建无错误

---

### Step 10: 更新 E2E 测试
**文件变更：**
- `apps/server-e2e/src/support/app.ts`
- `apps/server-e2e/src/layout/split_pane.spec.ts`

**验证方式：**
- E2E 测试全部通过

---

## 依赖关系图

```
Step 0 (安装新库) ✅
  ├── Step 1 (属性名称 autocomplete) ← 最简单，优先迁移
  ├── Step 2 (标签值 autocomplete)
  ├── Step 3 (笔记搜索 autocomplete 核心) ← 最复杂
  │   ├── Step 4 (辅助函数)
  │   └── Step 5 (React 组件)
  ├── Step 6 (关闭弹窗 + attribute_detail 引用)
  └── Step 7 (CSS 样式)
      └── Step 8 (类型声明)
          └── Step 9 (移除旧库) ← 最后执行
              └── Step 10 (E2E 测试)
```

## 风险点
1. **消费者代码需要改动**：新库要求传入容器而非 input，消费者需要调整 HTML 模板和值的读写方式。
2. **自定义事件兼容性**：旧库通过 jQuery 事件与外部交互，新库使用回调，`attribute_detail.ts` 等消费者中的事件监听需要更新。
3. **IME 输入处理**：新库原生支持 `ignoreCompositionEvents` 选项，但需要验证行为是否与旧的手动处理一致。
4. **CSS 类名变化**：多处代码通过 `.aa-input`、`.algolia-autocomplete` 定位元素，需要统一更新为新的 `.aa-*` 类名。
5. **全局关闭机制**：旧代码通过 `$(".aa-input").autocomplete("close")` 关闭所有实例，新库需要手动维护实例注册表。
