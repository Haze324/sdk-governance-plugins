/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                    公共模块 — 配置文件读取                                     ║
║                                                                              ║
║     功能：读取仓库根目录的 .sdk-governance.yml 配置文件                          ║
║                                                                              ║
║     配置文件结构（YAML）：                                                      ║
║       inspect:                                                                ║
║         cron: "0 9 * * 1"          # 巡检 cron 表达式                         ║
║         registry: https://xxx      # 私有 registry 地址                       ║
║         risk_db: https://xxx       # 风险版本数据库地址                        ║
║         exclude: [...]             # 排除的 SDK 列表                          ║
║       consistency:                                                            ║
║         sources:                   # 上游安卓 SDK 数据来源                     ║
║           - sdk: "pay-sdk"                                                    ║
║             maven: "com.example:pay-sdk:2.0.0"                                ║
║         targets:                   # 要检测的鸿蒙包列表                         ║
║           - name: "@ohos/pay-sdk"                                             ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYAML } from 'yaml';

/** 插件配置 */
interface SDKGovernanceConfig {
  inspect?: {
    cron?: string;
    registry?: string;
    riskDb?: string;
    exclude?: string[];
  };
  consistency?: {
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
type TriggerSource = 'schedule' | 'workflow_dispatch' | 'issue_comment';

// ============================================================
//  [对外接口] readConfig — 读取配置文件
//  从仓库根目录 .sdk-governance.yml 加载
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
//  [对外接口] getInspectConfig — 获取巡检插件配置
// ============================================================
export function getInspectConfig() {
  const config = readConfig();
  return {
    cron: config.inspect?.cron || '0 9 * * 1',
    registry: config.inspect?.registry || 'https://ohpm.openharmony.cn/ohpm',
    riskDb: config.inspect?.riskDb || '',
    exclude: config.inspect?.exclude || [],
  };
}

// ============================================================
//  [对外接口] getConsistencyConfig — 获取一致性插件配置
// ============================================================
export function getConsistencyConfig() {
  const config = readConfig();
  return {
    sources: config.consistency?.sources || [],
    targets: config.consistency?.targets || [],
  };
}

export type { SDKGovernanceConfig, TriggerSource };
