/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                  更新检测插件 — 上游版本检测（方向③辅助）                        ║
║                                                                              ║
║     功能：对比仓库 SDK 版本和上游 registry 最新版本，判断是否落后                ║
║     保留旧版 checkVersionOutdated 接口，内部复用 upstream-check.ts              ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { DependencyTree } from './scanner';

/** 版本落后检测结果（保留旧接口兼容）*/
export interface OutdatedResult {
  outdatedSDKs: OutdatedSDK[];
  unreachableSDKs: string[];
  yankedSDKs: string[];
}

export interface OutdatedSDK {
  name: string;
  module: string;
  currentVersion: string;
  latestVersion: string;
  behindBy: number;
  isBreakingChange: boolean;
}

// ============================================================
//  [核心] checkVersionOutdated — 版本落后检测
//  直接比较当前版本与上游最新版本的 semver
// ============================================================
export async function checkVersionOutdated(depTree: DependencyTree): Promise<OutdatedResult> {
  const result: OutdatedResult = {
    outdatedSDKs: [],
    unreachableSDKs: [],
    yankedSDKs: [],
  };

  const uniqueSDKNames = [...new Set(depTree.sdks.map(s => s.name))];

  for (const sdkName of uniqueSDKNames) {
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
  }

  console.log(`[版本检测] 落后: ${result.outdatedSDKs.length}, 不可达: ${result.unreachableSDKs.length}`);
  return result;
}

// ============================================================
//  辅助函数
// ============================================================

async function fetchLatestVersion(name: string): Promise<{ version: string; yanked: boolean } | null> {
  // TODO: 对接 ohpm registry 查询
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
