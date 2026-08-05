/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                     更新检测插件 — 报告生成模块                                 ║
║                                                                              ║
║     输出规则（V3.0）：                                                          ║
║       ① Action Summary — 每次都有（写入 GITHUB_STEP_SUMMARY）                   ║
║       ② Report Page    — 每次都有（GitHub Pages 部署）                          ║
║       ③ Issue          — 只在有兼容性问题或安全漏洞时创建                         ║
║                                                                              ║
║     Issue 评论触发 → 在原 Issue 下回复简要结果，不建新 Issue                     ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { DependencyTree } from './scanner';
import { CompatibilityIssue } from './compatibility-check';
import { UpstreamInfo } from './upstream-check';
import {
  createIssue, closeIssueIfNoProblems, buildPagesReport,
  commentOnIssue, writeActionSummary, closePreviousIssue,
} from '../shared/report-utils';

/** 报告输入 */
export interface ReportInput {
  depTree: DependencyTree;
  compatibilityIssues: CompatibilityIssue[];
  upstreamInfo: UpstreamInfo | null;
  mode: string;
}

/** 问题条目 */
interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  module: string;
  detail: string;
  suggestion: string;
}

// ============================================================
//  [核心] generateReport — 生成更新检测报告
// ============================================================
export async function generateReport(input: ReportInput): Promise<void> {
  const findings = collectFindings(input);

  // 统计
  const compatIssues = findings.filter(f => f.category === '兼容性问题');
  const securityVulns = input.upstreamInfo?.securityVulnerabilities || [];
  const outdated = findings.filter(f => f.category === '版本落后');
  const uptodate = findings.filter(f => f.category === '已是最新');
  const unreachable = findings.filter(f => f.category === '不可达');

  const hasCompatibilityIssue = compatIssues.length > 0;
  const hasSecurityVulnerability = securityVulns.length > 0;
  const hasProblems = hasCompatibilityIssue || hasSecurityVulnerability;

  const timestamp = new Date().toISOString();
  const summary = {
    timestamp,
    repo: process.env.REPO_NAME || '',
    totalSDKs: input.depTree.totalSDKs,
    outdatedCount: outdated.length,
    compatIssueCount: compatIssues.length,
    securityVulnCount: securityVulns.length,
    uptodateCount: uptodate.length,
    unreachableCount: unreachable.length,
    mode: input.mode,
  };

  const reportUrl = `https://${getPagesHost()}/reports/${timestamp.slice(0, 10)}-update.html`;

  // ----------------------------------------------------------
  //  ① Action Summary — 每次都有
  // ----------------------------------------------------------
  await writeActionSummary('三方库更新检测', summary, findings, reportUrl, '', hasCompatibilityIssue, hasSecurityVulnerability);

  // ----------------------------------------------------------
  //  ② Issue — 只在有问题时创建
  // ----------------------------------------------------------
  const trigger = process.env.TRIGGER_SOURCE || 'schedule';
  const commentIssueUrl = process.env.COMMENT_ISSUE_URL || '';
  let issueUrl = '';

  if (trigger === 'issue_comment' && commentIssueUrl) {
    // Issue 评论触发 → 总是回复
    await commentOnIssue(commentIssueUrl, buildCommentSummary(summary, compatIssues, securityVulns, outdated, unreachable));
  } else {
    if (hasProblems) {
      // 关旧 Issue + 开新 Issue
      await closePreviousIssue('三方库更新', 'sdk-update');
      const title = `[三方库更新] ${timestamp.slice(0, 10)} — SDK ${summary.totalSDKs} · 兼容性 ${compatIssues.length} · 漏洞 ${securityVulns.length}`;
      issueUrl = await createIssue(title, buildIssueBody(summary, compatIssues, securityVulns, outdated, uptodate, unreachable, reportUrl), ['sdk-update']);
    } else {
      // 无问题 → 关闭旧的 Issue
      await closeIssueIfNoProblems('三方库更新', 'sdk-update', false, false);
    }
  }

  // ----------------------------------------------------------
  //  ③ Report Page — 每次都有
  // ----------------------------------------------------------
  await buildPagesReport(summary, findings, issueUrl, 'update');
  console.log('[更新检测报告] 完成');
}

// ============================================================
//  构建 Issue 正文
// ============================================================
function buildIssueBody(
  summary: Record<string, unknown>,
  compatIssues: Finding[],
  securityVulns: unknown[],
  outdated: Finding[],
  uptodate: Finding[],
  unreachable: Finding[],
  reportUrl: string
): string {
  const parts: string[] = [];

  // 概览
  parts.push('## 概览', '',
    '| 指标 | 数值 |', '|------|------|',
    `| 扫描时间 | ${summary['timestamp']} |`,
    `| SDK 总数 | ${summary['totalSDKs']} |`,
    `| 运行模式 | ${summary['mode']} |`,
    `| 兼容性问题 | ${summary['compatIssueCount']} |`,
    `| 安全漏洞 | ${summary['securityVulnCount']} |`,
    `| 版本落后 | ${summary['outdatedCount']} |`,
    `| 不可达 | ${summary['unreachableCount']} |`, '');

  // 兼容性问题
  if (compatIssues.length > 0) {
    parts.push('## ⚠️ 兼容性问题', '',
      '| SDK | 模块 | 方向 | 类别 | 详情 | 建议 |',
      '|-----|------|------|------|------|------|');
    for (const f of compatIssues) {
      parts.push(`| ${f.title} | ${f.module} | ${(f as any)['direction'] || '-'} | ${f.category} | ${f.detail} | ${f.suggestion} |`);
    }
    parts.push('');
  }

  // 安全漏洞
  if (securityVulns.length > 0) {
    parts.push('## 🔒 安全漏洞', '',
      '| 漏洞ID | 严重程度 | 描述 | 修复版本 |',
      '|--------|---------|------|---------|');
    for (const v of securityVulns as any[]) {
      parts.push(`| ${v.id} | ${v.severity} | ${v.description} | ${v.fixedVersion} |`);
    }
    parts.push('');
  }

  // 版本落后
  if (outdated.length > 0) {
    parts.push('## 版本落后', '',
      '| SDK | 模块 | 当前版本 | 最新版本 | 差距 |',
      '|-----|------|---------|---------|------|');
    for (const f of outdated) {
      const m = f.detail.match(/当前 ([\d.]+) → 最新 ([\d.]+)/);
      parts.push(`| ${f.title} | ${f.module} | ${m?.[1] || '?'} | ${m?.[2] || '?'} | ${f.detail.includes('跨大版本') ? '大版本' : '小版本'} |`);
    }
    parts.push('');
  }

  // 不可达
  if (unreachable.length > 0) {
    parts.push('## 不可达', '',
      '| SDK | 问题 |', '|-----|------|');
    for (const f of unreachable) {
      parts.push(`| ${f.title} | ${f.detail} |`);
    }
    parts.push('');
  }

  parts.push('---', '',
    `📋 [查看完整报告](${reportUrl})`, '',
    '🔄 回复 `/sdk-update` 重新触发检测');

  return parts.join('\n');
}

// ============================================================
//  collectFindings — 收集所有发现
// ============================================================
function collectFindings(input: ReportInput): Finding[] {
  const findings: Finding[] = [];

  // 兼容性问题
  for (const issue of input.compatibilityIssues) {
    findings.push({
      severity: issue.severity,
      category: '兼容性问题',
      title: issue.sdkName,
      module: issue.module,
      detail: issue.description + '\n影响：' + issue.impact,
      suggestion: issue.suggestion,
    });
  }

  // 版本落后
  if (input.upstreamInfo) {
    for (const o of input.upstreamInfo.outdatedSDKs) {
      findings.push({
        severity: o.isBreakingChange ? 'high' : 'medium',
        category: '版本落后',
        title: o.name,
        module: o.module,
        detail: `当前 ${o.currentVersion} → 最新 ${o.latestVersion}${o.isBreakingChange ? '（跨大版本，含 breaking changes）' : ''}`,
        suggestion: o.isBreakingChange ? '逐步升级，每步验证后再继续' : '建议升级',
      });
    }
    for (const name of input.upstreamInfo.unreachableSDKs) {
      findings.push({
        severity: 'low', category: '不可达', title: name, module: '-',
        detail: 'registry 不可达，无法查询最新版本',
        suggestion: '检查 registry 连接和认证配置',
      });
    }
    for (const name of input.upstreamInfo.yankedSDKs) {
      findings.push({
        severity: 'low', category: '已下架', title: name, module: '-',
        detail: '该 SDK 在 registry 中标记为 yanked（已下架）',
        suggestion: '评估替代方案或联系 SDK 维护方',
      });
    }
  }

  // 已是最新
  const outdatedNames = new Set(input.upstreamInfo?.outdatedSDKs.map(o => o.name) || []);
  for (const sdk of input.depTree.sdks) {
    if (sdk.dependencyType !== 'direct') continue;
    if (outdatedNames.has(sdk.name)) continue;
    if (!sdk.version) continue;
    findings.push({
      severity: 'low', category: '已是最新', title: sdk.name,
      module: sdk.module, detail: `${sdk.version}`, suggestion: '',
    });
  }

  return findings;
}

// ============================================================
//  buildCommentSummary — 评论回复简要结果
// ============================================================
function buildCommentSummary(
  summary: Record<string, unknown>,
  compatIssues: Finding[],
  securityVulns: unknown[],
  outdated: Finding[],
  unreachable: Finding[]
): string {
  const parts = ['## 更新检测结果', ''];

  if (compatIssues.length === 0 && securityVulns.length === 0 && outdated.length === 0) {
    parts.push(`SDK 总数 ${summary['totalSDKs']}，全部已是最新，未发现问题。`);
  } else {
    parts.push(`SDK 总数 ${summary['totalSDKs']}，兼容性问题 ${summary['compatIssueCount']}，安全漏洞 ${summary['securityVulnCount']}，版本落后 ${summary['outdatedCount']}。`);

    if (compatIssues.length > 0) {
      parts.push('', '### 兼容性问题', '',
        '| SDK | 方向 | 详情 |', '|-----|------|------|');
      for (const f of compatIssues.slice(0, 10)) {
        parts.push(`| ${f.title} | ${(f as any)['direction'] || '-'} | ${f.detail.slice(0, 100)} |`);
      }
    }

    if (securityVulns.length > 0) {
      parts.push('', '### 安全漏洞', '');
      for (const v of securityVulns as any[]) {
        parts.push(`- **${v.id}**：${v.severity} — ${v.description}`);
      }
    }
  }

  parts.push('', `📋 [完整报告](https://${getPagesHost()}/reports/${(summary['timestamp'] as string).slice(0, 10)}-update.html)`);
  return parts.join('\n');
}

function getPagesHost(): string {
  const repo = process.env.REPO_NAME || 'Haze324/sdk-governance-plugins';
  const [owner, name] = repo.split('/');
  return `${owner}.github.io/${name}`;
}
