/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                           SDK 治理插件                                        ║
║                                                                              ║
║  两个 GitHub Actions 插件，用于鸿蒙三方库 SDK 的自动化治理：                      ║
║                                                                              ║
║    🔍 SDK 巡检版本审计 — 版本落后、风险版本                                    ║
║    🔬 SDK 一致性检测 — 转化后的鸿蒙包 vs 上游安卓 SDK，功能缺失和 bug 风险       ║
║                                                                              ║
║  本仓库是一个高保真参考实例，展示插件最终呈现给用户的效果。                         ║
║                                                                              ║
║     仓库地址：https://github.com/Haze324/sdk-governance-plugins                ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

# SDK 治理插件 — 高保真参考实例

鸿蒙三方库 SDK 巡检版本审计 + 上游一致性检测，以 GitHub Actions 形式运行，结果以 Issue + GitHub Pages 静态页面呈现。

---

## 两个插件

| 插件 | 做的事 | 触发时机 | 输出 |
|------|--------|----------|------|
| **SDK 巡检版本审计** | 版本落后检测、风险版本检测 | 定时（每周一）+ 手动 + Issue 评论 | GitHub Issue + 静态报告页 |
| **SDK 一致性检测** | 转化后鸿蒙包 vs 上游安卓 SDK，分析功能缺失和 bug 风险 | 定时（每周一）+ 手动 + Issue 评论 | GitHub Issue + 静态报告页 |

---

## 用户体验路径

```
Issues tab        →  看到巡检 Issue 和一致性 Issue
                      标题直观显示问题统计

点进 Issue        →  概览表 + 问题清单
                      按严重程度分组，表格化展示

点报告链接        →  GitHub Pages 静态页面
                      完整详情，可搜索、可筛选、可展开

回复 Issue        →  输入 /sdk-inspect 或 /sdk-consistency
                      自动触发重新扫描

Actions tab       →  查看历史运行记录
                      手动触发、查看日志
```

---

## 示例效果

### 1. Issues tab 中的效果

![Issues tab 示意 —— 两个插件产生的 Issue 并列显示，标题包含日期和问题统计]

当前已生成的示例 Issue：
- [[SDK巡检] 2026-07-24 — SDK 12 · 严重 3 · 警告 5](https://github.com/Haze324/sdk-governance-plugins/issues/1)
- [[SDK一致性] 2026-07-24 — pay-sdk 缺失 4 · 风险 3](https://github.com/Haze324/sdk-governance-plugins/issues/2)

### 2. 点进 Issue 看到的内容

Issue body 包含：
- **概览表** — 扫描时间、SDK 总数、问题数量和等级分布
- **严重问题清单** — 风险版本命中（漏洞/bug/禁用）
- **警告清单** — 版本落后、多模块不一致、声明 vs lock 不一致
- **操作入口** — 完整报告链接 + 手动触发指令

### 3. 报告页面

[查看示例报告](https://Haze324.github.io/sdk-governance-plugins/reports/2026-07-24-inspect.html)

页面功能：
- **概览卡片** — SDK 总数、严重/警告/提示数量
- **搜索过滤** — 按 SDK 名称或问题关键词搜索
- **等级筛选** — 全部 / 严重 / 警告 / 提示，一键切换
- **展开折叠** — 点击问题标题展开查看详情和建议
- **严重问题默认展开** — 强制用户看到最关键的信息

---

## 代码结构

```
├── .github/workflows/
│   ├── sdk-inspect.yml          # 巡检 Action 定义
│   └── sdk-consistency.yml      # 一致性 Action 定义
│
├── src/
│   ├── inspect/                 # 【巡检插件】
│   │   ├── main.ts              #   入口 — 编排巡检流程
│   │   ├── scanner.ts           #   SDK 清单扫描 + 依赖树构建
│   │   ├── version-check.ts     #   版本落后检测
│   │   └── report.ts            #   生成 Issue + 静态页面
│   │
│   ├── consistency/             # 【一致性插件】
│   │   ├── main.ts              #   入口 — 编排一致性检测流程
│   │   ├── upstream-parser.ts   #   上游安卓 SDK 解析
│   │   ├── harmony-parser.ts    #   鸿蒙包解析
│   │   ├── comparator.ts        #   API 对比 + Bug 风险分析
│   │   └── report.ts            #   生成 Issue + 静态页面
│   │
│   └── shared/                  # 【公共模块】
│       ├── report-utils.ts      #   Issue 创建/关闭 + HTML 页面生成
│       └── config.ts            #   YAML 配置读取
│
├── docs/reports/                # GitHub Pages 的静态报告
├── .sdk-governance.yml          # 插件配置文件
└── README.md
```

---

## 配置文件

仓库根目录的 `.sdk-governance.yml`：

```yaml
# SDK 巡检版本审计
inspect:
  cron: "0 9 * * 1"              # 巡检 cron 表达式（每周一早9点）
  registry: https://xxx           # 私有 registry 地址，不填走开源默认
  exclude:                        # 排除的 SDK 列表，跳过巡检
    - internal-test-sdk

# SDK 一致性检测
consistency:
  sources:                        # 上游安卓 SDK 数据来源
    - sdk: "pay-sdk"
      maven: "com.example:pay-sdk:2.0.0"
    - sdk: "map-sdk"
      source: "https://github.com/example/map-sdk"
  targets:                        # 要检测的鸿蒙包
    - name: "@ohos/pay-sdk"
    - name: "@ohos/map-sdk"
```

---

## 手动触发

在已有 Issue 下评论回复对应指令即可触发：

| 指令 | 触发的插件 |
|------|-----------|
| `/sdk-inspect` | SDK 巡检版本审计 |
| `/sdk-consistency` | SDK 一致性检测 |

---

## Issue 生命周期

- 每次巡检/检测 → 新建一个汇总 Issue
- Issue 标题格式固定，含日期和问题统计，一眼可扫
- 新 Issue 创建前，会自动关闭上次还开着的同类型 Issue
- 如果上次 Issue 已被手动关闭（已知悉/已处理），不重复开（除非扫出新问题）

---

## 报告页面设计要点

设计原则：干净、工具感、不花哨，像 GitHub 原生功能一样。

| 元素 | 设计 |
|------|------|
| 概览卡片 | 5 个卡片横排，大数字 + 小标签，颜色区分等级 |
| 问题列表 | 按严重程度分组，每组有小标题 + 计数 |
| 颜色系统 | 红（严重/高风险）· 黄（警告/中风险）· 蓝（提示/低风险） |
| 交互 | 搜索框过滤 + 等级按钮筛选 + 点击展开详情 |
| 底部 | 生成信息 + "查看 GitHub Issue" 跳转链接 |
| 响应式 | 自适应，手机上也能看 |
