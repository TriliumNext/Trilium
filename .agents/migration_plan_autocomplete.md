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

#### Step 3.4: 特殊键盘事件拦截与附带按钮包容 (终极打磨)
**目标：** 解决在旧 jQuery 中强绑定的 IME（中日韩等输入法）防抖问题，并恢复如 `Shift+Enter`、周边附加按钮（清除等）的正常运作。
**工作内容：**
- 将旧的输入法合成事件 (`compositionstart` / `compositionend`) 判断逻辑迁移到新的 `onInput` / `onKeyDown` 外围保护之中。
- 重构对 `Shift+Enter` (唤起全文搜索)、`Ctrl+Enter` 等组合快捷键的劫持处理。
- 修正周边辅助控件（例如搜索栏自带的 “最近笔记(钟表)”、“清除栏(X)” 按钮）因为 DOM 结构调整可能引发的影响。
**验证方式：** 中文拼音输入法敲打途中不会错误地发起网络搜索；各种组合回车热键重新生效，整个搜索系统重回巅峰状态。

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

**当前状态：**
- ⚠️ 尚未完成。虽然底层 `note_autocomplete.ts` 已经切到新实现，但 React 消费方仍需逐一验收。
- ⚠️ 已抽查 `Move to`，当前功能不正常，说明 Step 5 仍存在待修复问题。

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
