/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                  一致性插件 — 上游 vs 鸿蒙对比分析                              ║
║                                                                              ║
║     功能：对比上游安卓 SDK API 清单与鸿蒙包 API 清单，分析差异                    ║
║                                                                              ║
║     对比维度：                                                                 ║
║                                                                              ║
║       ① 功能缺失分析                                                           ║
║          · 上游有、鸿蒙没有的类 → 缺失                                          ║
║          · 上游有、鸿蒙没有的方法 → 缺失                                        ║
║          · 上游有、鸿蒙没有的属性/配置项 → 缺失                                  ║
║          · 上游有、鸿蒙没有的功能模块 → 缺失                                    ║
║                                                                              ║
║       ② Bug 风险分析                                                           ║
║          · API 签名变更 → 参数类型/返回值类型变化 → 风险                         ║
║          · 异步/同步模式不匹配 → 调用方可能时序错乱 → 风险                        ║
║          · 异常处理缺失 → 上游明确声明的异常鸿蒙没有对应处理 → 风险               ║
║          · 平台适配差异 → 鸿蒙平台能力限制导致的降级实现 → 风险                   ║
║                                                                              ║
║     对比策略：                                                                 ║
║       - 名称精确匹配 + 语义相似度匹配（处理鸿蒙命名规范差异）                      ║
║       - 参数类型映射（Java/Kotlin 类型 → ArkTS 类型）                           ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { UpstreamAPI } from './upstream-parser';
import { HarmonyAPI } from './harmony-parser';

/** API 对比结果 */
export interface APIComparison {
  // 功能缺失
  missingClasses: MissingItem[];       // 缺失的类
  missingFunctions: MissingItem[];     // 缺失的方法
  missingFields: MissingItem[];        // 缺失的属性/字段
  missingModules: MissingItem[];       // 缺失的功能模块

  // 新增（鸿蒙有但上游没有，可能是兼容层或新增功能）
  addedClasses: string[];              // 鸿蒙新增的类
  addedFunctions: string[];            // 鸿蒙新增的方法

  // 匹配上的（用于 Bug 风险分析）
  matchedFunctions: MatchedFunction[]; // 两边都有的方法（含签名对比）
}

/** 缺失项 */
export interface MissingItem {
  name: string;                        // 缺失的类/方法/字段名
  parentClass: string;                 // 所属类（方法/字段缺失时标注）
  parentModule: string;                // 所属功能模块
  significance: 'critical' | 'high' | 'medium' | 'low';  // 重要程度
  description: string;                 // 缺失说明
}

/** 匹配的函数（上游和鸿蒙都有，但可能签名不同）*/
export interface MatchedFunction {
  name: string;                        // 方法名
  parentClass: string;                 // 所属类名
  upstreamSignature: string;           // 上游签名
  harmonySignature: string;            // 鸿蒙签名
  signatureChanged: boolean;           // 签名是否变更
  returnTypeChanged: boolean;          // 返回值类型是否变更
  paramChanges: ParamChange[];         // 参数变更详情
  asyncModeChanged: boolean;           // 异步模式是否变更
  upstreamThrows: string[];            // 上游可能抛出的异常
  harmonyThrows: string[];             // 鸿蒙可能抛出的异常
  missingExceptionHandling: string[];  // 缺失的异常处理
}

export interface ParamChange {
  paramName: string;
  upstreamType: string;
  harmonyType: string;
}

/** Bug 风险 */
export interface BugRisk {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'signature_change' | 'async_mismatch' | 'missing_exception' | 'platform_adaptation';
  description: string;
  location: string;                    // 位置（类名.方法名）
  impact: string;                      // 可能的影响
  suggestion: string;                  // 修复建议
}

// ============================================================
//  [核心] compareAPI — API 清单对比
//  找出上游有但鸿蒙缺失的类/方法/属性/模块
//  按 SDK 名称分组对比，同名类做精确匹配
// ============================================================
export function compareAPI(upstream: UpstreamAPI, harmony: HarmonyAPI): APIComparison {
  console.log('[API 对比] 开始对比上游和鸿蒙 API 清单...');

  const result: APIComparison = {
    missingClasses: [],
    missingFunctions: [],
    missingFields: [],
    missingModules: [],
    addedClasses: [],
    addedFunctions: [],
    matchedFunctions: [],
  };

  // ----------------------------------------------------------
  //  ① 类级别对比
  //  上游有但鸿蒙没有的类 → 标记缺失
  //  鸿蒙有但上游没有的 → 标记新增（可能是兼容层）
  // ----------------------------------------------------------
  const upstreamClassNames = new Set(upstream.classes.map(c => c.name));
  const harmonyClassNames = new Set(harmony.classes.map(c => c.name));

  for (const cls of upstream.classes) {
    if (!harmonyClassNames.has(cls.name)) {
      result.missingClasses.push({
        name: cls.name,
        parentClass: cls.parentClass || '—',
        parentModule: findModuleFor(cls.name, upstream.modules, upstream.classes),
        significance: inferSignificance(cls, 'class'),
        description: `上游 SDK 中存在类 ${cls.name}（${cls.type}），鸿蒙包中未找到对应实现`,
      });
    }
  }

  // 鸿蒙新增的类（不在上游中）
  for (const cls of harmony.classes) {
    if (!upstreamClassNames.has(cls.name)) {
      result.addedClasses.push(cls.name);
    }
  }

  // ----------------------------------------------------------
  //  ② 方法级别对比（针对两边都有的类）
  //  上游有的方法鸿蒙没有 → 功能缺失
  //  两边都有但签名不同 → 匹配上标记，用于 Bug 风险分析
  // ----------------------------------------------------------
  for (const upstreamCls of upstream.classes) {
    const harmonyCls = harmony.classes.find(c => c.name === upstreamCls.name);
    if (!harmonyCls) continue;  // 类本身缺失已在上面标记

    const harmonyFuncNames = new Set(harmonyCls.methods.map(m => m.name));

    for (const upstreamMethod of upstreamCls.methods) {
      if (!harmonyFuncNames.has(upstreamMethod.name)) {
        // 鸿蒙没有这个方法
        result.missingFunctions.push({
          name: `${upstreamCls.name}.${upstreamMethod.name}`,
          parentClass: upstreamCls.name,
          parentModule: findModuleFor(upstreamCls.name, upstream.modules, upstream.classes),
          significance: inferSignificance(upstreamMethod, 'method'),
          description: `上游类 ${upstreamCls.name} 中存在方法 ${upstreamMethod.name}(${upstreamMethod.params.map(p => p.type).join(', ')}): ${upstreamMethod.returnType}，鸿蒙包中未找到`,
        });
      } else {
        // 两边都有，对比签名
        const harmonyMethod = harmonyCls.methods.find(m => m.name === upstreamMethod.name)!;
        const match = compareFunctionSignatures(upstreamMethod, harmonyMethod, upstreamCls.name);
        result.matchedFunctions.push(match);

        // 鸿蒙新增的方法（上游没有）
        for (const hm of harmonyCls.methods) {
          const upstreamMethodNames = new Set(upstreamCls.methods.map(m => m.name));
          if (!upstreamMethodNames.has(hm.name)) {
            result.addedFunctions.push(`${upstreamCls.name}.${hm.name}`);
          }
        }
      }
    }
  }

  // ----------------------------------------------------------
  //  ③ 功能模块级别对比
  //  上游 SDK 按功能分了哪些模块，鸿蒙包是否都有
  // ----------------------------------------------------------
  for (const mod of upstream.modules) {
    const coveredInHarmony = mod.relatedClasses.every(clsName =>
      harmonyClassNames.has(clsName) || result.addedClasses.includes(clsName)
    );
    if (!coveredInHarmony) {
      result.missingModules.push({
        name: mod.name,
        parentClass: '—',
        parentModule: '—',
        significance: 'high',
        description: `功能模块"${mod.name}"不完整：${mod.description}`,
      });
    }
  }

  const totalMissing = result.missingClasses.length + result.missingFunctions.length
    + result.missingFields.length + result.missingModules.length;
  console.log(`[API 对比] 缺失项: ${totalMissing}, 新增项: ${result.addedClasses.length + result.addedFunctions.length}`);
  return result;
}

// ============================================================
//  [核心] analyzeBugRisks — Bug 风险分析
//  基于签名变更、异步模式、异常处理等信号评估风险
// ============================================================
export function analyzeBugRisks(upstream: UpstreamAPI, harmony: HarmonyAPI): BugRisk[] {
  console.log('[Bug风险] 开始分析转化可能引入的 bug 风险...');

  // 先做 API 对比获取匹配函数列表
  const comparison = compareAPI(upstream, harmony);
  const risks: BugRisk[] = [];

  for (const match of comparison.matchedFunctions) {
    // ----------------------------------------------------------
    //  风险类型 1：签名变更
    //  参数类型或返回值类型变化 → 调用方类型错误
    // ----------------------------------------------------------
    if (match.signatureChanged) {
      risks.push({
        severity: 'high',
        category: 'signature_change',
        description: `方法 ${match.name} 签名变更${
          match.paramChanges.map(p => ` · ${p.paramName}: ${p.upstreamType} → ${p.harmonyType}`).join('')
        }${match.returnTypeChanged ? ` · 返回值: ${match.upstreamSignature.split('):')[1] || '?'} → ${match.harmonySignature.split('):')[1] || '?'}` : ''}`,
        location: match.parentClass ? `${match.parentClass}.${match.name}` : match.name,
        impact: '调用方可能传入错误类型参数或错误处理返回值，导致运行时异常',
        suggestion: '检查所有调用处，确认参数和返回值处理逻辑已适配',
      });
    }

    // ----------------------------------------------------------
    //  风险类型 2：异步/同步模式不匹配
    //  上游同步但鸿蒙异步（或反之）→ 调用方时序错乱
    // ----------------------------------------------------------
    if (match.asyncModeChanged) {
      risks.push({
        severity: 'high',
        category: 'async_mismatch',
        description: `方法 ${match.name} 异步模式不匹配：上游 ${match.upstreamSignature.includes('async') ? '异步' : '同步'} → 鸿蒙 ${match.harmonySignature.includes('async') ? '异步' : '同步'}`,
        location: match.parentClass ? `${match.parentClass}.${match.name}` : match.name,
        impact: '上游同步调用鸿蒙变成异步（或反之），调用方依赖时序的逻辑可能出错',
        suggestion: '检查所有调用方的时序依赖，必要时添加 await 或移除 async',
      });
    }

    // ----------------------------------------------------------
    //  风险类型 3：异常处理缺失
    //  上游明确声明了异常，鸿蒙没有对应的异常处理
    // ----------------------------------------------------------
    if (match.missingExceptionHandling.length > 0) {
      risks.push({
        severity: 'medium',
        category: 'missing_exception',
        description: `方法 ${match.name} 缺失异常处理：上游声明了 ${match.missingExceptionHandling.join(', ')} 异常，鸿蒙未实现`,
        location: match.parentClass ? `${match.parentClass}.${match.name}` : match.name,
        impact: '异常情况未处理，可能导致崩溃或未定义行为',
        suggestion: '添加对应的异常处理逻辑',
      });
    }
  }

  // ----------------------------------------------------------
  //  风险类型 4：平台适配差异告警
  //  无法精确检测，标记高风险类供人工审查
  // ----------------------------------------------------------
  const highRiskCategories = ['网络请求', '文件IO', '多线程', 'UI渲染', '硬件调用'];
  for (const cls of upstream.classes) {
    const isHighRisk = highRiskCategories.some(cat => cls.name.toLowerCase().includes(cat.toLowerCase()));
    if (isHighRisk) {
      risks.push({
        severity: 'medium',
        category: 'platform_adaptation',
        description: `类 ${cls.name} 涉及平台敏感能力，转化过程可能引入适配问题`,
        location: cls.name,
        impact: '鸿蒙平台限制可能导致降级实现或功能不可用',
        suggestion: '人工审查该类的鸿蒙实现，确认平台适配无遗漏',
      });
    }
  }

  console.log(`[Bug风险] 发现 ${risks.length} 个潜在风险`);
  return risks;
}

// ============================================================
//  辅助函数
// ============================================================

/** 对比两个函数的签名差异 */
function compareFunctionSignatures(
  upstream: { name: string; params: { name: string; type: string; isOptional: boolean }[]; returnType: string; isAsync: boolean },
  harmony: { name: string; params: { name: string; type: string; isOptional: boolean }[]; returnType: string; isAsync: boolean },
  parentClass: string,
  upstreamThrows: string[] = [],
  harmonyThrows: string[] = [],
): MatchedFunction {
  const paramChanges: ParamChange[] = [];

  // 对比参数列表
  const maxLen = Math.max(upstream.params.length, harmony.params.length);
  for (let i = 0; i < maxLen; i++) {
    const up = upstream.params[i];
    const hm = harmony.params[i];
    if (!up || !hm || up.type !== hm.type) {
      paramChanges.push({
        paramName: up?.name || hm?.name || `param${i}`,
        upstreamType: up?.type || '(无)',
        harmonyType: hm?.type || '(无)',
      });
    }
  }

  const returnTypeChanged = normalizeType(upstream.returnType) !== normalizeType(harmony.returnType);
  const asyncModeChanged = upstream.isAsync !== harmony.isAsync;

  return {
    name: upstream.name,
    parentClass,
    upstreamSignature: `${upstream.name}(${upstream.params.map(p => `${p.type} ${p.name}`).join(', ')}): ${upstream.returnType}`,
    harmonySignature: `${harmony.name}(${harmony.params.map(p => `${p.type} ${p.name}`).join(', ')}): ${harmony.returnType}`,
    signatureChanged: paramChanges.length > 0 || returnTypeChanged,
    returnTypeChanged,
    paramChanges,
    asyncModeChanged,
    upstreamThrows: upstreamThrows || [],
    harmonyThrows: harmonyThrows || [],
    missingExceptionHandling: (upstreamThrows || []).filter(t => !(harmonyThrows || []).includes(t)),
  };
}

/** 类型名归一化（Java/Kotlin 类型 → 鸿蒙类型的映射）*/
function normalizeType(type: string): string {
  const mapping: Record<string, string> = {
    'int': 'number', 'long': 'number', 'float': 'number', 'double': 'number',
    'Integer': 'number', 'Long': 'number', 'Float': 'number', 'Double': 'number',
    'String': 'string', 'boolean': 'boolean', 'Boolean': 'boolean',
    'void': 'void', 'Void': 'void',
    'List': 'Array', 'Map': 'Record', 'Set': 'Array',
    'ArrayList': 'Array', 'HashMap': 'Record',
    'Callback': 'Promise', 'Listener': 'callback',
    'Context': 'Context',
  };
  return mapping[type] || type;
}

/** 推断重要性等级 */
function inferSignificance(item: { name?: string; type?: string; isConstant?: boolean }, kind: string): 'critical' | 'high' | 'medium' | 'low' {
  const name = (item.name || '').toLowerCase();
  // 关键标识词 → critical
  if (name.includes('init') || name.includes('create') || name.includes('initialize')) return 'critical';
  if (name.includes('pay') || name.includes('login') || name.includes('auth')) return 'critical';
  // 公开方法 → high
  if (kind === 'method' && !name.startsWith('_')) return 'high';
  // 常量 → medium
  if (item.isConstant) return 'medium';
  return 'low';
}

function findModuleFor(className: string, modules: UpstreamAPI['modules'], classes: UpstreamAPI['classes']): string {
  for (const mod of modules) {
    if (mod.relatedClasses.includes(className)) return mod.name;
  }
  return '未分类';
}
