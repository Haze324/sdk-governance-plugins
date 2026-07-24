/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║   ██████  ██████  ███    ██ ███████ ██ ███████ ███████ ███    ██  ██████╗██╗   ██╗
║  ██      ██    ██ ████   ██ ██      ██ ██      ██      ████   ██ ██       ╚██╗ ██╔╝
║  ██      ██    ██ ██ ██  ██ ███████ ██ ███████ █████   ██ ██  ██ ██   ███  ╚████╔╝
║  ██      ██    ██ ██  ██ ██      ██ ██      ██ ██      ██  ██ ██ ██    ██   ╚██╔╝
║   ██████  ██████  ██   ████ ███████ ██ ███████ ██      ██   ████  ██████╝    ██╝
║                                                                              ║
║                     SDK 一致性检测（上游对比） — 主入口                          ║
║                                                                              ║
║     功能概述：                                                                 ║
║       通过阅读文档和代码，对比转化后的鸿蒙包与上游安卓 SDK，                        ║
║       分析是否存在功能缺失和 bug 风险                                           ║
║                                                                              ║
║     对比维度：                                                                 ║
║       · 公开 API 清单对比（上游有哪些类/方法，鸿蒙包是否都有）                     ║
║       · 关键模块/功能点对比（核心功能模块是否完整）                               ║
║       · Bug 风险分析（转化过程可能引入的问题）                                   ║
║                                                                              ║
║     分析方式：                                                                 ║
║       · 阅读上游 SDK 文档（README、API 文档、源码注释）                           ║
║       · 阅读鸿蒙包的入口文件、类型定义、源码结构                                  ║
║       · 结构对比 + 语义分析                                                     ║
║                                                                              ║
║     输入：上游安卓 SDK 文档/代码 + 转化后的鸿蒙包代码                              ║
║     输出：GitHub Issue（缺失清单 + 风险项） + GitHub Pages 静态报告               ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { parseUpstreamAPI } from './upstream-parser';
import { parseHarmonyPackage } from './harmony-parser';
import { compareAPI, analyzeBugRisks } from './comparator';
import { generateReport } from './report';

// ============================================================
//  [入口] SDK 一致性检测主流程
//  编排顺序：上游解析 → 鸿蒙包解析 → API 对比
//            → Bug 风险分析 → 生成报告 → 发布 Issue
// ============================================================
async function main() {
  console.log('[SDK Consistency] ======== 开始一致性检测 ========');

  // ----------------------------------------------------------
  //  第 1 步：解析上游安卓 SDK
  //  扫描上游文档（README、API 文档、源码目录结构）
  //  提取公开 API 清单、功能模块列表、关键类/方法签名
  // ----------------------------------------------------------
  console.log('[SDK Consistency] ① 解析上游安卓 SDK...');
  const upstreamAPI = await parseUpstreamAPI();
  console.log(`[SDK Consistency]   上游 API: ${upstreamAPI.classes.length} 个类, ${upstreamAPI.functions.length} 个方法`);

  // ----------------------------------------------------------
  //  第 2 步：解析转化后的鸿蒙包
  //  扫描 oh_modules 中的鸿蒙包代码
  //  提取入口文件（Index.ets）、类型定义、模块结构
  // ----------------------------------------------------------
  console.log('[SDK Consistency] ② 解析鸿蒙包...');
  const harmonyAPI = await parseHarmonyPackage();
  console.log(`[SDK Consistency]   鸿蒙 API: ${harmonyAPI.classes.length} 个类, ${harmonyAPI.functions.length} 个方法`);

  // ----------------------------------------------------------
  //  第 3 步：API 清单对比
  //  上游有的类/方法，鸿蒙包是否都有
  //  鸿蒙包多了什么（可能是转化工具新增的兼容层）
  //  鸿蒙包少了什么（可能是功能遗漏）
  // ----------------------------------------------------------
  console.log('[SDK Consistency] ③ API 清单对比...');
  const apiComparison = compareAPI(upstreamAPI, harmonyAPI);

  // ----------------------------------------------------------
  //  第 4 步：Bug 风险分析
  //  基于以下信号判断转化可能引入的问题：
  //    - API 签名变更（参数类型变更、返回值变更）
  //    - 异常处理逻辑缺失
  //    - 异步/同步模式不匹配
  //    - 平台特定能力的适配差异
  // ----------------------------------------------------------
  console.log('[SDK Consistency] ④ Bug 风险分析...');
  const bugRisks = analyzeBugRisks(upstreamAPI, harmonyAPI);

  // ----------------------------------------------------------
  //  第 5 步：汇总 → 生成报告
  //  缺失项 → 按 SDK 分组展示
  //  Bug 风险 → 按严重程度分组
  // ----------------------------------------------------------
  console.log('[SDK Consistency] ⑤ 生成报告...');
  await generateReport({
    upstream: upstreamAPI,
    harmony: harmonyAPI,
    comparison: apiComparison,
    bugRisks,
    timestamp: new Date().toISOString(),
  });

  console.log('[SDK Consistency] ======== 一致性检测完成 ========');
}

main().catch((err) => {
  console.error('[SDK Consistency] 检测异常:', err);
  process.exit(1);
});
