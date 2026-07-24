/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                   巡检插件 — 版本一致性检测                                    ║
║                                                                              ║
║     功能：检测仓库内部 SDK 版本一致性，共三项：                                  ║
║                                                                              ║
║       ① 多模块版本一致性                                                      ║
║          同一 SDK 在不同模块用了不同版本 → 报告不一致                            ║
║          例：entry 用 pay-sdk 1.6.0，library 用 pay-sdk 1.8.0                ║
║          建议统一到最高版本                                                    ║
║                                                                              ║
║       ② 声明与 lock 一致性                                                    ║
║          json5 声明的版本范围与实际 lock 版本对比，不满足 → 不一致               ║
║          例：声明 ^1.6.0 但 lock 锁定 1.5.8 → 依赖冲突导致降级                 ║
║                                                                              ║
║       ③ overrides 与 lock 一致性                                              ║
║          工程级 overrides 强制指定版本与 lock 实际版本不同 → 不一致             ║
║                                                                              ║
║     不做：                                                                    ║
║       - lock 里有但声明里没有的反向检查（间接依赖，正常情况）                     ║
║       - peerDependencies 检查（鸿蒙生态不常用）                                ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { DependencyTree, SDKEntry } from './scanner';

/** 一致性检测结果 */
interface ConsistencyResult {
  // ① 多模块版本不一致
  multiModuleConflicts: MultiModuleConflict[];
  // ② 声明与 lock 不一致
  declaredVsLockMismatches: VersionMismatch[];
  // ③ overrides 与 lock 不一致
  overridesMismatches: OverridesMismatch[];
}

interface MultiModuleConflict {
  sdkName: string;
  versions: { module: string; version: string }[];
  suggestedVersion: string;      // 建议统一到的版本（取最高版本）
}

interface VersionMismatch {
  sdkName: string;
  module: string;
  declaredRange: string;
  actualVersion: string;         // lock 文件中的实际版本
}

interface OverridesMismatch {
  sdkName: string;
  overrideVersion: string;       // overrides 强制版本
  actualVersion: string;         // lock 文件中的实际版本
}

// ============================================================
//  [核心] checkVersionConsistency — 版本一致性检测
//  三项检测按顺序执行，结果汇总返回
// ============================================================
export function checkVersionConsistency(depTree: DependencyTree): ConsistencyResult {
  return {
    multiModuleConflicts: detectMultiModuleConflicts(depTree),
    declaredVsLockMismatches: detectDeclarationMismatches(depTree),
    overridesMismatches: detectOverridesMismatches(depTree),
  };
}

// ============================================================
//  ① 多模块版本一致性检测
//  按 SDK 名称分组，同一 SDK 在不同模块版本不同 → 报告
// ============================================================
function detectMultiModuleConflicts(depTree: DependencyTree): MultiModuleConflict[] {
  const conflicts: MultiModuleConflict[] = [];

  // 按 SDK 名称分组，只保留有版本号的条目
  const grouped = new Map<string, { module: string; version: string }[]>();
  for (const sdk of depTree.sdks) {
    if (!sdk.version) continue;
    if (!grouped.has(sdk.name)) grouped.set(sdk.name, []);
    grouped.get(sdk.name)!.push({ module: sdk.module, version: sdk.version });
  }

  // 找出同一 SDK 出现不同版本的冲突
  for (const [sdkName, versions] of grouped) {
    const uniqueVersions = [...new Set(versions.map(v => v.version))];
    if (uniqueVersions.length > 1) {
      // 建议统一到最高版本
      const suggested = uniqueVersions.sort((a, b) => compareVersions(b, a))[0];
      conflicts.push({
        sdkName,
        versions,
        suggestedVersion: suggested,
      });
    }
  }

  console.log(`[多模块版本一致] 冲突: ${conflicts.length} 项`);
  return conflicts;
}

// ============================================================
//  ② 声明与 lock 一致性检测
//  json5 声明的版本范围（如 ^1.6.0）与 lock 精确版本对比
// ============================================================
function detectDeclarationMismatches(depTree: DependencyTree): VersionMismatch[] {
  const mismatches: VersionMismatch[] = [];

  for (const sdk of depTree.sdks) {
    if (!sdk.version || !sdk.declaredRange) continue;

    // 判断 lock 版本是否满足声明的 semver 范围
    if (!semverSatisifies(sdk.version, sdk.declaredRange)) {
      mismatches.push({
        sdkName: sdk.name,
        module: sdk.module,
        declaredRange: sdk.declaredRange,
        actualVersion: sdk.version,
      });
    }
  }

  console.log(`[声明vs lock] 不一致: ${mismatches.length} 项`);
  return mismatches;
}

// ============================================================
//  ③ overrides 与 lock 一致性检测
//  overrides 强制指定版本，lock 必须遵循
// ============================================================
function detectOverridesMismatches(depTree: DependencyTree): OverridesMismatch[] {
  const mismatches: OverridesMismatch[] = [];

  for (const sdk of depTree.sdks) {
    if (!sdk.isOverridden || !sdk.overrideVersion) continue;

    // overrides 指定的版本与 lock 实际版本不同 → 不一致
    if (sdk.version !== sdk.overrideVersion) {
      mismatches.push({
        sdkName: sdk.name,
        overrideVersion: sdk.overrideVersion,
        actualVersion: sdk.version,
      });
    }
  }

  console.log(`[overrides vs lock] 不一致: ${mismatches.length} 项`);
  return mismatches;
}

// ============================================================
//  辅助函数
// ============================================================

/** semver 范围匹配：lock 版本是否满足声明的范围 */
function semverSatisifies(version: string, range: string): boolean {
  // TODO: 使用 semver 库做 range 匹配
  // satisifies(version, range)
  return true;
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts1[i] !== parts2[i]) return parts1[i] - parts2[i];
  }
  return 0;
}
