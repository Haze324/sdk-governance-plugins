/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                  一致性插件 — 报告生成模块                                     ║
║                                                                              ║
║     功能：汇总上游对比结果，生成 GitHub Issue 和静态报告页面                      ║
║                                                                              ║
║     输出：                                                                     ║
║       · Issue 标题：[SDK一致性] <日期> — <SDK名> 缺失 N · 风险 M              ║
║       · Issue body：概览表 + 缺失清单 + Bug 风险清单                            ║
║       · 静态详情页：完整对比结果，可搜索、可展开                                  ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { createIssue, closePreviousIssue, buildPagesReport, commentOnIssue } from '../shared/report-utils';
import { UpstreamAPI } from './upstream-parser';
import { HarmonyAPI } from './harmony-parser';
import { APIComparison, BugRisk } from './comparator';

/** 一致性报告输入 */
export interface ConsistencyReportInput {
  upstream: UpstreamAPI;
  harmony: HarmonyAPI;
  comparison: APIComparison;
  bugRisks: BugRisk[];
  timestamp: string;
}

/** 问题条目（统一数据结构，用于 Issue 和页面生成）*/
export interface ConsistencyFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: '功能缺失' | 'Bug风险';
  sdkName: string;
  item: string;                   // 缺失的类/方法名 或 风险项名
  detail: string;
  suggestion: string;
}

// ============================================================
//  [核心] generateReport — 生成一致性报告
// ============================================================
export async function generateReport(input: ConsistencyReportInput): Promise<void> {
  const findings = collectFindings(input);

  const critical = findings.filter(f => f.severity === 'critical');
  const high = findings.filter(f => f.severity === 'high');
  const medium = findings.filter(f => f.severity === 'medium');
  const low = findings.filter(f => f.severity === 'low');

  const missingCount = findings.filter(f => f.category === '功能缺失').length;
  const bugRiskCount = findings.filter(f => f.category === 'Bug风险').length;

  const date = input.timestamp.slice(0, 10);

  // ----------------------------------------------------------
  //  生成 Issue
  // ----------------------------------------------------------
  const issueTitle = `[SDK一致性] ${date} — ${input.upstream.sdkName} 缺失 ${missingCount} · 风险 ${bugRiskCount}`;

  const issueBody = [
    '## 对比概览',
    '',
    '| 指标 | 数值 |',
    '|------|------|',
    `| 检测时间 | ${input.timestamp} |`,
    `| 上游 SDK | ${input.upstream.sdkName} v${input.upstream.sdkVersion} |`,
    `| 鸿蒙包 | ${input.harmony.sdkName} v${input.harmony.sdkVersion} |`,
    `| 功能缺失 | ${missingCount} 项 |`,
    `| Bug 风险 | ${bugRiskCount} 项 |`,
    '',
    ...(critical.length > 0 ? ['## 严重', '', buildFindingTable(critical)] : []),
    ...(high.length > 0 ? ['## 高风险', '', buildFindingTable(high)] : []),
    ...(medium.length > 0 ? ['## 中风险', '', buildFindingTable(medium)] : []),
    ...(low.length > 0 ? ['## 低风险', '', buildFindingTable(low)] : []),
    '',
    '---',
    '',
    `📋 [查看完整对比报告](https://${getPagesBaseUrl()}/reports/${date}-consistency.html)`,
    '',
    '🔄 回复 `/sdk-consistency` 重新触发一致性检测',
  ].join('\n');

  // 关闭上次还开着的一致性 Issue，再建新的
  // 定时/手动触发 → 建新 Issue + 关旧 Issue
  // Issue 评论触发 → 在原 Issue 下回复简要结果
  const trigger = process.env.TRIGGER_SOURCE || 'schedule';
  const commentIssueUrl = process.env.COMMENT_ISSUE_URL || '';

  let issueUrl = '';
  if (trigger === 'issue_comment' && commentIssueUrl) {
    const commentSummary = [
      '## 一致性检测结果',
      '',
      `上游 ${input.upstream.sdkName} v${input.upstream.sdkVersion} → 鸿蒙 ${input.harmony.sdkName} v${input.harmony.sdkVersion}`,
      '',
      `功能缺失 ${missingCount} 项，Bug 风险 ${bugRiskCount} 项`,
      '',
      critical.length > 0 ? `### 严重（${critical.length}）` : '',
      ...critical.slice(0, 5).map(f => `- **${f.item}**：${f.detail.slice(0, 100)}`),
      '',
      `📋 [完整报告](https://${getPagesBaseUrl()}/reports/${date}-consistency.html)`,
    ].filter(Boolean).join('\n');
    await commentOnIssue(commentIssueUrl, commentSummary);
  } else {
    await closePreviousIssue('SDK一致性');
    issueUrl = await createIssue(issueTitle, issueBody, ['sdk-consistency']);
  }
  console.log(`[一致性报告] 结果已输出`);

  // ----------------------------------------------------------
  //  生成静态详情页
  // ----------------------------------------------------------
  await buildPagesReport(
    { ...input, summary: { missingCount, bugRiskCount } },
    findings,
    issueUrl,
    'consistency'
  );
  console.log('[一致性报告] 静态报告页已生成');
}

// ============================================================
//  辅助函数
// ============================================================

function collectFindings(input: ConsistencyReportInput): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];

  // 功能缺失 → 来自对比结果
  for (const cls of input.comparison.missingClasses) {
    findings.push({
      severity: cls.significance,
      category: '功能缺失',
      sdkName: input.upstream.sdkName,
      item: cls.name,
      detail: cls.description,
      suggestion: '补充实现该类及相关方法',
    });
  }

  for (const func of input.comparison.missingFunctions) {
    findings.push({
      severity: func.significance,
      category: '功能缺失',
      sdkName: input.upstream.sdkName,
      item: func.name,
      detail: func.description,
      suggestion: '在鸿蒙包中补充对应方法',
    });
  }

  for (const mod of input.comparison.missingModules) {
    findings.push({
      severity: mod.significance,
      category: '功能缺失',
      sdkName: input.upstream.sdkName,
      item: `模块: ${mod.name}`,
      detail: mod.description,
      suggestion: '检查该模块所有相关类的实现完整性',
    });
  }

  // Bug 风险 → 来自 Bug 风险分析
  for (const risk of input.bugRisks) {
    findings.push({
      severity: risk.severity,
      category: 'Bug风险',
      sdkName: input.upstream.sdkName,
      item: risk.location,
      detail: `${risk.description}\n影响：${risk.impact}`,
      suggestion: risk.suggestion,
    });
  }

  return findings;
}

function buildFindingTable(findings: ConsistencyFinding[]): string {
  const rows = [
    '| SDK | 条目 | 分类 | 详情 | 建议 |',
    '|-----|------|------|------|------|',
  ];
  for (const f of findings) {
    rows.push(`| ${f.sdkName} | ${f.item} | ${f.category} | ${f.detail.replace(/\n/g, '<br>')} | ${f.suggestion} |`);
  }
  return rows.join('\n');
}

function getPagesBaseUrl(): string {
  const repo = process.env.REPO_NAME || 'Haze324/sdk-governance-plugins';
  const [owner, name] = repo.split('/');
  return `${owner}.github.io/${name}`;
}
