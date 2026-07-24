/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                     巡检插件 — 报告生成模块                                    ║
║                                                                              ║
║     功能：汇总版本审计结果，生成两种输出：                                       ║
║                                                                              ║
║       ① GitHub Issue — 概览表 + 版本落后清单 + 已是最新清单                      ║
║       ② 静态详情页 — 完整报告，部署到 GitHub Pages                             ║
║                                                                              ║
║     Issue 生命周期：                                                           ║
║       - 上次巡检的 Issue 还开着 → 关闭旧 Issue，开新的                          ║
║       - 上次 Issue 已关闭（已知悉/已处理）→ 不重复开                            ║
║       - 新扫描发现新问题 → 开新 Issue                                          ║
║                                                                              ║
║     输出分类：                                                                 ║
║       版本落后 → 当前版本 < 上游最新，展示版本差距和更新建议                       ║
║       已是最新 → 当前版本 >= 上游最新，仅列出                                   ║
║       不可达 → registry 不可达或 SDK 已下架                                    ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { DependencyTree } from './scanner';
import { OutdatedResult } from './version-check';
import { createIssue, closePreviousIssue, buildPagesReport, commentOnIssue } from '../shared/report-utils';

/** 报告聚合输入 */
interface ReportInput {
  depTree: DependencyTree;
  outdated: OutdatedResult;
}

/** 问题条目 */
interface Finding {
  category: string;
  title: string;
  module: string;
  detail: string;
  suggestion: string;
  status: 'outdated' | 'uptodate' | 'unreachable';
}

// ============================================================
//  [核心] generateReport — 生成巡检报告
// ============================================================
export async function generateReport(input: ReportInput): Promise<void> {
  const findings = collectFindings(input);

  const outdated = findings.filter(f => f.status === 'outdated');
  const uptodate = findings.filter(f => f.status === 'uptodate');
  const unreachable = findings.filter(f => f.status === 'unreachable');
  const breakingCount = outdated.filter(f => f.detail.includes('跨大版本')).length;

  const summary = {
    timestamp: new Date().toISOString(),
    repo: process.env.REPO_NAME || '',
    totalSDKs: input.depTree.totalSDKs,
    outdatedCount: outdated.length,
    uptodateCount: uptodate.length,
    unreachableCount: unreachable.length,
    breakingCount,
  };

  // ----------------------------------------------------------
  //  生成 Issue
  // ----------------------------------------------------------
  const issueBody = buildIssueBody(summary, outdated, uptodate, unreachable);
  const issueTitle = `[SDK巡检] ${summary.timestamp.slice(0, 10)} — SDK ${summary.totalSDKs} · 落后 ${summary.outdatedCount} · 不可达 ${summary.unreachableCount}`;

  // 定时/手动触发 → 建新 Issue + 关旧 Issue
  // Issue 评论触发 → 在原 Issue 下回复简要结果，不建新 Issue
  const trigger = process.env.TRIGGER_SOURCE || 'schedule';
  const commentIssueUrl = process.env.COMMENT_ISSUE_URL || '';

  if (trigger === 'issue_comment' && commentIssueUrl) {
    // ----------------------------------------------------------
    //  Issue 评论触发 → 在原 Issue 下回复简要结果
    // ----------------------------------------------------------
    await commentOnIssue(commentIssueUrl, buildCommentSummary(summary, outdated, unreachable));
    console.log(`[报告生成] 已在原 Issue 下回复简要结果`);
  } else {
    // ----------------------------------------------------------
    //  定时/手动触发 → 建新的汇总 Issue
    // ----------------------------------------------------------
    await closePreviousIssue('SDK巡检');
    const issueUrl = await createIssue(issueTitle, issueBody, ['sdk-inspect']);
    console.log(`[报告生成] Issue 已创建: ${issueUrl}`);
  }

  // ----------------------------------------------------------
  //  生成静态详情页
  // ----------------------------------------------------------
  await buildPagesReport(summary, findings, issueUrl, 'inspect');
  console.log('[报告生成] 静态报告页已生成');
}

// ============================================================
//  [核心] buildIssueBody — 构建 Issue 正文
// ============================================================
function buildIssueBody(
  summary: Record<string, unknown>,
  outdated: Finding[],
  uptodate: Finding[],
  unreachable: Finding[]
): string {
  const parts = [
    '## 概览',
    '',
    '| 指标 | 数值 |',
    '|------|------|',
    `| 扫描时间 | ${summary['timestamp']} |`,
    `| SDK 总数 | ${summary['totalSDKs']} |`,
    `| 版本落后 | ${summary['outdatedCount']} |`,
    `| 已是最新 | ${summary['uptodateCount']} |`,
    `| 不可达 | ${summary['unreachableCount']} |`,
    '',
  ];

  if (outdated.length > 0) {
    parts.push('## 版本落后', '');
    parts.push('| SDK | 模块 | 当前版本 | 最新版本 | 差距 | 备注 |');
    parts.push('|-----|------|---------|---------|------|------|');
    for (const f of outdated) {
      const parts_match = f.detail.match(/当前 ([\d.]+) → 最新 ([\d.]+)/);
      const current = parts_match ? parts_match[1] : '?';
      const latest = parts_match ? parts_match[2] : '?';
      const gap = f.detail.includes('跨大版本') ? '大版本' : f.detail.includes('补丁') ? '补丁' : '小版本';
      const note = f.detail.includes('跨大版本') ? '含 breaking changes' : f.detail.includes('补丁') ? '非紧急' : '向后兼容';
      parts.push(`| ${f.title} | ${f.module} | ${current} | ${latest} | ${gap} | ${note} |`);
    }
    parts.push('');
  }

  if (uptodate.length > 0) {
    parts.push('## 已是最新', '');
    parts.push('| SDK | 模块 | 版本 |');
    parts.push('|-----|------|------|');
    for (const f of uptodate) {
      parts.push(`| ${f.title} | ${f.module} | ${f.detail} |`);
    }
    parts.push('');
  }

  if (unreachable.length > 0) {
    parts.push('## 不可达', '');
    parts.push('| SDK | 模块 | 问题 |');
    parts.push('|-----|------|------|');
    for (const f of unreachable) {
      parts.push(`| ${f.title} | ${f.module} | ${f.detail} |`);
    }
    parts.push('');
  }

  parts.push('---');
  parts.push('');
  parts.push(`📋 [查看完整报告](https://${getPagesHost()}/reports/${getReportFileName(summary['timestamp'] as string, 'inspect')})`);
  parts.push('');
  parts.push('🔄 回复 `/sdk-inspect` 重新触发巡检');

  return parts.join('\n');
}

// ============================================================
//  [核心] collectFindings — 收集版本审计结果
// ============================================================
function collectFindings(input: ReportInput): Finding[] {
  const findings: Finding[] = [];

  // ----------------------------------------------------------
  //  版本落后
  // ----------------------------------------------------------
  for (const outdated of input.outdated.outdatedSDKs) {
    findings.push({
      category: '版本落后',
      title: outdated.name,
      module: outdated.module,
      detail: `当前 ${outdated.currentVersion} → 最新 ${outdated.latestVersion}${outdated.isBreakingChange ? '（跨大版本，含 breaking changes）' : ''}`,
      suggestion: outdated.isBreakingChange ? '逐步升级，每步验证后再继续' : '建议升级',
      status: 'outdated',
    });
  }

  // ----------------------------------------------------------
  //  registry 不可达
  // ----------------------------------------------------------
  for (const sdkName of input.outdated.unreachableSDKs) {
    findings.push({
      category: '不可达',
      title: sdkName,
      module: '-',
      detail: 'registry 不可达，无法查询最新版本',
      suggestion: '检查 registry 连接和认证配置',
      status: 'unreachable',
    });
  }

  // ----------------------------------------------------------
  //  SDK 已下架
  // ----------------------------------------------------------
  for (const sdkName of input.outdated.yankedSDKs) {
    findings.push({
      category: '已下架',
      title: sdkName,
      module: '-',
      detail: '该 SDK 在 registry 中标记为 yanked（已下架）',
      suggestion: '评估替代方案或联系 SDK 维护方',
      status: 'unreachable',
    });
  }

  // ----------------------------------------------------------
  //  已是最新（从依赖树中筛选出不在落后列表中的 SDK）
  // ----------------------------------------------------------
  const outdatedNames = new Set(input.outdated.outdatedSDKs.map(o => o.name));
  for (const sdk of input.depTree.sdks) {
    if (sdk.dependencyType !== 'direct') continue;  // 只列直接依赖
    if (outdatedNames.has(sdk.name)) continue;
    if (input.outdated.unreachableSDKs.includes(sdk.name)) continue;
    if (!sdk.version) continue;

    findings.push({
      category: '已是最新',
      title: sdk.name,
      module: sdk.module,
      detail: `${sdk.version}`,
      suggestion: '',
      status: 'uptodate',
    });
  }

  return findings;
}

function getReportFileName(timestamp: string, plugin: string): string {
  return `${timestamp.slice(0, 10)}-${plugin}.html`;
}

function getPagesHost(): string {
  const repo = process.env.REPO_NAME || 'Haze324/sdk-governance-plugins';
  const [owner, name] = repo.split('/');
  return `${owner}.github.io/${name}`;
}

// ============================================================
//  构建 Issue 评论回复的简要结果
//  评论触发的，在原 Issue 下回复，不建新 Issue
// ============================================================
function buildCommentSummary(
  summary: Record<string, unknown>,
  outdated: Finding[],
  unreachable: Finding[]
): string {
  const parts = ['## 巡检结果', ''];

  if (outdated.length === 0 && unreachable.length === 0) {
    parts.push(`SDK 总数 ${summary['totalSDKs']}，全部已是最新，未发现版本落后。`);
  } else {
    parts.push(`SDK 总数 ${summary['totalSDKs']}，版本落后 ${summary['outdatedCount']}，不可达 ${summary['unreachableCount']}。`);

    if (outdated.length > 0) {
      parts.push('');
      parts.push('### 版本落后');
      parts.push('');
      parts.push('| SDK | 当前 | 最新 | 差距 |');
      parts.push('|-----|------|------|------|');
      for (const f of outdated) {
        const m = f.detail.match(/当前 ([\d.]+) → 最新 ([\d.]+)/);
        const cur = m?.[1] || '?';
        const latest = m?.[2] || '?';
        const gap = f.detail.includes('跨大版本') ? '大版本 ⚠' : f.detail.includes('补丁') ? '补丁' : '小版本';
        parts.push(`| ${f.title} | ${cur} | ${latest} | ${gap} |`);
      }
    }

    if (unreachable.length > 0) {
      parts.push('');
      parts.push('### 不可达');
      parts.push('');
      for (const f of unreachable) {
        parts.push(`- **${f.title}**：${f.detail}`);
      }
    }
  }

  parts.push('');
  parts.push(`📋 [完整报告](https://${getPagesHost()}/reports/${getReportFileName(summary['timestamp'] as string, 'inspect')})`);

  return parts.join('\n');
}
