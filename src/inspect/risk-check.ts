/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                     巡检插件 — 风险版本检测                                    ║
║                                                                              ║
║     功能：对接风险版本数据库，检查仓库中 SDK 的实际版本是否命中：                 ║
║           · 已知漏洞版本（CVE）                                               ║
║           · 已知 bug 版本                                                     ║
║           · 公司禁用版本                                                      ║
║                                                                              ║
║     数据源：初期使用华为云漏洞库，后续可扩展其他来源                              ║
║                                                                              ║
║     风险等级判定：                                                             ║
║       - 数据库有 severity → 以数据库为准                                      ║
║       - 数据库未提供 severity → 全部默认为严重                                  ║
║                                                                              ║
║     命中后的处理建议：                                                         ║
║       - 有 fix_version → 建议升级到 fix_version 或更高                        ║
║       - 无 fix_version → 标记为严重风险，需人工评估                            ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { DependencyTree, SDKEntry } from './scanner';

/** 风险类型 */
type RiskType = 'vulnerability' | 'bug' | 'banned';

/** 严重程度 */
type Severity = 'critical' | 'high' | 'medium' | 'low';

/** 单条风险记录 */
interface RiskRecord {
  sdkName: string;
  affectedVersion: string;       // 受影响的版本（支持 semver range）
  type: RiskType;
  severity: Severity;
  description: string;           // 问题描述
  fixVersion: string | null;     // 修复版本号
  source: string;                // 数据来源（如"华为云漏洞库"）
}

/** 命中结果 */
interface RiskHit {
  sdkName: string;
  module: string;
  currentVersion: string;
  risk: RiskRecord;
}

/** 风险检测返回 */
interface RiskResult {
  hits: RiskHit[];               // 命中的风险版本
  checkedCount: number;          // 检查的 SDK 数
  databaseStatus: 'ok' | 'unreachable' | 'empty';
}

// ============================================================
//  [核心] checkRiskVersions — 风险版本检测
//  从风险数据库拉取规则，逐个 SDK 对比实际版本
//  命中的条目 → 严重问题，必须升级到 fix_version
// ============================================================
export async function checkRiskVersions(depTree: DependencyTree): Promise<RiskResult> {
  const result: RiskResult = {
    hits: [],
    checkedCount: 0,
    databaseStatus: 'ok',
  };

  // ----------------------------------------------------------
  //  第 1 步：从风险数据库拉取风险版本清单
  //  数据库地址从 .sdk-governance.yml 的 risk_db 字段读取
  // ----------------------------------------------------------
  console.log('[风险版本检测] 拉取风险数据库...');
  const riskRecords = await fetchRiskDatabase();
  if (riskRecords === null) {
    result.databaseStatus = 'unreachable';
    console.warn('[风险版本检测] 风险数据库不可达，跳过本次检测');
    return result;
  }
  console.log(`[风险版本检测] 风险记录数: ${riskRecords.length}`);

  // ----------------------------------------------------------
  //  第 2 步：逐个 SDK 对比实际版本
  //  只对比直接依赖的 SDK（间接依赖通过直接依赖间接覆盖）
  // ----------------------------------------------------------
  const directSDKs = depTree.sdks.filter(s => s.dependencyType === 'direct');
  result.checkedCount = directSDKs.length;

  for (const sdk of directSDKs) {
    if (!sdk.version) continue;

    // 查找该 SDK 对应的风险记录
    const matchingRisks = riskRecords.filter(r => r.sdkName === sdk.name);

    for (const risk of matchingRisks) {
      // 判断当前版本是否在受影响范围内（semver range match）
      if (isVersionAffected(sdk.version, risk.affectedVersion)) {
        result.hits.push({
          sdkName: sdk.name,
          module: sdk.module,
          currentVersion: sdk.version,
          risk,
        });
      }
    }
  }

  // ----------------------------------------------------------
  //  第 3 步：按严重程度排序输出
  //  critical > high > medium > low
  // ----------------------------------------------------------
  result.hits.sort((a, b) => severityRank(b.risk.severity) - severityRank(a.risk.severity));

  console.log(`[风险版本检测] 命中: ${result.hits.length} 项`);
  return result;
}

// ============================================================
//  辅助函数
// ============================================================

/**
 * 从风险数据库拉取风险版本清单
 * 数据库地址从 .sdk-governance.yml 读取
 */
async function fetchRiskDatabase(): Promise<RiskRecord[] | null> {
  // TODO: 对接华为云漏洞库 API
  //   返回格式：[{ sdkName, affectedVersion, type, severity, description, fixVersion, source }]
  try {
    // const response = await fetch(config.riskDbUrl);
    // return response.json();
    return [];  // 暂时返回空，模拟无风险记录
  } catch {
    return null;
  }
}

/**
 * semver range 匹配：当前版本是否在受影响范围内
 * 支持格式：精确版本 "1.6.0"、范围 ">= 1.0.0 < 1.8.0"、补丁 "*"
 */
function isVersionAffected(currentVersion: string, affectedRange: string): boolean {
  // TODO: 使用 semver 库做 range 匹配
  // satisifies(currentVersion, affectedRange)
  return false;
}

/**
 * 严重程度排序权重
 */
function severityRank(severity: Severity): number {
  const ranks: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  return ranks[severity] || 0;
}
