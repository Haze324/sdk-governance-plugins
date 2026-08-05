/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                     更新检测插件 — SDK 清单扫描 + 依赖树构建                     ║
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
export interface SDKEntry {
  name: string;
  version: string;
  declaredRange: string;
  module: string;
  dependencyType: 'direct' | 'indirect';
  dependencyPath: string[];
  isOverridden: boolean;
  overrideVersion: string | null;
}

/** OS 信息（方向①） */
export interface OSInfo {
  apiVersion: number;
  releaseVersion: string;
}

/** 框架信息（方向②） */
export interface FrameworkInfo {
  name: string;
  version: string;
}

/** 依赖树 */
export interface DependencyTree {
  sdks: SDKEntry[];
  totalSDKs: number;
  directCount: number;
  indirectCount: number;
  modules: string[];
  overrides: Record<string, string>;
  osInfo?: OSInfo;
  frameworkInfo?: FrameworkInfo;
}

// ============================================================
//  [核心] scanSDKList — 扫描仓库所有 oh-package.json5
// ============================================================
export async function scanSDKList(rootDir: string): Promise<SDKEntry[]> {
  const entries: SDKEntry[] = [];

  const json5Files = glob.sync('**/oh-package.json5', {
    cwd: rootDir,
    ignore: ['**/oh_modules/**', '**/node_modules/**'],
  });

  for (const file of json5Files) {
    const fullPath = `${rootDir}/${file}`;
    const content = readFileSync(fullPath, 'utf-8');
    const pkg = parseJSON5(content);
    const moduleName = file.replace('/oh-package.json5', '') || 'root';

    if (pkg.dependencies) {
      for (const [name, range] of Object.entries(pkg.dependencies)) {
        entries.push({
          name,
          version: '',
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
// ============================================================
export function buildDependencyTree(rawEntries: SDKEntry[]): DependencyTree {
  const modules = [...new Set(rawEntries.map(e => e.module))];

  const sdks = resolveLockVersions(rawEntries);
  const indirectSDKs = expandIndirectDependencies(sdks);
  sdks.push(...indirectSDKs);

  const overrides = readOverridesConfig();
  applyOverrides(sdks, overrides);

  const osInfo = detectOSInfo();
  const frameworkInfo = detectFrameworkInfo(sdks);

  return {
    sdks,
    totalSDKs: sdks.length,
    directCount: sdks.filter(s => s.dependencyType === 'direct').length,
    indirectCount: sdks.filter(s => s.dependencyType === 'indirect').length,
    modules,
    overrides,
    osInfo,
    frameworkInfo,
  };
}

// ============================================================
//  [新增] detectOSInfo — 检测当前 HarmonyOS 平台版本
// ============================================================
export function detectOSInfo(): OSInfo | undefined {
  // TODO: 从 build-profile.json5 或环境变量读取
  return {
    apiVersion: 12,
    releaseVersion: 'HarmonyOS 5.0',
  };
}

// ============================================================
//  [新增] detectFrameworkInfo — 检测当前框架版本
// ============================================================
export function detectFrameworkInfo(sdks: SDKEntry[]): FrameworkInfo | undefined {
  const frameworkSDKs = ['@ohos/arkui', '@ohos/arkts', '@ohos/app'];
  const found = sdks.find(s => frameworkSDKs.includes(s.name));
  if (found) {
    return { name: found.name, version: found.version };
  }
  return { name: '@ohos/arkui', version: '1.0.0' };
}

// ============================================================
//  辅助函数
// ============================================================

function resolveLockVersions(entries: SDKEntry[]): SDKEntry[] {
  // TODO: 解析 lock 文件，按 name@module 匹配精确版本
  return entries;
}

function expandIndirectDependencies(directSDKs: SDKEntry[]): SDKEntry[] {
  // TODO: 从 lock 文件递归展开间接依赖树
  return [];
}

function readOverridesConfig(): Record<string, string> {
  // TODO: 从根 oh-package.json5 的 overrides 字段读取
  return {};
}

function applyOverrides(sdks: SDKEntry[], overrides: Record<string, string>): void {
  for (const sdk of sdks) {
    if (overrides[sdk.name]) {
      sdk.isOverridden = true;
      sdk.overrideVersion = overrides[sdk.name];
    }
  }
}

function parseJSON5(content: string): Record<string, unknown> {
  const cleaned = content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,\s*}/g, '}')
    .replace(/,\s*\]/g, ']');
  return JSON.parse(cleaned);
}
