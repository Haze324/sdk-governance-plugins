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
║       3. 生成巡检报告 → Issue + 静态页面                                      ║
║                                                                              ║
║     巡检 = 纯版本审计：只检测 SDK 版本是否落后于上游，不检查其他内容。            ║
║                                                                              ║
║     输入：仓库根目录                                                           ║
║     输出：GitHub Issue + GitHub Pages 静态报告                                 ║
║     触发：定时 / 手动 / Issue 评论                                             ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { scanSDKList, buildDependencyTree } from './scanner';
import { checkVersionOutdated } from './version-check';
import { generateReport } from './report';
import { TriggerSource } from '../shared/config';

// ============================================================
//  [入口] SDK 巡检主流程
//  编排顺序：清单扫描 → 版本落后检测 → 生成报告 → 发布 Issue
// ============================================================
async function main() {
  const trigger = (process.env.TRIGGER_SOURCE || 'schedule') as TriggerSource;

  console.log('[SDK Inspector] ======== 开始巡检 ========');

  // ----------------------------------------------------------
  //  第 1 步：SDK 清单扫描 + 依赖树构建
  //  扫描仓库所有 oh-package.json5，提取依赖信息
  //  扫描范围：dependencies（直接 + 间接），不扫 devDependencies
  // ----------------------------------------------------------
  console.log('[SDK Inspector] ① SDK 清单扫描...');
  const sdkList = await scanSDKList(process.cwd());
  const depTree = buildDependencyTree(sdkList);
  console.log(`[SDK Inspector]   扫描完成：${depTree.totalSDKs} 个 SDK`);

  // ----------------------------------------------------------
  //  第 2 步：版本落后检测
  //  逐个查询上游 registry，对比当前版本是否落后
  //  版本定义：当前版本（lock精确版本）vs 目标版本（仓库指定 > 上游最新）
  //  结果分级：落后 → 报告 | 已是最新 → 跳过 | registry不可达 → 标注 | SDK下架 → 标注
  // ----------------------------------------------------------
  console.log('[SDK Inspector] ② 版本落后检测...');
  const outdatedResult = await checkVersionOutdated(depTree);

  // ----------------------------------------------------------
  //  第 3 步：汇总 + 生成报告
  //  输出：Issue body（概览表 + 版本落后清单 + 已是最新清单）+ 静态详情页
  // ----------------------------------------------------------
  console.log('[SDK Inspector] ③ 生成报告...');
  await generateReport({
    depTree,
    outdated: outdatedResult,
  });

  console.log('[SDK Inspector] ======== 巡检完成 ========');
}

main().catch((err) => {
  console.error('[SDK Inspector] 巡检异常:', err);
  process.exit(1);
});
