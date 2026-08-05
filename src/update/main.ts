/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║     ██    ██ ██████  ██████   █████  ████████ ███████                       ║
║     ██    ██ ██   ██ ██   ██ ██   ██    ██    ██                            ║
║     ██    ██ ██████  ██   ██ ███████    ██    █████                         ║
║     ██    ██ ██      ██   ██ ██   ██    ██    ██                            ║
║      ██████  ██      ██████  ██   ██    ██    ███████                       ║
║                                                                              ║
║                     三方库更新检测 — 主入口                                     ║
║                                                                              ║
║     三个检测方向：                                                              ║
║       ① OS 升级    — OS API 变更时，检测下游 SDK 是否在新 OS 兼容范围内           ║
║       ② 框架升级   — 框架版本变化时，检测 API 变更的兼容性                        ║
║       ③ 上游版本   — 版本号对比、下载量/使用量、安全漏洞、Changelog               ║
║                                                                              ║
║     输出规则：                                                                 ║
║       · Action Summary — 每次都有                                              ║
║       · Report Page    — 每次都有                                              ║
║       · Issue          — 只在有兼容性问题或安全漏洞时创建                         ║
║                                                                              ║
║     触发：定时 / 手动 / Issue 评论                                             ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { scanSDKList, buildDependencyTree } from './scanner';
import { checkCompatibility, CompatibilityIssue } from './compatibility-check';
import { checkUpstreamInfo, UpstreamInfo } from './upstream-check';
import { generateReport } from './report';
import { TriggerSource, getUpdateConfig, getLLMConfig } from '../shared/config';

// ============================================================
//  [入口] 三方库更新检测主流程
// ============================================================
async function main() {
  const trigger = (process.env.TRIGGER_SOURCE || 'schedule') as TriggerSource;
  const commentBody = process.env.COMMENT_BODY || '';

  // ----------------------------------------------------------
  //  触发方式处理
  //    schedule/workflow_dispatch → 直接执行
  //    issue_comment → 检查是否包含 /sdk-update 指令
  // ----------------------------------------------------------
  if (trigger === 'issue_comment') {
    if (!commentBody.includes('/sdk-update')) {
      console.log('[三方库更新] 评论不含 /sdk-update 指令，跳过');
      return;
    }
    console.log('[三方库更新] 收到 Issue 评论触发指令');
  }

  console.log('[三方库更新] ======== 开始更新检测 ========');

  // 读取配置
  const config = getUpdateConfig();
  const llmConfig = getLLMConfig();
  const mode = llmConfig ? 'LLM增强' : '确定性';
  console.log(`[三方库更新] 运行模式: ${mode}`);
  console.log(`[三方库更新] 检测方向: OS=${config.directions.os} 框架=${config.directions.framework} 上游=${config.directions.upstream}`);

  // ----------------------------------------------------------
  //  第 1 步：SDK 清单扫描 + 依赖树构建
  // ----------------------------------------------------------
  console.log('[三方库更新] ① SDK 清单扫描...');
  const sdkList = await scanSDKList(process.cwd());
  const depTree = buildDependencyTree(sdkList);
  console.log(`[三方库更新]   扫描完成：${depTree.totalSDKs} 个 SDK`);

  // ----------------------------------------------------------
  //  第 2 步：三方向检测
  // ----------------------------------------------------------
  console.log('[三方库更新] ② 执行检测...');

  // 方向③：上游版本检测（确定性为主）
  let upstreamInfo: UpstreamInfo | null = null;
  if (config.directions.upstream) {
    console.log('[三方库更新]   方向③ 上游版本检测...');
    upstreamInfo = await checkUpstreamInfo(depTree);
  }

  // 方向①+②：兼容性检测（AI 介入点）
  let compatibilityIssues: CompatibilityIssue[] = [];
  if (config.directions.os || config.directions.framework) {
    console.log('[三方库更新]   方向①+② 兼容性检测...');
    compatibilityIssues = await checkCompatibility(depTree, {
      checkOS: config.directions.os,
      checkFramework: config.directions.framework,
      useLLM: !!llmConfig,
    });
  }

  // ----------------------------------------------------------
  //  第 3 步：汇总 + 生成报告
  // ----------------------------------------------------------
  console.log('[三方库更新] ③ 生成报告...');
  await generateReport({
    depTree,
    compatibilityIssues,
    upstreamInfo,
    mode,
  });

  console.log('[三方库更新] ======== 更新检测完成 ========');
}

main().catch((err) => {
  console.error('[三方库更新] 检测异常:', err);
  process.exit(1);
});
