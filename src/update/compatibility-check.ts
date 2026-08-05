/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                  更新检测插件 — 兼容性检测（方向①+②）                            ║
║                                                                              ║
║     方向① OS 升级    — OS API 变更时，检测下游 SDK 是否在新 OS 兼容范围内        ║
║     方向② 框架升级   — 框架版本变化时，检测 API 变更的兼容性                     ║
║                                                                              ║
║     验证方法（二选一）：                                                         ║
║       · AI 运行验证：将下游库在新 OS/框架下运行看是否正常                          ║
║       · AI 代码分析：对比代码差异判断兼容性                                      ║
║                                                                              ║
║     降级策略：LLM 不可用时走确定性规则，标记"不确定"                              ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { DependencyTree, SDKEntry, OSInfo, FrameworkInfo } from './scanner';
import { isLLMAvailable, analyzeCompatibility } from '../shared/llm-client';

// ============================================================
//  数据类型定义
// ============================================================

export interface CompatibilityCheckOptions {
  checkOS: boolean;
  checkFramework: boolean;
  useLLM: boolean;
}

export interface CompatibilityIssue {
  direction: 'OS' | 'Framework';
  sdkName: string;
  module: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'api_removed' | 'api_changed' | 'platform_incompatible' | 'init_changed' | 'uncertain';
  description: string;
  impact: string;
  suggestion: string;
  confidence: number;           // 0-1
  analysisMethod: 'LLM' | 'deterministic';
}

// ============================================================
//  [核心] checkCompatibility — 兼容性检测编排
// ============================================================
export async function checkCompatibility(
  depTree: DependencyTree,
  options: CompatibilityCheckOptions
): Promise<CompatibilityIssue[]> {
  const issues: CompatibilityIssue[] = [];

  // ----------------------------------------------------------
  //  方向①：OS 升级检测
  //  触发条件：OS API 发生变化
  //  检测内容：下游 SDK 的 API 是否还在新 OS 兼容范围内
  // ----------------------------------------------------------
  if (options.checkOS && depTree.osInfo) {
    console.log('[兼容性检测] 方向① OS 升级...');
    const osIssues = await checkOSCompatibility(depTree, options.useLLM);
    issues.push(...osIssues);
    console.log(`[兼容性检测]   OS: ${osIssues.length} 个问题`);
  }

  // ----------------------------------------------------------
  //  方向②：框架升级检测
  //  触发条件：框架版本发生变化
  //  检测内容：框架不同版本下 API 变化的兼容性问题
  // ----------------------------------------------------------
  if (options.checkFramework && depTree.frameworkInfo) {
    console.log('[兼容性检测] 方向② 框架升级...');
    const frameworkIssues = await checkFrameworkCompatibility(depTree, options.useLLM);
    issues.push(...frameworkIssues);
    console.log(`[兼容性检测]   框架: ${frameworkIssues.length} 个问题`);
  }

  return issues;
}

// ============================================================
//  方向①：OS 兼容性检测
// ============================================================
async function checkOSCompatibility(depTree: DependencyTree, useLLM: boolean): Promise<CompatibilityIssue[]> {
  const issues: CompatibilityIssue[] = [];
  const osInfo = depTree.osInfo!;

  for (const sdk of depTree.sdks) {
    if (sdk.dependencyType !== 'direct') continue;

    if (useLLM && isLLMAvailable()) {
      // AI 代码分析模式
      const analysis = await analyzeCompatibility({
        direction: 'OS',
        currentVersion: osInfo.releaseVersion,
        targetVersion: 'HarmonyOS NEXT',  // 可配置
        sdkName: sdk.name,
        sdkDescription: `${sdk.name} v${sdk.version} in module ${sdk.module}`,
        apiSignatures: getSDKAPISignatures(sdk),
        knownChanges: getOSAPIChanges(osInfo.apiVersion),
      });

      if (!analysis.isCompatible || analysis.confidence < 0.85) {
        issues.push({
          direction: 'OS',
          sdkName: sdk.name,
          module: sdk.module,
          severity: analysis.confidence < 0.5 ? 'high' : 'medium',
          category: analysis.confidence < 0.5 ? 'platform_incompatible' : 'uncertain',
          description: analysis.reason,
          impact: `SDK ${sdk.name} 在 ${osInfo.releaseVersion} 下可能存在兼容性问题`,
          suggestion: analysis.suggestedAction,
          confidence: analysis.confidence,
          analysisMethod: analysis.analysisMethod,
        });
      }
    } else {
      // 确定性模式：标记为不确定
      issues.push({
        direction: 'OS',
        sdkName: sdk.name,
        module: sdk.module,
        severity: 'low',
        category: 'uncertain',
        description: `[确定性模式] 无法自动验证 SDK ${sdk.name} 在 OS ${osInfo.releaseVersion} 下的兼容性`,
        impact: '请人工确认',
        suggestion: `检查 ${sdk.name} 的 changelog 确认 OS 兼容性`,
        confidence: 0.3,
        analysisMethod: 'deterministic',
      });
    }
  }

  return issues;
}

// ============================================================
//  方向②：框架兼容性检测
// ============================================================
async function checkFrameworkCompatibility(depTree: DependencyTree, useLLM: boolean): Promise<CompatibilityIssue[]> {
  const issues: CompatibilityIssue[] = [];
  const fwInfo = depTree.frameworkInfo!;

  for (const sdk of depTree.sdks) {
    if (sdk.dependencyType !== 'direct') continue;
    if (!sdk.version) continue;

    if (useLLM && isLLMAvailable()) {
      const analysis = await analyzeCompatibility({
        direction: 'Framework',
        currentVersion: sdk.version,
        targetVersion: '',  // 从 registry 查最新版本
        sdkName: sdk.name,
        sdkDescription: `${sdk.name} v${sdk.version} → 最新版本`,
        apiSignatures: getSDKAPISignatures(sdk),
        knownChanges: [],
      });

      if (!analysis.isCompatible || analysis.confidence < 0.85) {
        issues.push({
          direction: 'Framework',
          sdkName: sdk.name,
          module: sdk.module,
          severity: analysis.confidence < 0.5 ? 'high' : 'medium',
          category: analysis.confidence < 0.5 ? 'api_changed' : 'uncertain',
          description: analysis.reason,
          impact: `升级 ${sdk.name} 后调用代码可能不兼容`,
          suggestion: analysis.suggestedAction,
          confidence: analysis.confidence,
          analysisMethod: analysis.analysisMethod,
        });
      }
    } else {
      // 确定性模式：标记跨大版本的情况
      if (sdk.declaredRange && sdk.declaredRange.startsWith('^')) {
        const declaredMajor = parseInt(sdk.declaredRange.replace('^', '').split('.')[0]);
        const currentMajor = parseInt(sdk.version.split('.')[0]);
        if (currentMajor < declaredMajor) {
          issues.push({
            direction: 'Framework',
            sdkName: sdk.name,
            module: sdk.module,
            severity: 'high',
            category: 'api_changed',
            description: `[确定性模式] SDK ${sdk.name} 声明版本范围 ${sdk.declaredRange}，当前版本 ${sdk.version} 跨大版本，可能存在 breaking changes`,
            impact: '跨大版本升级需要逐项验证 API 兼容性',
            suggestion: '查看 changelog，逐项验证调用代码',
            confidence: 0.7,
            analysisMethod: 'deterministic',
          });
        }
      }
    }
  }

  return issues;
}

// ============================================================
//  辅助函数：获取 SDK 的公开 API 签名列表
//  用于 AI 分析时的上下文
// ============================================================
function getSDKAPISignatures(sdk: SDKEntry): string[] {
  // TODO: 从 SDK 源码中提取实际 API 签名
  // 当前返回占位数据
  return [`import { ... } from '${sdk.name}'`];
}

function getOSAPIChanges(currentApiVersion: number): string[] {
  // TODO: 从 HarmonyOS changelog 中获取当前版本的已知 API 变更
  // 当前返回占位数据
  return [];
}
