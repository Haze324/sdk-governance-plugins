/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                     巡检插件 — SDK 清单扫描 + 依赖树构建                        ║
║                                                                              ║
║     功能：扫描仓库所有 oh-package.json5 / oh-package-lock.json5，             ║
║            构建完整依赖树，区分直接依赖和间接依赖                                ║
║                                                                              ║
║     扫描范围：dependencies（直接 + 间接），devDependencies 不扫                ║
║     特殊规则：overrides 配置以 overrides 指定版本为基准                        ║
║                                                                              ║
║     输入：仓库根目录路径                                                       ║
║     输出：SDK 列表（名称、版本、模块、依赖类型、依赖路径）                        ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { readFileSync } from 'fs';
import { glob } from 'glob';

// ============================================================
//  数据类型定义
// ============================================================

/** SDK 信息条目 */
interface SDKEntry {
  name: string;                    // SDK 名称，如 @ohos/pay-sdk
  version: string;                 // lock 文件中的精确版本，如 1.6.0
  declaredRange: string;           // json5 中声明的版本范围，如 ^1.6.0
  module: string;                  // 所属模块，如 entry / library
  dependencyType: 'direct' | 'indirect';  // 直接依赖 or 间接依赖
  dependencyPath: string[];        // 依赖路径，如 ['entry', '@ohos/map-sdk', '@ohos/pay-sdk']
  isOverridden: boolean;           // 是否被 overrides 覆盖
  overrideVersion: string | null;  // overrides 强制指定的版本
}

/** 依赖树 */
interface DependencyTree {
  sdks: SDKEntry[];                // 所有 SDK 条目
  totalSDKs: number;               // SDK 总数
  directCount: number;             // 直接依赖数
  indirectCount: number;           // 间接依赖数
  modules: string[];               // 被扫描的模块列表
  overrides: Record<string, string>;  // overrides 配置
}

// ============================================================
//  [核心] scanSDKList — 扫描仓库所有 oh-package.json5
//  找到所有模块文件夹，提取每个模块的依赖声明
// ============================================================
export async function scanSDKList(rootDir: string): Promise<SDKEntry[]> {
  const entries: SDKEntry[] = [];

  // 查找所有 oh-package.json5 文件
  const json5Files = glob.sync('**/oh-package.json5', {
    cwd: rootDir,
    ignore: ['**/oh_modules/**', '**/node_modules/**'],
  });

  for (const file of json5Files) {
    const fullPath = `${rootDir}/${file}`;
    const content = readFileSync(fullPath, 'utf-8');

    // JSON5 解析（兼容 JSON 标准解析，JSON5 额外特性用正则兜底）
    const pkg = parseJSON5(content);
    const moduleName = file.replace('/oh-package.json5', '') || 'root';

    // ----------------------------------------------------------
    //  提取 dependencies 字段（不扫 devDependencies）
    // ----------------------------------------------------------
    if (pkg.dependencies) {
      for (const [name, range] of Object.entries(pkg.dependencies)) {
        entries.push({
          name,
          version: '',        // 下一步从 lock 文件补
          declaredRange: range as string,
          module: moduleName,
          dependencyType: 'direct',
          dependencyPath: [moduleName],
          isOverridden: false,
          overrideVersion: null,
        });
      }
    }
  }

  return entries;
}

// ============================================================
//  [核心] buildDependencyTree — 构建完整依赖树
//  从 lock 文件读取精确版本，展开间接依赖
//  以 overrides 配置修正被覆盖的 SDK 版本
// ============================================================
export function buildDependencyTree(rawEntries: SDKEntry[]): DependencyTree {
  const modules = [...new Set(rawEntries.map(e => e.module))];

  // ----------------------------------------------------------
  //  从 lock 文件补精确版本
  //  如果 lock 文件缺失 → 列为严重问题
  // ----------------------------------------------------------
  const sdks = resolveLockVersions(rawEntries);

  // ----------------------------------------------------------
  //  展开间接依赖（递归遍历 lock 文件中的 dependencies 字段）
  //  同一 SDK 在不同模块可能引入不同版本 → 标记冲突
  // ----------------------------------------------------------
  const indirectSDKs = expandIndirectDependencies(sdks);
  sdks.push(...indirectSDKs);

  // ----------------------------------------------------------
  //  读取 overrides 配置，修正版本
  //  如果 overrides 指定了某个 SDK 版本，以 overrides 为准
  // ----------------------------------------------------------
  const overrides = readOverridesConfig();
  applyOverrides(sdks, overrides);

  return {
    sdks,
    totalSDKs: sdks.length,
    directCount: sdks.filter(s => s.dependencyType === 'direct').length,
    indirectCount: sdks.filter(s => s.dependencyType === 'indirect').length,
    modules,
    overrides,
  };
}

// ============================================================
//  辅助函数（具体实现）
// ============================================================

/**
 * 从 oh-package-lock.json5 读取精确版本
 * lock 文件是版本精确信息的唯一来源
 */
function resolveLockVersions(entries: SDKEntry[]): SDKEntry[] {
  // TODO: 解析 lock 文件，按 name@module 匹配精确版本
  // 如果 lock 文件不存在 → entries 中 version 为空，后续报告"lock 文件缺失"
  return entries;
}

/**
 * 递归展开间接依赖
 * 从 lock 文件的 dependencies.{sdk}.dependencies 字段获取
 */
function expandIndirectDependencies(directSDKs: SDKEntry[]): SDKEntry[] {
  // TODO: 从 lock 文件递归展开间接依赖树
  // 复用 ohpm list -d N 命令输出解析
  return [];
}

/**
 * 读取工程级 overrides 配置
 * ohpm 1.4.0 起支持 overrides 字段，强制指定 SDK 版本
 */
function readOverridesConfig(): Record<string, string> {
  // TODO: 从根 oh-package.json5 的 overrides 字段读取
  return {};
}

/**
 * overrides 强制覆盖 SDK 版本
 */
function applyOverrides(sdks: SDKEntry[], overrides: Record<string, string>): void {
  for (const sdk of sdks) {
    if (overrides[sdk.name]) {
      sdk.isOverridden = true;
      sdk.overrideVersion = overrides[sdk.name];
    }
  }
}

/**
 * JSON5 简易解析（兼容 JSON + 注释 + 尾逗号）
 */
function parseJSON5(content: string): Record<string, unknown> {
  // 去掉注释和尾逗号后按 JSON 解析
  const cleaned = content
    .replace(/\/\/.*$/gm, '')     // 单行注释
    .replace(/\/\*[\s\S]*?\*\//g, '')  // 多行注释
    .replace(/,\s*}/g, '}')       // 尾逗号
    .replace(/,\s*\]/g, ']');     // 数组尾逗号
  return JSON.parse(cleaned);
}
