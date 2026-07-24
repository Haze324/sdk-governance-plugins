/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                     巡检插件 — 版本落后检测                                    ║
║                                                                              ║
║     功能：对比仓库中 SDK 的当前版本（lock 文件精确版本）和上游 registry 最新版本  ║
║            判断是否落后、落后几个版本                                          ║
║                                                                              ║
║     版本定义：                                                                 ║
║       当前版本 → lock 文件里的实际版本                                         ║
║       目标版本 → 仓库单独指定 > 上游最新（优先级从高到低）                       ║
║                                                                              ║
║     检测逻辑：                                                                 ║
║       - 当前版本 < 目标版本 → 警告，标记落后                                   ║
║       - 当前版本 = 目标版本 → 跳过，已是最新                                   ║
║       - registry 不可达 → 跳过本次检测，报告记录                               ║
║       - SDK 已下架（yanked）→ 跳过                                           ║
║                                                                              ║
║     查询方式：逐个调用 ohpm info <包名> 获取最新版本                            ║
║     （ohpm 无批量查过期的命令，批量场景需开发优化）                               ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { DependencyTree, SDKEntry } from './scanner';

/** 版本落后检测结果 */
export interface OutdatedResult {
  outdatedSDKs: OutdatedSDK[];     // 落后的 SDK 列表
  unreachableSDKs: string[];       // registry 不可达的 SDK
  yankedSDKs: string[];            // 已下架的 SDK
}

export interface OutdatedSDK {
  name: string;
  module: string;
  currentVersion: string;
  latestVersion: string;
  behindBy: number;                // 落后几个大版本
  isBreakingChange: boolean;       // 是否跨大版本
}

// ============================================================
//  [核心] checkVersionOutdated — 版本落后检测
//  逐个查询上游 registry 最新版本，与当前版本对比
//  优化策略：对同一 SDK 不同模块只查一次，避免重复请求
// ============================================================
export async function checkVersionOutdated(depTree: DependencyTree): Promise<OutdatedResult> {
  const result: OutdatedResult = {
    outdatedSDKs: [],
    unreachableSDKs: [],
    yankedSDKs: [],
  };

  // 去重：同一 SDK 名只查一次 registry
  const uniqueSDKNames = [...new Set(depTree.sdks.map(s => s.name))];

  for (const sdkName of uniqueSDKNames) {
    // ----------------------------------------------------------
    //  查询上游 registry 最新版本
    //  调用 ohpm info <包名>（或 registry HTTP API）
    // ----------------------------------------------------------
    const latestInfo = await fetchLatestVersion(sdkName);
    if (latestInfo === null) {
      result.unreachableSDKs.push(sdkName);
      continue;
    }
    if (latestInfo.yanked) {
      result.yankedSDKs.push(sdkName);
      continue;
    }

    // ----------------------------------------------------------
    //  对比当前版本与最新版本
    //  找出使用该 SDK 的所有模块，逐个判断是否落后
    // ----------------------------------------------------------
    const usages = depTree.sdks.filter(s => s.name === sdkName);
    for (const usage of usages) {
      if (!usage.version) continue;

      const comparison = compareVersions(usage.version, latestInfo.version);
      if (comparison < 0) {
        result.outdatedSDKs.push({
          name: sdkName,
          module: usage.module,
          currentVersion: usage.version,
          latestVersion: latestInfo.version,
          behindBy: estimateVersionGap(usage.version, latestInfo.version),
          isBreakingChange: isMajorVersionBump(usage.version, latestInfo.version),
        });
      }
    }
  }

  console.log(`[版本落后检测] 落后: ${result.outdatedSDKs.length}, 不可达: ${result.unreachableSDKs.length}, 已下架: ${result.yankedSDKs.length}`);
  return result;
}

// ============================================================
//  辅助函数
// ============================================================

/**
 * 查询上游 registry 获取最新版本
 * 策略：先尝试 HTTP API，失败则回退到 ohpm info CLI
 */
async function fetchLatestVersion(name: string): Promise<{ version: string; yanked: boolean } | null> {
  // TODO: 对接 ohpm registry 查询
  //   调用 ohpm info <包名> 获取 latest 版本号
  //   解析返回结果中的 version 和 deprecated/yanked 标记
  return null;
}

/**
 * semver 版本比较：返回负数表示 v1 < v2
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts1[i] !== parts2[i]) return parts1[i] - parts2[i];
  }
  return 0;
}

/**
 * 估算版本差距（大版本数）
 */
function estimateVersionGap(current: string, latest: string): number {
  const major1 = parseInt(current.split('.')[0]) || 0;
  const major2 = parseInt(latest.split('.')[0]) || 0;
  return major2 - major1;
}

/**
 * 是否跨大版本升级
 */
function isMajorVersionBump(current: string, latest: string): boolean {
  return (parseInt(current.split('.')[0]) || 0) < (parseInt(latest.split('.')[0]) || 0);
}
