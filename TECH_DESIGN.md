# 技术方案：《电子书阅读器》

## 一、概述与目标

纯静态、零依赖、`file://` 双击即用的本地 TXT 阅读器。重点约束：
- **可离线运行**：单开 `index.html` 就能用，无服务器、无构建。
- **可测试**：核心逻辑（章节识别、分页）必须是能在 Node 里直接测的纯函数。
- **数据本地化**：进度/偏好存 `localStorage`，文件不出本机。

## 二、技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 语言 | 纯 HTML/CSS/JS（经典 `<script>`，非 ES module） | 规避浏览器对 `file://` ES 模块的拦截，双击即可用 |
| 依赖 | 无（MVP） | 零安装，符合"轻量"定位 |
| 单元测试 | Node 内置 `node --test` | 无需第三方框架，和 `book.js` 双导出配合 |
| E2E 验证 | 已装 Midscene `browser-automation` 技能 | 真实浏览器冒烟：导入/翻页/跳目录/主题 |

## 三、文件结构

```
index.html        页面骨架：顶栏 + 侧栏目录 + 阅读区 + 分页导航
style.css         布局 + 日/夜主题(CSS 变量, body[data-theme])
book.js           核心纯逻辑库（双导出，可被浏览器和 Node 共用）
app.js            交互与渲染层（导文件、翻页、字号、目录、主题、进度持久化）
book.test.js      node --test 单元测试（章节切分 + 分页 + 页映射）
samples/sample.txt  中文示例书（含"第 X 章"多章）
```

## 四、核心模块设计

### 4.1 `book.js` — 纯逻辑库（双导出）

UMD 模式：浏览器挂 `window.EbookLib`，Node 走 `module.exports`。

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EbookLib = factory();
})(typeof self !== 'undefined' ? self : this, function () { ... });
```

暴露 API：
- `splitIntoChapters(text)` → `[{ title, paragraphs }]`
- `detectChapterTitle(text)` → `{ isTitle, title }`（行是否独立章节标题 + 规范化标题）
- `computeCharsPerPage({ pageWidth, pageHeight, fontSize, lineHeight })` → `charsPerPage`
- `paginate(chapters, charsPerPage)` → `{ pages, chapterStartIndex }`；`pages[i]` = `[{ chapterIdx, text }]`，`chapterStartIndex[chapterIdx]` = 该章首页号

### 4.2 `app.js` — 交互层

- **状态**：`{ name, chapters, pages, chapterStartIndex, currentPage, fontSize, theme }`
- **导入**：`<input type="file" accept=".txt">` + `FileReader.readAsText(utf-8)`；若结果含大量 `U+FFFD` 替换符，回退 `readAsText('gbk')`
- **渲染**：`currentPage` 对应的 `pages[currentPage]`，标题+正文字段；CSS `white-space: pre-wrap; word-break: break-all`
- **翻页**：上/下页按钮 + 左右方向键；`第 X / Y 页`
- **目录**：左侧栏列出 `chapters[].title`，点击跳到 `chapterStartIndex[i]`
- **字号**：14–28px，改后重算 `computeCharsPerPage` + 重新 `paginate`，跳回相近页（按进度百分比保持）
- **主题**：`body.dataset.theme` 切换，CSS 变量随之变化
- **进度**：`localStorage['ebook:progress:' + encodeURIComponent(filename)]` 存 `{page, fontSize, theme}`；打开同文件 → 用存的字号重建分页 → 跳页（越界钳制到末页）

## 五、关键算法

**章节识别**：独立成行的标题才识别，正则 `/(第\s*[0-9一二三四五六七八九十百千万零〇]+\s*[章回节卷篇]|Chapter\s+\d+|[附前置后]言|序章)/`。非标题行归到最近章节。

**分页（纯计算，无可测试障碍）**：
- `charsPerLine = floor(water / fontSize)`（中文字符≈1em 宽），`linesPerPage = floor(pageHeight / lineHeight)`
- `charsPerPage = charsPerLine * linesPerPage`
- 遍历章节段落，累计长度；本页还能容纳则并入，否则在最近的段落/章末断页，启新页
- 记录每个章节进入的页码 → `chapterStartIndex`

**进度恢复**：进度与"内容+字号"绑定，恢复时先按保存的字号重建分页再定位，保证页码有效。

## 六、测试策略

- **单元（`node --test book.test.js`）**：
  - 章节切分：标准"第 X 章"、普通段落归并、无标题全单章、标题边界
  - 分页：`charsPerPage` 数值正确、单页不超长、多章节起始页映射正确
- **E2E（Midscene）**：`file://` 打开 → 导入 `sample.txt` → 断言正文渲染 → 翻页/跳目录 → 切主题 → 刷新后进度恢复
- **手动**：直接双击 `index.html` 冒烟

## 七、边界与限制（MVP）

- 仅 TXT；主 UTF-8，GBK 尽力回退
- 单书、单进度记录（每文件一密钥）；不做书库
- 分页以中文字符≈1em 近似，英文/混排断字可能在词中间（可控）
- 无后端/账号，文件只在本地

## 八、风险与后续

- 风险：分页近似导致个别行溢出 → 用 `overflow: hidden` + 留内存边距兜底；后续可换成基于测量的精确分页
- 后续：EPUB/PDF、书库、进度滑杆、移动端
