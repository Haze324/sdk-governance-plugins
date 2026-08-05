/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                    公共模块 — 配置文件读取                                     ║
║                                                                              ║
║     功能：读取仓库根目录的 .sdk-governance.yml 配置文件                          ║
║     支持：更新检测、完整性检测、LLM 配置                                         ║
║                                                                              ║
║     配置文件结构（YAML）：                                                      ║
║       llm:                                                                     ║
║         provider: "openai"          # LLM 服务商                               ║
║         endpoint: ""                # 可选，自部署/代理                         ║
║         model: "gpt-4o-mini"        # 模型名称                                 ║
║       update:                                                                  ║
║         cron: "0 9 * * 1"                                                      ║
║         registry: https://xxx                                                  ║
║         exclude: [...]                                                         ║
║         directions: { os: true, framework: true, upstream: true }             ║
║       completeness:                                                            ║
║         sources: [...]                                                         ║
║         targets: [...]                                                         ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYAML } from 'yaml';

/** LLM 配置 */
export interface LLMConfig {
  provider: string;          // openai | anthropic | custom
  apiKey: string;            // 环境变量名，实际 Key 从 process.env 读取
  endpoint: string;          // 可选，自部署/代理地址
  model: string;             // 模型名称
}

/** 更新检测 — 方向开关 */
export interface UpdateDirections {
  os: boolean;
  framework: boolean;
  upstream: boolean;
}

/** 插件配置 */
export interface SDKGovernanceConfig {
  llm?: {
    provider?: string;
    api_key?: string;
    endpoint?: string;
    model?: string;
  };
  update?: {
    cron?: string;
    registry?: string;
    exclude?: string[];
    directions?: {
      os?: boolean;
      framework?: boolean;
      upstream?: boolean;
    };
  };
  completeness?: {
    sources?: Array<{
      sdk: string;
      maven?: string;
      source?: string;
      version?: string;
    }>;
    targets?: Array<{
      name: string;
      version?: string;
    }>;
  };
}

/** 触发来源 */
export type TriggerSource = 'schedule' | 'workflow_dispatch' | 'issue_comment';

// ============================================================
//  [对外接口] readConfig — 读取配置文件
// ============================================================
export function readConfig(): SDKGovernanceConfig {
  const configPath = resolve(process.cwd(), '.sdk-governance.yml');

  if (!existsSync(configPath)) {
    console.warn('[配置] .sdk-governance.yml 不存在，使用默认配置');
    return {};
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    return parseYAML(content) as SDKGovernanceConfig;
  } catch (err) {
    console.error('[配置] 配置文件解析失败:', err);
    return {};
  }
}

// ============================================================
//  [对外接口] getLLMConfig — 获取 LLM 配置
//  API Key 从环境变量注入，不在配置文件里明文写
//  如果环境变量未设置 → 返回 null，后续走确定性模式
// ============================================================
export function getLLMConfig(): LLMConfig | null {
  const config = readConfig();
  const llmSection = config.llm;

  if (!llmSection || !llmSection.api_key) {
    console.log('[LLM配置] 未配置 LLM API Key，使用确定性模式');
    return null;
  }

  // api_key 的值是环境变量名（如 "LLM_API_KEY"），从 process.env 读取
  const apiKey = process.env[llmSection.api_key];
  if (!apiKey) {
    console.log(`[LLM配置] 环境变量 ${llmSection.api_key} 未设置，使用确定性模式`);
    return null;
  }

  return {
    provider: llmSection.provider || 'openai',
    apiKey,
    endpoint: llmSection.endpoint || '',
    model: llmSection.model || 'gpt-4o-mini',
  };
}

// ============================================================
//  [对外接口] getUpdateConfig — 获取更新检测配置
// ============================================================
export function getUpdateConfig() {
  const config = readConfig();
  return {
    cron: config.update?.cron || '0 9 * * 1',
    registry: config.update?.registry || '',
    exclude: config.update?.exclude || [],
    directions: {
      os: config.update?.directions?.os ?? true,
      framework: config.update?.directions?.framework ?? true,
      upstream: config.update?.directions?.upstream ?? true,
    } as UpdateDirections,
  };
}

// ============================================================
//  [对外接口] getCompletenessConfig — 获取完整性检测配置
// ============================================================
export function getCompletenessConfig() {
  const config = readConfig();
  return {
    sources: config.completeness?.sources || [],
    targets: config.completeness?.targets || [],
  };
}

