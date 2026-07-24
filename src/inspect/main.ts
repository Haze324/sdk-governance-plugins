/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║     ███████ ██████  ██   ██     ██ ███    ██ ███████ ██████  ███████  ██████╗████████╗
║     ██      ██   ██ ██  ██      ██ ████   ██ ██      ██   ██ ██      ██       ██    ║
║     ███████ ██   ██ █████       ██ ██ ██  ██ ███████ ██████  █████   ██       ██    ║
║          ██ ██   ██ ██  ██      ██ ██  ██ ██      ██ ██      ██      ██       ██    ║
║     ███████ ██████  ██   ██     ██ ██   ████ ███████ ██      ███████  ██████    ██    ║
║                                                                              ║
║                         SDK 巡检版本审计 — 主入口                              ║
║                                                                              ║
║     功能概述：                                                                 ║
║       1. SDK 清单扫描 + 依赖树构建（扫描所有 oh-package.json5）                  ║
║       2. 版本落后检测（对比上游 registry 最新版本）                              ║
║       3. 风险版本检测（漏洞 / 已知 bug / 禁用版本）                              ║
║       4. 版本一致性检测（多模块一致 / 声明 vs lock / overrides vs lock）         ║
║       5. 生成巡检报告 → Issue + 静态页面                                      ║
║                                                                              ║
║     输入：仓库根目录                                                           ║
║     输出：GitHub Issue + GitHub Pages 静态报告                                 ║
║     触发：定时 / 手动 / Issue 评论                                             ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { scanSDKList, buildDependencyTree } from './scanner';
import { checkVersionOutdated } from './version-check';
import { checkRiskVersions } from './risk-check';
import { checkVersionConsistency } from './version-consistency';
import { generateReport } from './report';
import { TriggerSource } from '../shared/config';

// ============================================================
//  [入口] SDK 巡检主流程
//  编排顺序：清单扫描 → 版本落后检测 → 风险版本检测
//            → 版本一致性检测 → 生成报告 → 发布 Issue
// ============================================================
async function main() {
  const trigger = (process.env.TRIGGER_SOURCE || 'schedule') as TriggerSource;

  console.log('[SDK Inspector] ======== 开始巡检 ========');

  // ----------------------------------------------------------
  //  第 1 步：SDK 清单扫描 + 依赖树构建
  //  扫描仓库所有 oh-package.json5，提取依赖信息
  //  以 overrides 配置为基准修正版本
  // ----------------------------------------------------------
  console.log('[SDK Inspector] ① SDK 清单扫描...');
  const sdkList = await scanSDKList(process.cwd());
  const depTree = buildDependencyTree(sdkList);
  console.log(`[SDK Inspector]   扫描完成：${depTree.totalSDKs} 个 SDK`);

  // ----------------------------------------------------------
  //  第 2 步：版本落后检测
  //  逐个查询上游 registry，对比当前版本是否落后
  //  策略：仓库指定版本 > 上游最新版本
  // ----------------------------------------------------------
  console.log('[SDK Inspector] ② 版本落后检测...');
  const outdatedResult = await checkVersionOutdated(depTree);

  // ----------------------------------------------------------
  //  第 3 步：风险版本检测
  //  对接风险版本数据库，检查是否命中漏洞/已知bug/禁用版本
  //  命中 → 严重问题，必须升级到 fix_version
  // ----------------------------------------------------------
  console.log('[SDK Inspector] ③ 风险版本检测...');
  const riskResult = await checkRiskVersions(depTree);

  // ----------------------------------------------------------
  //  第 4 步：版本一致性检测
  //  检测三项：
  //    - 多模块版本一致性（同一 SDK 在不同模块用了不同版本）
  //    - 声明与 lock 一致性（json5 声明的范围 lock 实际版本是否满足）
  //    - overrides 与 lock 一致性（overrides 强制版本 lock 是否遵循）
  // ----------------------------------------------------------
  console.log('[SDK Inspector] ④ 版本一致性检测...');
  const consistencyResult = checkVersionConsistency(depTree);

  // ----------------------------------------------------------
  //  第 5 步：汇总问题 + 生成报告
  //  问题等级：严重 > 警告 > 提示
  //  输出：Issue body（概览表 + 问题清单）+ 静态详情页
  // ----------------------------------------------------------
  console.log('[SDK Inspector] ⑤ 生成报告...');
  await generateReport({
    depTree,
    outdated: outdatedResult,
    risk: riskResult,
    consistency: consistencyResult,
  });

  console.log('[SDK Inspector] ======== 巡检完成 ========');
}

main().catch((err) => {
  console.error('[SDK Inspector] 巡检异常:', err);
  process.exit(1);
});
