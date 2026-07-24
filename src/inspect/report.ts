/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                     巡检插件 — 报告生成模块                                    ║
║                                                                              ║
║     功能：汇总所有检测结果，生成两种输出：                                       ║
║                                                                              ║
║       ① GitHub Issue — 概览表 + 问题清单（按严重程度分组）                      ║
║          Issue body 用 Markdown 表格呈现，一目了然                             ║
║       ② 静态详情页 — 完整报告，部署到 GitHub Pages                             ║
║          HTML 页面包含完整的问题明细和搜索功能                                  ║
║                                                                              ║
║     Issue 生命周期：                                                           ║
║       - 上次巡检的 Issue 还开着 → 关闭旧 Issue，开新的                          ║
║       - 上次 Issue 已关闭（已知悉/已处理）→ 不重复开                            ║
║       - 新扫描发现新问题 → 开新 Issue                                          ║
║                                                                              ║
║     问题等级与触发条件：                                                        ║
║       严重 → 风险版本命中、lock 文件缺失                                        ║
║       警告 → 版本落后、多模块不一致、声明 vs lock 不一致、overrides vs lock 不一致 ║
║       提示 → 有新版本可用（非紧急）                                             ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { DependencyTree } from './scanner';
import { OutdatedResult } from './version-check';
import { RiskResult } from './risk-check';
import { ConsistencyResult } from './version-consistency';
import { createIssue, closePreviousIssue, buildPagesReport } from '../shared/report-utils';

/** 报告聚合输入 */
interface ReportInput {
  depTree: DependencyTree;
  outdated: OutdatedResult;
  risk: RiskResult;
  consistency: ConsistencyResult;
}

/** 问题条目 */
interface Finding {
  severity: 'critical' | 'warning' | 'info';
  category: string;              // 问题分类标签
  title: string;                 // 问题标题
  module: string;                // 所属模块
  detail: string;                // 详细描述
  suggestion: string;            // 建议操作
  relatedLink: string;           // 相关链接（如 CVE 链接）
}

// ============================================================
//  [核心] generateReport — 生成巡检报告
//  收集所有检测结果 → 生成 Issue → 生成静态页面
// ============================================================
export async function generateReport(input: ReportInput): Promise<void> {
  const findings = collectFindings(input);

  // ----------------------------------------------------------
  //  按严重程度分组：严重 > 警告 > 提示
  // ----------------------------------------------------------
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

  // 关闭上次还开着的巡检 Issue，再建新的
  await closePreviousIssue('SDK巡检');
  const issueUrl = await createIssue(issueTitle, issueBody, ['sdk-inspect']);
  console.log(`[报告生成] Issue 已创建: ${issueUrl}`);

  // ----------------------------------------------------------
  //  生成静态详情页，部署到 GitHub Pages
  // ----------------------------------------------------------
  await buildPagesReport(summary, findings, issueUrl, 'inspect');
  console.log('[报告生成] 静态报告页已生成');
}

// ============================================================
//  [核心] buildIssueBody — 构建 Issue 正文
//  Markdown 格式：概览表 → 严重问题表 → 警告表 → 操作入口
// ============================================================
function buildIssueBody(
  summary: ReturnType<typeof buildSummary>,
  critical: Finding[],
  warnings: Finding[],
  infos: Finding[]
): string {
  // Issue body 用 Markdown 构建，开发能直接看到结构化内容
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
    ...(critical.length > 0 ? [
      '## 严重问题',
      '',
      buildFindingTable(critical),
    ] : []),
    ...(warnings.length > 0 ? [
      '## 警告',
      '',
      buildFindingTable(warnings),
    ] : []),
    ...(infos.length > 0 ? [
      '## 提示',
      '',
      buildFindingTable(infos),
    ] : []),
    '',
    '---',
    '',
    `📋 [查看完整报告](https://${process.env.REPO_OWNER || 'Haze324'}.github.io/${process.env.REPO_NAME?.split('/')[1] || 'sdk-governance-plugins'}/reports/${getReportFileName(summary.timestamp, 'inspect')})`,
    '',
    '🔄 回复 `/sdk-inspect` 重新触发巡检',
  ].join('\n');
}

/** 问题表格 */
function buildFindingTable(findings: Finding[]): string {
  const rows = [
    '| SDK | 模块 | 分类 | 问题 | 建议 |',
    '|-----|------|------|------|------|',
  ];
  for (const f of findings) {
    rows.push(`| ${escapeMarkdown(f.title)} | ${f.module} | ${f.category} | ${escapeMarkdown(f.detail)} | ${escapeMarkdown(f.suggestion)} |`);
  }
  return rows.join('\n');
}

// ============================================================
//  [核心] collectFindings — 汇总各检测模块的问题
// ============================================================
function collectFindings(input: ReportInput): Finding[] {
  const findings: Finding[] = [];

  // ----------------------------------------------------------
  //  来自风险版本检测 → 严重
  // ----------------------------------------------------------
  for (const hit of input.risk.hits) {
    findings.push({
      severity: 'critical',
      category: '风险版本',
      title: hit.sdkName,
      module: hit.module,
      detail: `命中${hit.risk.type}：${hit.risk.description}（当前 ${hit.currentVersion}）`,
      suggestion: hit.risk.fixVersion
        ? `升级到 ${hit.risk.fixVersion} 或更高版本`
        : '需人工评估风险',
      relatedLink: '',
    });
  }

  // ----------------------------------------------------------
  //  来自版本落后检测 → 警告
  // ----------------------------------------------------------
  for (const outdated of input.outdated.outdatedSDKs) {
    findings.push({
      severity: 'warning',
      category: '版本落后',
      title: outdated.name,
      module: outdated.module,
      detail: `当前 ${outdated.currentVersion} → 最新 ${outdated.latestVersion}${outdated.isBreakingChange ? '（跨大版本）' : ''}`,
      suggestion: `建议升级到 ${outdated.latestVersion}${outdated.isBreakingChange ? '，注意 breaking changes' : ''}`,
      relatedLink: '',
    });
  }

  // ----------------------------------------------------------
  //  来自版本一致性检测 → 警告
  // ----------------------------------------------------------

  // ① 多模块版本不一致
  for (const conflict of input.consistency.multiModuleConflicts) {
    const versions = conflict.versions.map(v => `${v.module}: ${v.version}`).join(', ');
    findings.push({
      severity: 'warning',
      category: '多模块版本不一致',
      title: conflict.sdkName,
      module: conflict.versions.map(v => v.module).join('/'),
      detail: `不同模块使用了不同版本：${versions}`,
      suggestion: `建议统一到 ${conflict.suggestedVersion}`,
      relatedLink: '',
    });
  }

  // ② 声明与 lock 不一致
  for (const mismatch of input.consistency.declaredVsLockMismatches) {
    findings.push({
      severity: 'warning',
      category: '声明与 lock 不一致',
      title: mismatch.sdkName,
      module: mismatch.module,
      detail: `声明 ${mismatch.declaredRange}，lock 锁定 ${mismatch.actualVersion}，版本不满足声明范围`,
      suggestion: '检查依赖冲突导致降级的原因',
      relatedLink: '',
    });
  }

  // ③ overrides 与 lock 不一致
  for (const mismatch of input.consistency.overridesMismatches) {
    findings.push({
      severity: 'warning',
      category: 'overrides 与 lock 不一致',
      title: mismatch.sdkName,
      module: '工程级 overrides',
      detail: `overrides 指定 ${mismatch.overrideVersion}，实际安装 ${mismatch.actualVersion}`,
      suggestion: '检查 overrides 配置是否生效',
      relatedLink: '',
    });
  }

  // ----------------------------------------------------------
  //  来自 registry 不可达 → 提示
  // ----------------------------------------------------------
  for (const sdkName of input.outdated.unreachableSDKs) {
    findings.push({
      severity: 'info',
      category: '版本查询失败',
      title: sdkName,
      module: '-',
      detail: 'registry 不可达，无法查询最新版本',
      suggestion: '检查 registry 连接和认证',
      relatedLink: '',
    });
  }

  return findings;
}

function buildSummary(input: ReportInput) {
  const critical = collectFindings(input).filter(f => f.severity === 'critical');
  const warnings = collectFindings(input).filter(f => f.severity === 'warning');
  const infos = collectFindings(input).filter(f => f.severity === 'info');
  return {
    timestamp: new Date().toISOString(),
    repo: process.env.REPO_NAME || '',
    totalSDKs: input.depTree.totalSDKs,
    criticalCount: critical.length,
    warningCount: warnings.length,
    infoCount: infos.length,
    totalFindings: critical.length + warnings.length + infos.length,
  };
}

function getReportFileName(timestamp: string, plugin: string): string {
  const date = timestamp.slice(0, 10);
  return `${date}-${plugin}.html`;
}

function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, '\\|');
}
