/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                    公共模块 — LLM API 调用封装                                 ║
║                                                                              ║
║     功能：统一封装 LLM API 调用，供两个插件共用                                  ║
║                                                                              ║
║     · isLLMAvailable — 检查 LLM 是否已配置且可用                                ║
║     · callLLM — OpenAI 兼容的 Chat Completions 调用                           ║
║     · analyzeCompatibility — 封装后的兼容性判断                                ║
║     · analyzeChangelog — 封装后的 Changelog 解析                               ║
║                                                                              ║
║     降级策略：LLM 不可用时返回 fallback 结果，不抛异常                           ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { getLLMConfig, LLMConfig } from './config';

// ============================================================
//  数据类型定义
// ============================================================

/** 兼容性分析结果 */
export interface CompatibilityAnalysis {
  isCompatible: boolean;
  confidence: number;             // 0-1
  reason: string;
  affectedAPIs: string[];
  suggestedAction: string;
  analysisMethod: 'LLM' | 'deterministic';
}

/** Changelog 解析结果 */
export interface ChangelogSummary {
  breakingChanges: string[];      // 破坏性变更
  newFeatures: string[];          // 新功能
  bugFixes: string[];             // 修复
  deprecations: string[];         // 废弃
  performanceImprovements: string[];  // 性能改进
}

/** 安全漏洞结果 */
export interface SecurityVulnResult {
  hasVulnerabilities: boolean;
  vulnerabilities: {
    id: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    fixedVersion: string;
  }[];
}

// ============================================================
//  [对外接口] isLLMAvailable — 检查 LLM 是否可用
// ============================================================
export function isLLMAvailable(): boolean {
  const config = getLLMConfig();
  return config !== null && config.apiKey.length > 0;
}

// ============================================================
//  [对外接口] getLLMMode — 返回当前运行模式描述
// ============================================================
export function getLLMMode(): string {
  return isLLMAvailable() ? 'LLM增强' : '确定性（未配置 LLM API Key）';
}

// ============================================================
//  [核心] callLLM — 通用 LLM 调用
//  兼容 OpenAI API 格式
//  LLM 不可用时返回 null，不抛异常
// ============================================================
export async function callLLM(
  systemPrompt: string,
  userMessage: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<string | null> {
  const config = getLLMConfig();
  if (!config) return null;

  const endpoint = config.endpoint || 'https://api.openai.com/v1';

  try {
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: options?.temperature ?? 0.1,
        max_tokens: options?.maxTokens ?? 2000,
      }),
    });

    if (!response.ok) {
      console.warn(`[LLM] API 调用失败: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.warn('[LLM] API 调用异常:', err);
    return null;
  }
}

// ============================================================
//  [对外接口] analyzeCompatibility — 兼容性判断
//  AI: 将下游库在目标 OS/框架下进行语义分析
//  fallback: 返回"不确定"，标记为确定性模式
// ============================================================
export async function analyzeCompatibility(
  context: {
    direction: 'OS' | 'Framework';
    currentVersion: string;
    targetVersion: string;
    sdkName: string;
    sdkDescription: string;
    apiSignatures: string[];       // SDK 公开 API 签名列表
    knownChanges: string[];        // 已知的 API 变更
  }
): Promise<CompatibilityAnalysis> {
  if (!isLLMAvailable()) {
    return {
      isCompatible: false,
      confidence: 0.3,
      reason: `[确定性模式] 无法自动判断 ${context.sdkName} 在 ${context.direction === 'OS' ? '新 OS' : '新框架'} ${context.targetVersion} 下的兼容性，请人工审查`,
      affectedAPIs: context.apiSignatures,
      suggestedAction: `人工检查 ${context.sdkName} 的 API 是否兼容 ${context.direction === 'OS' ? 'OS' : '框架'} ${context.targetVersion}`,
      analysisMethod: 'deterministic',
    };
  }

  const systemPrompt = `你是一个鸿蒙 SDK 兼容性分析专家。判断一个 SDK 在新版本 OS/框架下是否存在兼容性问题。
给出 JSON 格式输出：{"isCompatible": true/false, "confidence": 0-1, "reason": "...", "affectedAPIs": [...], "suggestedAction": "..."}`;

  const userMessage = `
${context.direction === 'OS' ? 'HarmonyOS' : 'SDK框架'} 版本从 ${context.currentVersion} 升级到 ${context.targetVersion}

SDK：${context.sdkName}
描述：${context.sdkDescription}

SDK 公开 API 签名列表：
${context.apiSignatures.join('\n')}

已知变更：
${context.knownChanges.length > 0 ? context.knownChanges.join('\n') : '（无已知变更数据）'}

请分析：该 SDK 在目标版本下是否能正常运行？哪些 API 可能受影响？`;

  const result = await callLLM(systemPrompt, userMessage, { temperature: 0.1 });
  if (!result) {
    // LLM 调用失败，退回确定性模式
    return {
      isCompatible: false,
      confidence: 0.3,
      reason: `[LLM调用失败] 无法完成 ${context.sdkName} 的兼容性分析，请人工审查`,
      affectedAPIs: context.apiSignatures,
      suggestedAction: `人工检查 ${context.sdkName} 的 API 是否兼容目标版本`,
      analysisMethod: 'deterministic',
    };
  }

  try {
    const parsed = JSON.parse(result);
    return {
      isCompatible: parsed.isCompatible ?? false,
      confidence: parsed.confidence ?? 0.5,
      reason: parsed.reason || result,
      affectedAPIs: parsed.affectedAPIs || [],
      suggestedAction: parsed.suggestedAction || '审核变更并测试',
      analysisMethod: 'LLM',
    };
  } catch {
    return {
      isCompatible: false,
      confidence: 0.4,
      reason: result.slice(0, 500),
      affectedAPIs: context.apiSignatures,
      suggestedAction: '人工审查（LLM 返回非标准 JSON）',
      analysisMethod: 'LLM',
    };
  }
}

// ============================================================
//  [对外接口] analyzeChangelog — Changelog 结构化解析
//  AI: 从非结构化 changelog 文本中提取分类信息
//  fallback: 返回原始文本
// ============================================================
export async function analyzeChangelog(
  sdkName: string,
  rawChangelog: string
): Promise<ChangelogSummary> {
  if (!isLLMAvailable() || !rawChangelog) {
    return {
      breakingChanges: [],
      newFeatures: [],
      bugFixes: [],
      deprecations: [],
      performanceImprovements: [],
    };
  }

  const systemPrompt = `你是一个 SDK Changelog 分析专家。从 Changelog 文本中提取分类信息。
给出 JSON 格式输出：{"breakingChanges": [], "newFeatures": [], "bugFixes": [], "deprecations": [], "performanceImprovements": []}
每项是一个简短的字符串列表。没有的类别返回空数组。`;

  const result = await callLLM(systemPrompt, `SDK: ${sdkName}\n\nChangelog:\n${rawChangelog.slice(0, 4000)}`, { temperature: 0 });

  if (!result) {
    return {
      breakingChanges: [],
      newFeatures: [],
      bugFixes: [],
      deprecations: [],
      performanceImprovements: [],
    };
  }

  try {
    return JSON.parse(result);
  } catch {
    return {
      breakingChanges: [],
      newFeatures: [],
      bugFixes: [],
      deprecations: [],
      performanceImprovements: [],
    };
  }
}
