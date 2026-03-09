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
4. **优先保留旧版业务逻辑与交互语义**：迁移时默认以旧版 `autocomplete.js` 行为为准，不主动重设计状态流或交互。
5. **只有在新旧包能力或生命周期模型存在冲突、无法直接一一映射时，才允许添加补丁逻辑**；这类补丁的目标不是“接近”，而是尽可能恢复与旧版完全相同的 behavior。

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

### Step 2: 迁移标签值自动补全 ✅ 完成
**文件变更：**
- `apps/client/src/services/attribute_autocomplete.ts` — 移除旧有的 jQuery `$el.autocomplete` 初始化，整体复用封装的 `@algolia/autocomplete-core` Headless 架构流。在内部设计了一套针对 Label Name 值更变时的 `cachedAttributeName` 以及 `getItems` 数据惰性更新机制。
- `apps/client/src/widgets/attribute_widgets/attribute_detail.ts` — 取消监听不标准的 jQuery 强盗冒泡事件 `autocomplete:closed`，改为直接在配置中传入清晰的 `onValueChange` 回调函数。同时解决了所有输入遗留 Bug。

**说明与优化点：**
与 Step 1 类似，同样完全剔除了所有的残旧依赖与 jQuery 控制流，在此基础上还针对值类型的特异性做了几个高级改动：
1. **取消内存破坏型重建 (Fix Memory Leak)**：旧版本在每次触发聚焦 (Focus) 时都会发送摧毁指令强扫 DOM。新架构下只要容器保持存活就仅仅使用 `.refresh()` 接口来控制界面弹出与数据隐式获取。
2. **惰性与本地缓存 (Local Fast CACHE)**：如果关联的属性名 (Attribute Name) 没有被更改，再次打开提示面板时将以 0ms 的延迟抛出旧缓存 `cachedAttributeValues`。一旦属性名被修改，则重新发起服务端网络请求。
3. **彻底分离逻辑**：删除了文件中的 `still using old autocomplete.js` 遗留注释，此时 `attribute_autocomplete.ts` 文件内已经 100% 运行在崭新的 Autocomplete 体系上。

**验证方式：**
- ✅ 打开属性面板 → 点击或输入任意已有 Label 类型的 Name → 切换到值输入框 → 能瞬间弹出相应的旧值提示列表。
- ✅ 在旧值提示列表中用上下方向键选取并回车 → 能实现无缝填充并将更变保存回右侧详细侧边栏。
- ✅ 解决回车冲突：确认选择时系统发出的事件能干净落回所属宿主 DOM 且并不抢占外层组件快捷键。

---

### Step 3: 迁移笔记搜索自动补全核心 (拆分为 4 个增量阶段)

由于搜索自动补全模块（`note_autocomplete.ts`）承载了系统最为复杂的交互、多态分发与 UI，我们将其拆分为 4 个逐步可验证的子阶段：

#### Step 3.1: 基础骨架与核心接口联通 (Headless 骨架) ✅ 完成
**目标：** 用 `@algolia/autocomplete-core` 完全接管旧版的 `$el.autocomplete` 初始化，打通搜索接口。
**工作内容：**
- 在 `initNoteAutocomplete()` 中引入基于 `instanceMap` 的单例验证逻辑与 DOM 隔离。
- 建立 `getSources`，实现调用 `server.get("api/search/autocomplete", ...)`。
- 只做极其简单的 UI（比如简单的 `ul > li` text）将获取到的 `title` 渲染出来，确保网络流程畅通。
**完成情况与验证 (**`apps/client/src/services/note_autocomplete.ts`**)：** 
- ✅ 彻底移除了原依赖于 jQuery `autocomplete.js` 的各种初始化配置与繁复的字符串 DOM 拼接节点。
- ✅ 实现了对 `Jump to Note (Ctrl+J)` 等真实组件的向下兼容事件 (`autocomplete:noteselected`) 无缝派发反馈。
- ✅ 在跳往某个具体笔记或在新建 Relation 面板选用特定目标笔记时，基础请求和简装提示版均工作正常。

#### Step 3.2: 复杂 UI 渲染重构与匹配高亮 (模板渲染) ✅ 基本完成
**目标：** 实现与原版相同级别（甚至更好）的视觉体验（例如笔记图标、上级路径显示、搜索词高亮标红等）。
**工作内容：**
- 重写原有的基于字符串或 jQuery 的构建 DOM 模板代码（专门处理带 `notePath` `icon` `isSearch` 判断等数据）。
- 将 DOM 构建系统集成到 `onStateChange` 的渲染函数里，通过 `innerHTML` 拼装或 DOM 手工建立实现原生高性能面板。
- 引入对应的样式 (`style.css`) 补全排版缺漏。
**验证方式：** 下拉出的搜索面板变得非常美观，与系统的 Dark/Light 色调融合；笔记标题对应的图标出现，匹配的字样高亮突出。
**当前验证结果：**
- ✅ `Ctrl+J / Jump to Note`：UI 渲染、recent notes、键盘/鼠标高亮联动、删空回 recent notes 等核心交互已基本恢复。
- ✅ `attribute_detail.ts` 等依赖 jQuery 事件的目标笔记选择入口，抽查结果正常。
- ⚠️ React 侧消费者尚未完成迁移验收。抽查 `Move to` 时发现功能不正常，这部分应归入 **Step 5** 继续处理，而不是视为 Step 3.2 已全链路完成。

#### Step 3.3: 差异化分发逻辑与对外事件抛出 (交互改造) ✅ 基本完成
**目标：** 支持该组件的多态性。它能在搜笔记之外搜命令（`>` 起手）、甚至是外部链接。同时能够被外部组件监听到选择动作。
**工作内容：**
- 在选择项（`onSelect`）的回调中，根据用户选的是“系统命令”、“外部链接”还是“普通笔记”走截然不同的行为逻辑。
- 对外派发事件：原本通过 `$el.trigger("autocomplete:noteselected")` 的逻辑需要保留，以保证那些使用了搜索框的组件（例如右侧关系面板）依然能顺利收到选中反馈。
**验证方式：** 选中某个建议项时能够真正实现页面的调转/关系绑定；输入 `>` 开头能够列举出所有快捷命令（如 Toggle Dark mode）。
**当前验证结果：**
- ✅ 选择分发已按旧版语义迁移：`command`、`external-link`、`create-note`、`search-notes` 与普通 note 走独立分支。
- ✅ `autocomplete:noteselected`、`autocomplete:externallinkselected`、`autocomplete:commandselected` 三类对外事件均已保留。
- ✅ 鼠标点击和键盘回车现在统一走同一套 `handleSuggestionSelection()` 分发逻辑，不再额外误抛 `autocomplete:noteselected`。
- ✅ `Ctrl+J / Jump to Note` 与 `attribute_detail.ts` 的普通 note 选择链路已抽查通过。
- ⚠️ React 消费方整体仍应放在 **Step 5** 继续验收；`Move to` 等问题不属于 Step 3.3 本身已完成的范围。

#### Step 3.4: 特殊键盘事件拦截与附带按钮包容 (终极打磨) ✅ 基本完成
**目标：** 解决在旧 jQuery 中强绑定的 IME（中日韩等输入法）防抖问题，并恢复如 `Shift+Enter`、周边附加按钮（清除等）的正常运作。
**工作内容：**
- 将旧的输入法合成事件 (`compositionstart` / `compositionend`) 判断逻辑迁移到新的 `onInput` / `onKeyDown` 外围保护之中。
- 重构对 `Shift+Enter` (唤起全文搜索)、`Ctrl+Enter` 等组合快捷键的劫持处理。
- 修正周边辅助控件（例如搜索栏自带的 “最近笔记(钟表)”、“清除栏(X)” 按钮）因为 DOM 结构调整可能引发的影响。
**验证方式：** 中文拼音输入法敲打途中不会错误地发起网络搜索；各种组合回车热键重新生效，整个搜索系统重回巅峰状态。
**当前验证结果：**
- ✅ `compositionstart` / `compositionend` 已恢复旧版保护逻辑：合成期间不发起搜索，结束后按“清空再恢复 query”的语义重新跑一次。
- ✅ `Shift+Enter` 与 `Ctrl+Enter` 的快捷分发仍保留，并已按旧版语义接回全文搜索 / `search-notes`。
- ✅ `autocomplete:opened` / `autocomplete:closed` 事件已重新补回，`readonly` 与“关闭时空输入框清理”逻辑重新对齐旧版。
- ✅ 清空按钮、最近笔记按钮、全文搜索按钮都继续走 service 内部统一入口，而不是分散拼状态。
- ⚠️ 这一步仍以 `note_autocomplete.ts` 核心行为为主；React 消费方的问题继续留在 **Step 5**。

---

### Step 4: 迁移辅助函数 ✅ 完成
**文件变更：**
- `apps/client/src/services/note_autocomplete.ts` — `clearText`, `setText`, `showRecentNotes` 等函数

**说明：**
这些函数使用旧库的操作 API（`$el.autocomplete("val", value)` 等），需要改为新库的 `api.setQuery()` / `api.setIsOpen()` / `api.refresh()`。
这一步与 **Step 3.4** 有交叉，但并不重复：
- **Step 3.4** 关注的是 IME、快捷键、按钮点击后的交互语义是否与旧版一致
- **Step 4** 关注的是 helper 函数本身是否已经彻底切到新 API，而不再依赖旧版 `.autocomplete("...")`

**当前完成情况：**
- ✅ `clearText()` 已改为通过 headless instance 清空 query、关闭面板并触发 `change`
- ✅ `setText()` 已改为通过 `showQuery()` 驱动 `setQuery()` / `refresh()`
- ✅ `showRecentNotes()` 已改为走 `openRecentNotes()`，不再依赖旧版 `.autocomplete("open")`
- ✅ `showAllCommands()` 已改为直接设置 `">"` query 打开命令面板
- ✅ `fullTextSearch()` 已改为使用新状态流重跑全文搜索

**验证方式：**
- 最近笔记按钮 → 下拉菜单正常打开
- 清除按钮 → 输入框被清空
- Shift+Enter → 触发全文搜索

---

### Step 5: 迁移 `NoteAutocomplete.tsx` (React/Preact 组件) ✅ 基本完成
**文件变更：**
- `apps/client/src/widgets/react/NoteAutocomplete.tsx` — 传入容器 `<div>`，管理 `api` 生命周期

**验证方式：**
- 关系属性的目标笔记选择正常工作
- `noteId` 和 `text` props 的动态更新正确

**当前状态：**
- ✅ `NoteAutocomplete.tsx` 已移除残留的旧 `.autocomplete("val")` 调用，改为完全走 `note_autocomplete.ts` 暴露的 helper。
- ✅ 组件现在会显式管理 headless autocomplete 的初始化/销毁生命周期，并清理 React 侧追加的 DOM / jQuery 监听，避免重复绑定。
- ✅ `noteId` / `text` prop 同步已切到新状态流，`setNote()` 也会同步内部 query，避免仅改 DOM 值导致的状态漂移。
- ⚠️ 仍需继续做手动回归验收，重点应覆盖 `Move to`、`Clone to`、`Include note`、`Add link`、bulk actions 等主要 React 消费方。

---

### Step 6: 迁移"关闭弹窗"逻辑 + `attribute_detail.ts` 引用 ✅ 完成
**文件变更：**
- `apps/client/src/services/dialog.ts` — 替换 `$(".aa-input").autocomplete("close")`
- `apps/client/src/components/entrypoints.ts` — 替换 `$(".aa-input").autocomplete("close")`
- `apps/client/src/components/tab_manager.ts` — 替换 `$(".aa-input").autocomplete("close")`
- `apps/client/src/widgets/attribute_widgets/attribute_detail.ts` — 更新 `.algolia-autocomplete` 选择器

**说明：**
引入了全局的 "关闭所有 headless autocomplete" 机制（通过 `closeAllHeadlessAutocompletes` 方法）。

**验证方式：**
- ✅ autocomplete 弹窗打开时切换标签页 → 弹窗自动关闭
- ✅ autocomplete 弹窗打开时打开对话框 → 弹窗自动关闭
- ✅ 点击 autocomplete 下拉菜单时属性面板不应关闭

---

### Step 7: 更新 CSS 样式 ✅ 完成
**文件变更：**
- `apps/client/src/stylesheets/style.css` — 旧 `.aa-dropdown-menu` 兼容样式 + headless autocomplete 主样式（`.aa-core-*`、命令面板、Jump to Note contained panel）
- `apps/client/src/stylesheets/theme-next/base.css` — `Jump to Note` / 空白页结果列表的主题态样式
- `apps/client/src/stylesheets/theme-next/pages.css` — 空白页 contained panel 的页面级样式
- `apps/client/src/widgets/type_widgets/Empty.css` — 空白页 autocomplete 结果容器边框样式

**说明：**
当前实现并没有使用 `@algolia/autocomplete-js` 的默认 DOM（`aa-Autocomplete` / `aa-Form` / `aa-Input` / `aa-Panel` 等），而是基于 `@algolia/autocomplete-core` 自行渲染 headless 面板，因此这里应以**实际渲染出来的类名**为准：
- `.aa-core-panel` — headless 下拉面板
- `.aa-core-panel--contained` — 渲染到外部容器中的 contained 模式面板（如 `Jump to Note`、空白页搜索）
- `.aa-core-list` — 结果列表
- `.aa-core-item` — 结果项
- `.aa-core-item--active` — 当前高亮项
- `.aa-dropdown-menu` / `.aa-suggestions` / `.aa-suggestion` / `.aa-cursor` — 为复用旧主题样式而保留的兼容类名
- `.algolia-autocomplete-container` — 业务侧传入的结果容器，不是新库自动生成的 wrapper

需要注意：
- `NoteAutocomplete.tsx` 仍然渲染原生 `<input class="note-autocomplete form-control">`，并没有 `.aa-Input`
- `note_autocomplete.ts` 会给面板附加 `aa-core-panel aa-dropdown-menu`，给结果列表附加 `aa-core-list aa-suggestions`，给结果项附加 `aa-core-item aa-suggestion`
- 因此 Step 7 的重点不是“套用 Algolia 默认主题”，而是维护 Trilium 自己的 headless 渲染样式与兼容类样式

**验证方式：**
- 下拉菜单样式正常（亮色/暗色模式）
- 选中项高亮正确
- `Jump to Note`、空白页搜索等 contained panel 场景样式正常
- 命令面板（`>`）和普通笔记建议项的布局都正确

**当前完成情况：**
- ✅ `Step 7` 已从“套用 `autocomplete-js` 默认类名”修正为维护当前 headless DOM 的真实样式体系。
- ✅ `style.css` / `theme-next/base.css` / `theme-next/pages.css` / `Empty.css` 的职责范围已在文档中对齐当前实现。
- ✅ 空白页 (`note-detail-empty`) 的 contained panel 已修正为无边框，不再被旧的 `.aa-dropdown-menu` 规则反向覆盖。

---

### Step 8: 更新类型声明 ✅ 完成
**文件变更：**
- `apps/client/src/types.d.ts` — 移除 `AutoCompleteConfig`、`AutoCompleteArg`、jQuery `.autocomplete()` 方法
- `apps/client/src/widgets/PromotedAttributes.tsx` — 移除最后残留的 `$input.autocomplete(...)` 调用，改为复用 `attribute_autocomplete.ts` 的 headless label value autocomplete
- `apps/client/src/services/autocomplete_core.ts` — 收紧 headless source 默认类型，补齐 internal source 所需默认钩子
- `apps/client/src/services/note_autocomplete.ts` — 移除对不存在的 `autocomplete.destroy()` 调用，清理类型不兼容点

**验证方式：**
- TypeScript 编译无错误

**当前完成情况：**
- ✅ `types.d.ts` 中遗留的 `AutoCompleteConfig`、`AutoCompleteArg` 与 jQuery `.autocomplete()` 扩展声明已删除。
- ✅ `PromotedAttributes.tsx` 不再依赖旧版 `autocomplete.js` 类型或初始化流程，至此 client 代码中已无 `.autocomplete(...)` 调用残留。
- ✅ 运行 `pnpm exec tsc -p apps/client/tsconfig.app.json --noEmit` 通过。

---

### Step 9: 移除旧库和 Polyfill ✅ 完成
**文件变更：**
- `apps/client/package.json` — 移除 `"autocomplete.js": "0.38.1"`
- `apps/client/src/desktop.ts` — 移除 `import "autocomplete.js/index_jquery.js";`
- `apps/client/src/mobile.ts` — 移除 `import "autocomplete.js/index_jquery.js";`
- `apps/client/src/runtime.ts` — 移除 jQuery polyfill
- `apps/client/src/index.ts` — 移除 jQuery polyfill

**验证方式：**
- 完整回归测试
- 构建无错误

**当前完成情况：**
- ✅ 代码中的 `autocomplete.js` 入口 import 与仅为旧库保留的 jQuery 4 polyfill 已移除。
- ✅ `apps/client/package.json` 已删除 `autocomplete.js` 依赖声明。
- ✅ `pnpm install` 已执行完成，lockfile / 安装状态已同步。
- ✅ `pnpm exec tsc -p apps/client/tsconfig.app.json --noEmit` 已通过。
- ✅ `pnpm run --filter @triliumnext/client build` 已通过。

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
