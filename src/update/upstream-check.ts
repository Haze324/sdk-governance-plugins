/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                  更新检测插件 — 上游版本检测（方向③）                            ║
║                                                                              ║
║     功能：上游版本数据收集，确定性为主                                          ║
║     检测内容：版本号对比、上游下载量、使用量/集成量、安全漏洞、Changelog           ║
║     触发条件：版本号检测发现变化                                                ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { DependencyTree } from './scanner';
import { getLLMConfig } from '../shared/config';
import { analyzeChangelog } from '../shared/llm-client';

// ============================================================
//  数据类型定义
// ============================================================

export interface SecurityVulnerability {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  affectedVersions: string;
  fixedVersion: string;
  source: string;
}

export interface UpstreamInfo {
  outdatedSDKs: { name: string; module: string; currentVersion: string; latestVersion: string; behindBy: number; isBreakingChange: boolean }[];
  unreachableSDKs: string[];
  yankedSDKs: string[];
  securityVulnerabilities: SecurityVulnerability[];
  downloadStats: { weeklyDownloads: number; monthlyDownloads: number };
  changelogHighlights: string[];
}

// ============================================================
//  [核心] checkUpstreamInfo — 上游版本综合检测
// ============================================================
export async function checkUpstreamInfo(depTree: DependencyTree): Promise<UpstreamInfo> {
  const result: UpstreamInfo = {
    outdatedSDKs: [],
    unreachableSDKs: [],
    yankedSDKs: [],
    securityVulnerabilities: [],
    downloadStats: { weeklyDownloads: 0, monthlyDownloads: 0 },
    changelogHighlights: [],
  };

  const uniqueSDKNames = [...new Set(depTree.sdks.map(s => s.name))];

  for (const sdkName of uniqueSDKNames) {
    // 版本号对比（重用现有逻辑）
    const latestInfo = await fetchLatestVersion(sdkName);
    if (latestInfo === null) { result.unreachableSDKs.push(sdkName); continue; }
    if (latestInfo.yanked) { result.yankedSDKs.push(sdkName); continue; }

    const usages = depTree.sdks.filter(s => s.name === sdkName);
    for (const usage of usages) {
      if (!usage.version) continue;
      const comparison = compareVersions(usage.version, latestInfo.version);
      if (comparison < 0) {
        result.outdatedSDKs.push({
          name: sdkName, module: usage.module,
          currentVersion: usage.version, latestVersion: latestInfo.version,
          behindBy: estimateVersionGap(usage.version, latestInfo.version),
          isBreakingChange: isMajorVersionBump(usage.version, latestInfo.version),
        });
      }
    }

    // 安全漏洞检测
    const vulns = await checkSecurityVulnerabilities(sdkName, depTree);
    result.securityVulnerabilities.push(...vulns);

    // 下载量
    const stats = await fetchDownloadStats(sdkName);
    if (stats) { result.downloadStats.weeklyDownloads += stats.weekly; result.downloadStats.monthlyDownloads += stats.monthly; }

    // Changelog
    const changelog = await fetchChangelog(sdkName, depTree);
    if (changelog) { result.changelogHighlights.push(...changelog); }
  }

  console.log(`[上游版本] 落后: ${result.outdatedSDKs.length}, 漏洞: ${result.securityVulnerabilities.length}, 不可达: ${result.unreachableSDKs.length}`);
  return result;
}

// ============================================================
//  辅助函数
// ============================================================

async function fetchLatestVersion(name: string): Promise<{ version: string; yanked: boolean } | null> {
  // TODO: 对接 ohpm registry 查询
  return null;
}

async function checkSecurityVulnerabilities(sdkName: string, depTree: DependencyTree): Promise<SecurityVulnerability[]> {
  // TODO: 对接华为云漏洞库 / CVE 数据库
  return [];
}

async function fetchDownloadStats(sdkName: string): Promise<{ weekly: number; monthly: number } | null> {
  // TODO: 从 ohpm registry 获取下载统计数据
  return null;
}

async function fetchChangelog(sdkName: string, depTree: DependencyTree): Promise<string[] | null> {
  // TODO: 从 SDK 发布页面或 registry 获取 changelog
  // 如果 LLM 可用，可以用 analyzeChangelog 做结构化解析
  return null;
}

function compareVersions(v1: string, v2: string): number {
  const p1 = v1.split('.').map(Number), p2 = v2.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (p1[i] !== p2[i]) return p1[i] - p2[i]; }
  return 0;
}

function estimateVersionGap(current: string, latest: string): number {
  return (parseInt(latest.split('.')[0]) || 0) - (parseInt(current.split('.')[0]) || 0);
}

function isMajorVersionBump(current: string, latest: string): boolean {
  return (parseInt(current.split('.')[0]) || 0) < (parseInt(latest.split('.')[0]) || 0);
}
