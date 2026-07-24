/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                     巡检插件 — 报告生成模块                                    ║
║                                                                              ║
║     功能：汇总版本审计结果，生成两种输出：                                       ║
║                                                                              ║
║       ① GitHub Issue — 概览表 + 问题清单（按严重程度分组）                      ║
║       ② 静态详情页 — 完整报告，部署到 GitHub Pages                             ║
║                                                                              ║
║     Issue 生命周期：                                                           ║
║       - 上次巡检的 Issue 还开着 → 关闭旧 Issue，开新的                          ║
║       - 上次 Issue 已关闭（已知悉/已处理）→ 不重复开                            ║
║       - 新扫描发现新问题 → 开新 Issue                                          ║
║                                                                              ║
║     问题等级与触发条件：                                                        ║
║       严重 → 风险版本命中（漏洞 / 已知bug / 禁用版本）                           ║
║       警告 → 版本落后                                                          ║
║       提示 → registry 不可达、lock 文件缺失                                    ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { DependencyTree } from './scanner';
import { OutdatedResult } from './version-check';
import { RiskResult } from './risk-check';
import { createIssue, closePreviousIssue, buildPagesReport } from '../shared/report-utils';

/** 报告聚合输入 */
interface ReportInput {
  depTree: DependencyTree;
  outdated: OutdatedResult;
  risk: RiskResult;
}

/** 问题条目 */
interface Finding {
  severity: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  module: string;
  detail: string;
  suggestion: string;
}

// ============================================================
//  [核心] generateReport — 生成巡检报告
//  收集所有检测结果 → 生成 Issue → 生成静态页面
// ============================================================
export async function generateReport(input: ReportInput): Promise<void> {
  const findings = collectFindings(input);

  const critical = findings.filter(f => f.severity === 'critical');
  const warnings = findings.filter(f => f.severity === 'warning');
  const infos = findings.filter(f => f.severity === 'info');

  const summary = {
    timestamp: new Date().toISOString(),
    repo: process.env.REPO_NAME || '',
    totalSDKs: input.depTree.totalSDKs,
    criticalCount: critical.length,
    warningCount: warnings.length,
    infoCount: infos.length,
    totalFindings: findings.length,
  };

  // ----------------------------------------------------------
  //  生成 Issue
  // ----------------------------------------------------------
  const issueBody = buildIssueBody(summary, critical, warnings, infos);
  const issueTitle = `[SDK巡检] ${summary.timestamp.slice(0, 10)} — SDK ${summary.totalSDKs} · 严重 ${summary.criticalCount} · 警告 ${summary.warningCount}`;

  await closePreviousIssue('SDK巡检');
  const issueUrl = await createIssue(issueTitle, issueBody, ['sdk-inspect']);
  console.log(`[报告生成] Issue 已创建: ${issueUrl}`);

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
  summary: ReturnType<typeof collectFindingsSummary>,
  critical: Finding[],
  warnings: Finding[],
  infos: Finding[]
): string {
  return [
    '## 概览',
    '',
    '| 指标 | 数值 |',
    '|------|------|',
    `| 扫描时间 | ${summary.timestamp} |`,
    `| SDK 总数 | ${summary.totalSDKs} |`,
    `| 严重 | ${summary.criticalCount} |`,
    `| 警告 | ${summary.warningCount} |`,
    `| 提示 | ${summary.infoCount} |`,
    '',
    ...(critical.length > 0 ? ['## 严重问题', '', buildFindingTable(critical)] : []),
    ...(warnings.length > 0 ? ['## 警告', '', buildFindingTable(warnings)] : []),
    ...(infos.length > 0 ? ['## 提示', '', buildFindingTable(infos)] : []),
    '',
    '---',
    '',
    `📋 [查看完整报告](https://${getPagesHost()}/reports/${getReportFileName(summary.timestamp, 'inspect')})`,
    '',
    '🔄 回复 `/sdk-inspect` 重新触发巡检',
  ].join('\n');
}

function buildFindingTable(findings: Finding[]): string {
  const rows = ['| SDK | 模块 | 分类 | 问题 | 建议 |', '|-----|------|------|------|------|'];
  for (const f of findings) {
    rows.push(`| ${f.title} | ${f.module} | ${f.category} | ${f.detail} | ${f.suggestion} |`);
  }
  return rows.join('\n');
}

// ============================================================
//  [核心] collectFindings — 汇总各检测模块的问题
// ============================================================
function collectFindings(input: ReportInput): Finding[] {
  const findings: Finding[] = [];

  // ----------------------------------------------------------
  //  风险版本检测 → 严重
  // ----------------------------------------------------------
  for (const hit of input.risk.hits) {
    findings.push({
      severity: 'critical',
      category: hit.risk.type === 'vulnerability' ? '漏洞' : hit.risk.type === 'bug' ? '已知bug' : '禁用版本',
      title: hit.sdkName,
      module: hit.module,
      detail: `${hit.risk.description}（当前 ${hit.currentVersion}）`,
      suggestion: hit.risk.fixVersion ? `升级到 ${hit.risk.fixVersion} 或更高` : '需人工评估',
    });
  }

  // ----------------------------------------------------------
  //  版本落后检测 → 警告
  // ----------------------------------------------------------
  for (const outdated of input.outdated.outdatedSDKs) {
    findings.push({
      severity: 'warning',
      category: '版本落后',
      title: outdated.name,
      module: outdated.module,
      detail: `当前 ${outdated.currentVersion} → 最新 ${outdated.latestVersion}${outdated.isBreakingChange ? '（跨大版本）' : ''}`,
      suggestion: outdated.isBreakingChange ? '注意 breaking changes，建议逐步升级' : '建议升级',
    });
  }

  // ----------------------------------------------------------
  //  registry 不可达 / SDK 下架 → 提示
  // ----------------------------------------------------------
  for (const sdkName of input.outdated.unreachableSDKs) {
    findings.push({
      severity: 'info',
      category: '版本查询失败',
      title: sdkName,
      module: '-',
      detail: 'registry 不可达，无法查询最新版本',
      suggestion: '检查 registry 连接和认证配置',
    });
  }

  for (const sdkName of input.outdated.yankedSDKs) {
    findings.push({
      severity: 'info',
      category: 'SDK 已下架',
      title: sdkName,
      module: '-',
      detail: '该 SDK 在 registry 中标记为 yanked（已下架）',
      suggestion: '评估替代方案或联系 SDK 维护方',
    });
  }

  return findings;
}

function collectFindingsSummary(input: ReportInput) {
  const findings = collectFindings(input);
  return {
    timestamp: new Date().toISOString(),
    repo: process.env.REPO_NAME || '',
    totalSDKs: input.depTree.totalSDKs,
    criticalCount: findings.filter(f => f.severity === 'critical').length,
    warningCount: findings.filter(f => f.severity === 'warning').length,
    infoCount: findings.filter(f => f.severity === 'info').length,
    totalFindings: findings.length,
  };
}

function getReportFileName(timestamp: string, plugin: string): string {
  return `${timestamp.slice(0, 10)}-${plugin}.html`;
}

function getPagesHost(): string {
  const repo = process.env.REPO_NAME || 'Haze324/sdk-governance-plugins';
  const [owner, name] = repo.split('/');
  return `${owner}.github.io/${name}`;
}
