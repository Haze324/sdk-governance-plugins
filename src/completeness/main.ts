/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║  ██████  ██████  ███    ██ ███████ ██      ███████ ████████ ███████ ███    ██ ███████ ███████ ███████
║  ██      ██    ██ ████   ██ ██      ██      ██         ██    ██      ████   ██ ██      ██      ██
║  ██      ██    ██ ██ ██  ██ ███████ ██      █████      ██    █████   ██ ██  ██ █████   ███████ ███████
║  ██      ██    ██ ██  ██ ██      ██ ██      ██         ██    ██      ██  ██ ██ ██           ██      ██
║   ██████  ██████  ██   ████ ███████ ███████ ███████    ██    ███████ ██   ████ ███████ ███████ ███████
║                                                                              ║
║                    三方库完整性检测 — 主入口                                     ║
║                                                                              ║
║     功能概述：                                                                 ║
║       通过阅读文档和代码，对比转化后的鸿蒙包与上游安卓 SDK，                        ║
║       分析是否存在功能缺失和 bug 风险                                           ║
║                                                                              ║
║     输入：上游安卓 SDK 文档/代码 + 转化后的鸿蒙包代码                              ║
║     输出：GitHub Issue + GitHub Pages 静态报告                                 ║
║     触发：定时 / 手动 / Issue 评论                                             ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { parseUpstreamAPI } from './upstream-parser';
import { parseHarmonyPackage } from './harmony-parser';
import { compareAPI, analyzeBugRisks } from './comparator';
import { generateReport } from './report';

// ============================================================
//  [入口] 三方库完整性检测主流程
// ============================================================
async function main() {
  const trigger = process.env.TRIGGER_SOURCE || 'schedule';
  const commentBody = process.env.COMMENT_BODY || '';

  // ----------------------------------------------------------
  //  触发方式处理
  // ----------------------------------------------------------
  if (trigger === 'issue_comment') {
    if (!commentBody.includes('/sdk-completeness')) {
      console.log('[三方库完整性] 评论不含 /sdk-completeness 指令，跳过');
      return;
    }
    console.log('[三方库完整性] 收到 Issue 评论触发指令');
  }

  console.log('[三方库完整性] ======== 开始完整性检测 ========');

  console.log('[三方库完整性] ① 解析上游安卓 SDK...');
  const upstreamAPI = await parseUpstreamAPI();

  console.log('[三方库完整性] ② 解析鸿蒙包...');
  const harmonyAPI = await parseHarmonyPackage();

  console.log('[三方库完整性] ③ API 清单对比...');
  const apiComparison = compareAPI(upstreamAPI, harmonyAPI);

  console.log('[三方库完整性] ④ Bug 风险分析...');
  const bugRisks = analyzeBugRisks(upstreamAPI, harmonyAPI);

  console.log('[三方库完整性] ⑤ 生成报告...');
  await generateReport({
    upstream: upstreamAPI,
    harmony: harmonyAPI,
    comparison: apiComparison,
    bugRisks,
    timestamp: new Date().toISOString(),
  });

  console.log('[三方库完整性] ======== 完整性检测完成 ========');
}

main().catch((err) => {
  console.error('[三方库完整性] 检测异常:', err);
  process.exit(1);
});
