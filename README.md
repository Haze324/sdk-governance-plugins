# 三方库 SDK 治理插件

鸿蒙三方库更新检测 + 完整性检测，以 GitHub Actions 形式运行，结果以 Issue + GitHub Pages 静态页面呈现。

---

## 两个工具

| 工具 | 做什么 | 触发方式 | 输出 |
|------|--------|----------|------|
| **三方库更新检测** | 检测 SDK 是否需要更新（OS / 框架 / 上游版本三个方向） | 定时 + 手动 + Issue 评论 | Action Summary + Issue（有问题时）+ Report 页面 |
| **三方库完整性检测** | 转化后鸿蒙包 vs 上游安卓 SDK，分析功能缺失和 bug 风险 | 定时 + 手动 + Issue 评论 | Action Summary + Issue（有问题时）+ Report 页面 |

---

## 三方库更新检测 — 三个方向

| 方向 | 触发条件 | 检测内容 | AI 依赖 |
|------|---------|---------|--------|
| ① OS 升级 | OS API 发生变化 | 下游 SDK 的 API 是否还在新 OS 兼容范围内 | 是 |
| ② 框架升级 | 框架版本发生变化 | 框架不同版本下 API 变化的兼容性问题 | 是 |
| ③ 上游版本 | 版本号检测发现变化 | 版本对比、下载量/使用量、安全漏洞、Changelog | 否 |

---

## 输出规则

```
Action Summary  ──→ 每次都有（完整结果，不管有没有问题）
Report 页面     ──→ 每次都有（GitHub Pages 部署）
Issue           ──→ 只在发现兼容性问题（OS/框架方向）或安全漏洞（上游方向）时创建
                    无上述情况 → 不创建 Issue，如上次有打开则自动关闭
```

---

## 触发指令

在已有 Issue 下评论回复即可触发：

| 指令 | 触发 |
|------|------|
| `/sdk-update` | 三方库更新检测 |
| `/sdk-completeness` | 三方库完整性检测 |

---

## LLM 配置

两个工具的 AI 增强层共用一套配置。**不配 Key 也能以确定性模式正常运行**（精确率略低，但不丢关键数据）。

### 三步配置

**1. 获取 API Key**
- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com/
- 或使用其他兼容 OpenAI API 的服务（DeepSeek、Qwen 等）

**2. 在仓库 Settings → Secrets → Actions 中添加**
- Name: `LLM_API_KEY`
- Value: 你的 API Key

**3. 在 `.sdk-governance.yml` 中声明提供商和模型**

```yaml
llm:
  provider: "openai"           # openai | anthropic | custom
  endpoint: ""                 # 可选，自部署/代理地址
  model: "gpt-4o-mini"         # 推荐
```

### 运行模式

| LLM_API_KEY 是否配置 | 模式 | 表现 |
|---------------------|------|------|
| ✅ 已配置 | LLM 增强 | 精确率 ~89%，兼容性判断和 Changelog 解析使用 AI |
| ❌ 未配置 | 确定性 | 核心功能正常，存疑项标记"待人工确认" |

---

## 配置文件

```yaml
# SDK 治理插件 — 配置文件

# LLM 配置（可选）
llm:
  provider: ""
  endpoint: ""
  model: "gpt-4o-mini"

# 三方库更新检测
update:
  cron: "0 9 * * 1"
  registry: ""
  exclude:
    - internal-test-sdk
  directions:               # 检测方向开关
    os: true
    framework: true
    upstream: true

# 三方库完整性检测
completeness:
  sources:
    - sdk: "pay-sdk"
      maven: "com.example:pay-sdk:2.0.0"
  targets:
    - name: "@ohos/pay-sdk"
```

---

## 代码结构

```
├── .github/workflows/
│   ├── sdk-update.yml           # 更新检测 Action
│   └── sdk-completeness.yml    # 完整性检测 Action
│
├── src/
│   ├── update/                  # 【三方库更新检测】
│   │   ├── main.ts             #   入口 — 三方向编排
│   │   ├── scanner.ts          #   SDK 清单扫描 + 依赖树构建
│   │   ├── version-check.ts    #   上游版本检测（方向③）
│   │   ├── compatibility-check.ts  # OS + 框架兼容性检测（方向①②）
│   │   ├── upstream-check.ts   #   上游方向数据收集
│   │   └── report.ts           #   报告生成 + Issue 生命周期
│   │
│   ├── completeness/            # 【三方库完整性检测】
│   │   ├── main.ts             #   入口 — 编排流程
│   │   ├── upstream-parser.ts  #   上游安卓 SDK 解析
│   │   ├── harmony-parser.ts   #   鸿蒙包解析
│   │   ├── comparator.ts       #   API 对比 + Bug 风险分析
│   │   └── report.ts           #   报告生成
│   │
│   └── shared/                 # 【公共模块】
│       ├── config.ts           #   YAML 配置读取 + LLM 配置
│       ├── llm-client.ts       #   LLM API 调用封装
│       └── report-utils.ts     #   Issue 管理 + HTML 页面生成
│
├── docs/reports/               # GitHub Pages 静态报告
├── .sdk-governance.yml         # 插件配置文件
└── README.md
```

---

## 本地运行

```bash
npm install
npm run update          # 运行三方库更新检测
npm run completeness    # 运行三方库完整性检测
```
