# 电子书阅读器

纯静态、零依赖、双击即用的本地 TXT 电子书阅读器。无后端、无账号，
阅读进度/字号/主题只存各自浏览器的 `localStorage`；文件不出本机。

## 在网页使用（托管版）

打开 <https://wesson1346.github.io/ebook-reading-web/> → 点「打开 TXT」选本地书 →
分页阅读 / 翻页 / 目录跳转 / 字号调节 / 日夜间主题。

> 每个人的阅读进度按各自浏览器独立记忆，不会上传、不会互相影响。

## 本地使用（离线）

双击 `index.html` 即可，浏览器直接打开，无需安装任何东西。

## 开发

- 单元测试：`node --test book.test.js`（Node 内置测试框架，无需安装依赖）
- E2E 冒烟：`node e2e/smoke.mjs .`（需本机装有 Chrome/Edge）
