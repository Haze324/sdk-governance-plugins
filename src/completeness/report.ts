/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                  完整性检测插件 — 报告生成模块                                  ║
║                                                                              ║
║     功能：汇总上游对比结果，生成 GitHub Issue 和静态报告页面                      ║
║                                                                              ║
║     输出规则（V3.0）：                                                          ║
║       · Action Summary — 每次都有                                              ║
║       · Report Page    — 每次都有                                              ║
║       · Issue          — 只在有功能缺失或 Bug 风险时创建                          ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import {
  createIssue, closeIssueIfNoProblems, buildPagesReport,
  commentOnIssue, writeActionSummary,
  getPagesHost, updateRunName,
} from '../shared/report-utils';
import { UpstreamAPI } from './upstream-parser';
import { HarmonyAPI } from './harmony-parser';
import { APIComparison, BugRisk } from './comparator';

export interface CompletenessReportInput {
  upstream: UpstreamAPI;
  harmony: HarmonyAPI;
  comparison: APIComparison;
  bugRisks: BugRisk[];
  timestamp: string;
}

export interface CompletenessFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: '功能缺失' | 'Bug风险';
  sdkName: string;
  item: string;
  detail: string;
  suggestion: string;
}

// ============================================================
//  [核心] generateReport — 生成完整性报告
// ============================================================
export async function generateReport(input: CompletenessReportInput): Promise<void> {
  const findings = collectFindings(input);

  const critical = findings.filter(f => f.severity === 'critical');
  const high = findings.filter(f => f.severity === 'high');
  const missingCount = findings.filter(f => f.category === '功能缺失').length;
  const bugRiskCount = findings.filter(f => f.category === 'Bug风险').length;
  const hasProblems = missingCount > 0 || bugRiskCount > 0;
  const date = input.timestamp.slice(0, 10);

  const summary = {
    timestamp: input.timestamp,
    repo: process.env.REPO_NAME || '',
    totalFindings: findings.length,
    missingCount,
    bugRiskCount,
    criticalCount: critical.length,
    highCount: high.length,
  };

  const resultSuffix = hasProblems ? 'problem' : 'ok';
  const reportFileName = `${date}-completeness-${resultSuffix}.html`;
  const reportUrl = `https://${getPagesHost()}/reports/${reportFileName}`;

  // ----------------------------------------------------------
  //  ① Action Summary — 每次都有
  // ----------------------------------------------------------
  await writeActionSummary('三方库完整性检测', summary, findings, reportUrl, '', missingCount > 0, false);

  // ----------------------------------------------------------
  //  ② Issue — 只在有问题时创建
  // ----------------------------------------------------------
  const trigger = process.env.TRIGGER_SOURCE || 'schedule';
  const commentIssueUrl = process.env.COMMENT_ISSUE_URL || '';
  let issueUrl = '';

  if (trigger === 'issue_comment' && commentIssueUrl) {
    const commentSummary = [
      '## 完整性检测结果', '',
      `上游 ${input.upstream.sdkName} v${input.upstream.sdkVersion} → 鸿蒙 ${input.harmony.sdkName} v${input.harmony.sdkVersion}`,
      '', `功能缺失 ${missingCount} 项，Bug 风险 ${bugRiskCount} 项`,
      '', ...critical.slice(0, 5).map(f => `- **${f.item}**：${f.detail.slice(0, 100)}`),
      '', `📋 [完整报告](${reportUrl})`,
    ].filter(Boolean).join('\n');
    await commentOnIssue(commentIssueUrl, commentSummary);
  } else {
    if (hasProblems) {
      const title = `[三方库完整性] ${date} — ${input.upstream.sdkName} · 缺失${missingCount}项 · 风险${bugRiskCount}个`;
      const body = [
        '## 对比概览', '',
        '| 指标 | 数值 |', '|------|------|',
        `| 检测时间 | ${input.timestamp} |`,
        `| 上游 SDK | ${input.upstream.sdkName} v${input.upstream.sdkVersion} |`,
        `| 鸿蒙包 | ${input.harmony.sdkName} v${input.harmony.sdkVersion} |`,
        `| 功能缺失 | ${missingCount} 项 |`,
        `| Bug 风险 | ${bugRiskCount} 项 |`, '',
        ...(critical.length > 0 ? ['## 严重', '', buildFindingTable(critical)] : []),
        ...(high.length > 0 ? ['## 高风险', '', buildFindingTable(high)] : []),
        '', '---', '',
        `📋 [查看完整对比报告](${reportUrl})`, '',
        '🔄 回复 `/sdk-completeness` 重新触发检测',
      ].join('\n');
      issueUrl = await createIssue(title, body, ['sdk-completeness']);
    } else {
      await closeIssueIfNoProblems('三方库完整性', 'sdk-completeness', false, false);
    }
  }

  // ----------------------------------------------------------
  //  ③ Run 名称 — 根据结果重命名
  // ----------------------------------------------------------
  const runName = hasProblems
    ? `三方库完整性检测 — ${input.upstream.sdkName} · 缺失${missingCount}项 · 风险${bugRiskCount}个 ⚠️`
    : `三方库完整性检测 — ${input.upstream.sdkName} · ✅ 无问题`;
  await updateRunName(runName);

  // ----------------------------------------------------------
  //  ④ Report Page — 每次都有
  // ----------------------------------------------------------
  await buildPagesReport(summary, findings, issueUrl, reportFileName);
  console.log('[完整性报告] 完成');
}

function collectFindings(input: CompletenessReportInput): CompletenessFinding[] {
  const findings: CompletenessFinding[] = [];
  for (const cls of input.comparison.missingClasses) {
    findings.push({ severity: cls.significance, category: '功能缺失', sdkName: input.upstream.sdkName, item: cls.name, detail: cls.description, suggestion: '补充实现该类及相关方法' });
  }
  for (const func of input.comparison.missingFunctions) {
    findings.push({ severity: func.significance, category: '功能缺失', sdkName: input.upstream.sdkName, item: func.name, detail: func.description, suggestion: '在鸿蒙包中补充对应方法' });
  }
  for (const mod of input.comparison.missingModules) {
    findings.push({ severity: mod.significance, category: '功能缺失', sdkName: input.upstream.sdkName, item: `模块: ${mod.name}`, detail: mod.description, suggestion: '检查该模块所有相关类的实现完整性' });
  }
  for (const risk of input.bugRisks) {
    findings.push({ severity: risk.severity, category: 'Bug风险', sdkName: input.upstream.sdkName, item: risk.location, detail: `${risk.description}\n影响：${risk.impact}`, suggestion: risk.suggestion });
  }
  return findings;
}

function buildFindingTable(findings: CompletenessFinding[]): string {
  const rows = ['| SDK | 条目 | 分类 | 详情 | 建议 |', '|-----|------|------|------|------|'];
  for (const f of findings) {
    rows.push(`| ${f.sdkName} | ${f.item} | ${f.category} | ${f.detail.replace(/\n/g, '<br>')} | ${f.suggestion} |`);
  }
  return rows.join('\n');
}
