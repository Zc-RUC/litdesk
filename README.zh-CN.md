# LitDesk · 本地文献工作台

**一个安静、本地优先的文献管理台。**

LitDesk 仿照 Zotero 的核心工作流，用于管理本地 PDF 文库、阅读与笔记、生成 CSL 引用、向 WPS/Word 插入带浅灰底纹的域格式引文，并可选择接入 OpenAI 兼容 API 总结文献。

[English](README.md) · [本地部署](#本地部署) · [域格式引用](#域格式引用)

![LitDesk 文献工作台](docs/litdesk-dashboard.png)

## 主要功能

- **文件夹自动同步**：递归读取已有 PDF，自动监听新增、修改、重命名、移除和恢复。重命名或文件暂时缺失不会删除已有书目与笔记，原 PDF 不会被移动或改写。
- **文献管理**：搜索、文件夹、标签、排序、可编辑书目，以及通过 DOI 从 Crossref 补全元数据。对于 `题名_作者_年份.pdf` 命名规范的中文文献，优先使用文件名识别题名和年份，并结合首页补全作者与刊名、清理 CNKI 等无效作者。
- **阅读与笔记**：内置 PDF.js 阅读器，支持页码与缩放；选中原文即可生成带 PDF 页码的摘录。笔记支持 Markdown 和自动保存。
- **真实 CSL 引用**：使用 Citeproc 生成单篇/多篇文内引用与参考文献。内置 APA 7、GB/T 7714—2015 顺序编码与著者—出版年、IEEE、MLA 9、Chicago 著者—年份，支持导入其他 `.csl` 样式，并导出 CSL JSON、BibTeX。
- **浅灰底纹的域引用**：插入真正的域，而不是给文字永久加灰底；域代码中保留文献 ID、样式 ID 和引用类型。
- **可选 AI 解析**：提炼研究问题、研究思路、数据与样本、分析方法、主要结论和局限，并标注原文页码，可一键保存为笔记。
- **本地优先**：仅监听本机回环地址，使用本地 SQLite 数据库，字体本地打包，不强制登录云账号。

## 在线 Demo

可访问 [LitDesk 在线 Demo](https://zc-ruc.github.io/-/litdesk/)。演示使用内置示例文献和浏览器模拟接口，不读取本地文件、不调用真实 AI，也不控制 Word/WPS；刷新页面后恢复示例状态。完整的文件夹监听、本地数据库、真实 AI 和桌面集成仍需按下方说明本地部署。

## 本地部署

### 环境要求

- 推荐使用 macOS，以支持原生文件夹选择和 WPS/Word 域插入。
- Node.js **22.5 或更高版本**，推荐 Node.js 24。
- npm 与现代浏览器。
- 如需应用内插入，安装 WPS Office 和/或 Microsoft Word。

只要 Node.js 版本满足要求，文库、阅读、笔记、CSL 渲染和导出等核心功能也可在其他平台使用；原生应用自动化目前仅适配 macOS。

### 安装并运行

```bash
git clone https://github.com/Zc-RUC/litdesk.git
cd litdesk
npm ci
npm run build
npm start
```

打开 **http://127.0.0.1:8765**。

macOS 也可以直接使用附带的启动脚本：

```bash
chmod +x start.command
./start.command
```

`start.command` 会在需要时安装依赖、构建缺失的前端资源、启动本地服务并打开浏览器。

前端开发模式（Vite 热更新）：

```bash
npm run dev
```

开发页面位于 `http://localhost:5173`，API 请求会代理到本地服务。

### 首次使用

1. 点击「管理文件夹 → 选择系统文件夹」，或输入文献文件夹的绝对路径。
2. 已有 PDF 会自动扫描；保持本地服务运行即可监听后续新增文件。
3. 选择文献后，可编辑书目、阅读 PDF、记笔记或进行 AI 解析。
4. 选择一篇或多篇文献，点击「引用文献」（`Cmd/Ctrl + Shift + C`）。使用 `Cmd/Ctrl + K` 可快速搜索。

## 配置 AI

在「设置」中填写 OpenAI 兼容的 Base URL、模型名称和 API Key。界面提供 OpenAI、Kimi、DeepSeek 和本地模型端点的快捷预设。

所配置服务需要支持 `/chat/completions` 接口。只有当你主动点击「测试连接」「解析」或「AI 补全」时，LitDesk 才会向该服务发送文献文本。长文档会优先选取摘要、方法、数据、结果和结论等相关页，而不是只分析首页。模型因 token 上限截断时，LitDesk 会自动提高额度重试一次，而不是直接解析不完整的响应。扫描版 PDF 需先 OCR。

推理模型可能需要 1–3 分钟才能返回结果。解析或补全期间会显示已等待秒数和「取消」按钮；取消会真正关闭与模型服务的连接（包括截断重试期间），不会修改已有元数据或已保存的解析。切换文献、关闭页面或连接断开也会中止请求。每次模型请求有三分钟超时限制；等待较久不代表 API Key 没有生效。

### 一键 AI 补全

在文献「详情」页点击「一键 AI 补全」。LitDesk 会读取 PDF 前三页和当前书目，补全缺失的作者、来源、DOI、摘要、语言、页码、卷、期、出版方和 URL 等字段。**只填补空缺，不覆盖任何已有值**，包括手动编校的元数据。完成后会明确列出发生变化的字段，AI 补全内容也不会被后续 PDF 自动扫描覆盖。没有缺失字段时，重复补全不会修改记录。扫描版或文本过少的 PDF 会明确提示需要先 OCR，不会生成虚假结果。

也可通过环境变量配置：

```bash
export LITDESK_AI_BASE_URL="https://api.openai.com/v1"
export LITDESK_AI_MODEL="你的模型名称"
export LITDESK_AI_API_KEY="你的 API Key"
npm start
```

环境变量优先于本地保存的 AI 设置。请勿把 API Key 提交到 Git。

## 域格式引用

1. 先在 WPS/Word 中打开目标文档，并把光标放到需要插入的位置。
2. 在 LitDesk 中选择文献，打开「引用中心」。
3. 选择 CSL 样式，以及「文内引用」或「参考文献表」。
4. 点击「插入到 WPS」或「插入到 Word」。

插入内容是真正的域。点击或选中引文时，可显示浅灰色域底纹，具体取决于应用的「域底纹」设置。

- **macOS 版 WPS**：原生 OOXML 域插入已针对文内引用和多篇参考文献实机验证。LitDesk 会通过 WPS 自身复制临时域文档，并在粘贴前核对目标标签页。
- **Microsoft Word**：已包含域插入实现，但当前尚未验证。
- **复制富文本**：得到的是普通格式化文本，不是引用域。
- **自动刷新**：暂不支持。域中保存 LitDesk 元数据，但目前不是支持全文自动刷新的 Zotero 式实时引文域。

## 本地数据与隐私

默认情况下，应用数据位于项目内的 `data/`：

- `data/litdesk.db`：文献、文件夹、笔记、提取文本和已保存的 AI 解析。
- `data/local-settings.json`：本地应用设置，在支持的系统上仅当前用户可读。
- `data/styles/`：用户导入的 CSL 样式。

`data/` 已加入 Git 忽略规则。你的 PDF 始终留在原始受管文件夹中。

可用环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `8765` | 本地 HTTP 端口 |
| `LITDESK_DATA_DIR` | `./data` | 自定义数据目录 |
| `LITDESK_AI_BASE_URL` | OpenAI API 地址 | OpenAI 兼容接口 |
| `LITDESK_AI_MODEL` | 空 | 用于解析的模型 |
| `LITDESK_AI_API_KEY` | 空 | API 凭据 |
| `LITDESK_AI_TEMPERATURE` | `0.2` | 采样温度；要求固定温度的模型可设为 `1` |

服务仅监听 `127.0.0.1`，不监听公网接口，适合单用户本地使用，不应直接暴露到局域网或互联网。

## 当前限制

- 受管文件夹目前主要处理 PDF。
- 扫描版 PDF 需要先 OCR 才能提取文本和进行 AI 解析。
- 暂不提供云端文库同步、多人协作或 Zotero 插件兼容层。
- 域引用暂不支持一键刷新全文。
- 原生文件夹选择和 WPS/Word 自动化目前仅适配 macOS。

## 项目结构

```text
server/          Express API、SQLite、文件夹监听、PDF 提取、
                 CSL 渲染、AI 接口和域插入
src/             React 文库、PDF 阅读器、笔记、引用与设置界面
server/csl/      内置 CSL 样式与 locale
start.command    macOS 启动脚本
```

## 第三方组件

LitDesk 使用 [PDF.js](https://github.com/mozilla/pdf.js)、[Citeproc](https://github.com/Juris-M/citeproc-js)、官方 [CSL 样式](https://github.com/citation-style-language/styles)与 [locale](https://github.com/citation-style-language/locales)、React、Express、Chokidar、DM Sans 和 Source Serif 4。内置 XML 保留了 CSL 样式/locale 的原始元数据；相关资源遵循其原始许可，包括适用时的 CC BY-SA 3.0。PDF.js 使用 Apache-2.0 许可，内置字体使用 SIL Open Font License。
