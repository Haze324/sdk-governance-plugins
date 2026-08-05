/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                  完整性检测插件 — 上游 vs 鸿蒙对比分析                           ║
║                                                                              ║
║     功能：对比上游安卓 SDK API 清单与鸿蒙包 API 清单，分析差异                    ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { UpstreamAPI } from './upstream-parser';
import { HarmonyAPI } from './harmony-parser';

export interface APIComparison {
  missingClasses: MissingItem[];
  missingFunctions: MissingItem[];
  missingFields: MissingItem[];
  missingModules: MissingItem[];
  addedClasses: string[];
  addedFunctions: string[];
  matchedFunctions: MatchedFunction[];
}

export interface MissingItem {
  name: string;
  parentClass: string;
  parentModule: string;
  significance: 'critical' | 'high' | 'medium' | 'low';
  description: string;
}

export interface MatchedFunction {
  name: string;
  parentClass: string;
  upstreamSignature: string;
  harmonySignature: string;
  signatureChanged: boolean;
  returnTypeChanged: boolean;
  paramChanges: ParamChange[];
  asyncModeChanged: boolean;
  upstreamThrows: string[];
  harmonyThrows: string[];
  missingExceptionHandling: string[];
}

export interface ParamChange {
  paramName: string;
  upstreamType: string;
  harmonyType: string;
}

export interface BugRisk {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'signature_change' | 'async_mismatch' | 'missing_exception' | 'platform_adaptation';
  description: string;
  location: string;
  impact: string;
  suggestion: string;
}

export function compareAPI(upstream: UpstreamAPI, harmony: HarmonyAPI): APIComparison {
  console.log('[API 对比] 开始对比上游和鸿蒙 API 清单...');

  const result: APIComparison = {
    missingClasses: [], missingFunctions: [], missingFields: [],
    missingModules: [], addedClasses: [], addedFunctions: [], matchedFunctions: [],
  };

  const upstreamClassNames = new Set(upstream.classes.map(c => c.name));
  const harmonyClassNames = new Set(harmony.classes.map(c => c.name));

  for (const cls of upstream.classes) {
    if (!harmonyClassNames.has(cls.name)) {
      result.missingClasses.push({
        name: cls.name, parentClass: cls.parentClass || '—',
        parentModule: findModuleFor(cls.name, upstream.modules, upstream.classes),
        significance: inferSignificance(cls, 'class'),
        description: `上游 SDK 中存在类 ${cls.name}（${cls.type}），鸿蒙包中未找到对应实现`,
      });
    }
  }
  for (const cls of harmony.classes) {
    if (!upstreamClassNames.has(cls.name)) result.addedClasses.push(cls.name);
  }

  for (const upstreamCls of upstream.classes) {
    const harmonyCls = harmony.classes.find(c => c.name === upstreamCls.name);
    if (!harmonyCls) continue;
    const harmonyFuncNames = new Set(harmonyCls.methods.map(m => m.name));
    for (const upstreamMethod of upstreamCls.methods) {
      if (!harmonyFuncNames.has(upstreamMethod.name)) {
        result.missingFunctions.push({
          name: `${upstreamCls.name}.${upstreamMethod.name}`,
          parentClass: upstreamCls.name,
          parentModule: findModuleFor(upstreamCls.name, upstream.modules, upstream.classes),
          significance: inferSignificance(upstreamMethod, 'method'),
          description: `上游类 ${upstreamCls.name} 中存在方法 ${upstreamMethod.name}，鸿蒙包中未找到`,
        });
      } else {
        const hm = harmonyCls.methods.find(m => m.name === upstreamMethod.name)!;
        result.matchedFunctions.push(compareFunctionSignatures(upstreamMethod, hm, upstreamCls.name));
        for (const hm2 of harmonyCls.methods) {
          const upNames = new Set(upstreamCls.methods.map(m => m.name));
          if (!upNames.has(hm2.name)) result.addedFunctions.push(`${upstreamCls.name}.${hm2.name}`);
        }
      }
    }
  }

  for (const mod of upstream.modules) {
    const covered = mod.relatedClasses.every(c => harmonyClassNames.has(c) || result.addedClasses.includes(c));
    if (!covered) {
      result.missingModules.push({
        name: mod.name, parentClass: '—', parentModule: '—', significance: 'high',
        description: `功能模块"${mod.name}"不完整：${mod.description}`,
      });
    }
  }

  const total = result.missingClasses.length + result.missingFunctions.length + result.missingFields.length + result.missingModules.length;
  console.log(`[API 对比] 缺失项: ${total}`);
  return result;
}

export function analyzeBugRisks(upstream: UpstreamAPI, harmony: HarmonyAPI): BugRisk[] {
  console.log('[Bug风险] 开始分析转化可能引入的 bug 风险...');
  const comparison = compareAPI(upstream, harmony);
  const risks: BugRisk[] = [];

  for (const match of comparison.matchedFunctions) {
    if (match.signatureChanged) {
      risks.push({
        severity: 'high', category: 'signature_change',
        description: `方法 ${match.name} 签名变更`,
        location: `${match.parentClass}.${match.name}`,
        impact: '调用方可能传入错误类型参数或错误处理返回值',
        suggestion: '检查所有调用处，确认参数和返回值处理逻辑已适配',
      });
    }
    if (match.asyncModeChanged) {
      risks.push({
        severity: 'high', category: 'async_mismatch',
        description: `方法 ${match.name} 异步模式不匹配`,
        location: `${match.parentClass}.${match.name}`,
        impact: '调用方依赖时序的逻辑可能出错',
        suggestion: '检查调用方的时序依赖',
      });
    }
    if (match.missingExceptionHandling.length > 0) {
      risks.push({
        severity: 'medium', category: 'missing_exception',
        description: `方法 ${match.name} 缺失异常处理：${match.missingExceptionHandling.join(', ')}`,
        location: `${match.parentClass}.${match.name}`,
        impact: '异常情况未处理，可能导致崩溃',
        suggestion: '添加对应的异常处理逻辑',
      });
    }
  }

  const highRiskCategories = ['网络请求', '文件IO', '多线程', 'UI渲染', '硬件调用'];
  for (const cls of upstream.classes) {
    if (highRiskCategories.some(c => cls.name.toLowerCase().includes(c.toLowerCase()))) {
      risks.push({
        severity: 'medium', category: 'platform_adaptation',
        description: `类 ${cls.name} 涉及平台敏感能力，转化过程可能引入适配问题`,
        location: cls.name,
        impact: '鸿蒙平台限制可能导致降级实现或功能不可用',
        suggestion: '人工审查该类的鸿蒙实现',
      });
    }
  }

  console.log(`[Bug风险] 发现 ${risks.length} 个潜在风险`);
  return risks;
}

function compareFunctionSignatures(
  upstream: { name: string; params: { name: string; type: string; isOptional: boolean }[]; returnType: string; isAsync: boolean },
  harmony: { name: string; params: { name: string; type: string; isOptional: boolean }[]; returnType: string; isAsync: boolean },
  parentClass: string, upstreamThrows: string[] = [], harmonyThrows: string[] = [],
): MatchedFunction {
  const paramChanges: ParamChange[] = [];
  for (let i = 0; i < Math.max(upstream.params.length, harmony.params.length); i++) {
    const up = upstream.params[i], hm = harmony.params[i];
    if (!up || !hm || up.type !== hm.type) {
      paramChanges.push({ paramName: up?.name || hm?.name || `param${i}`, upstreamType: up?.type || '(无)', harmonyType: hm?.type || '(无)' });
    }
  }
  const returnTypeChanged = normalizeType(upstream.returnType) !== normalizeType(harmony.returnType);
  return {
    name: upstream.name, parentClass,
    upstreamSignature: `${upstream.name}(${upstream.params.map(p => `${p.type} ${p.name}`).join(', ')}): ${upstream.returnType}`,
    harmonySignature: `${harmony.name}(${harmony.params.map(p => `${p.type} ${p.name}`).join(', ')}): ${harmony.returnType}`,
    signatureChanged: paramChanges.length > 0 || returnTypeChanged,
    returnTypeChanged, paramChanges,
    asyncModeChanged: upstream.isAsync !== harmony.isAsync,
    upstreamThrows: upstreamThrows || [], harmonyThrows: harmonyThrows || [],
    missingExceptionHandling: (upstreamThrows || []).filter(t => !(harmonyThrows || []).includes(t)),
  };
}

function normalizeType(type: string): string {
  const m: Record<string, string> = { 'int':'number', 'long':'number', 'float':'number', 'double':'number', 'Integer':'number', 'Long':'number', 'Float':'number', 'Double':'number', 'String':'string', 'boolean':'boolean', 'Boolean':'boolean', 'void':'void', 'Void':'void', 'List':'Array', 'Map':'Record', 'Set':'Array', 'ArrayList':'Array', 'HashMap':'Record', 'Callback':'Promise', 'Listener':'callback', 'Context':'Context' };
  return m[type] || type;
}

function inferSignificance(item: { name?: string; isConstant?: boolean }, kind: string): 'critical' | 'high' | 'medium' | 'low' {
  const n = (item.name || '').toLowerCase();
  if (n.includes('init') || n.includes('create') || n.includes('pay') || n.includes('login') || n.includes('auth')) return 'critical';
  if (kind === 'method' && !n.startsWith('_')) return 'high';
  if (item.isConstant) return 'medium';
  return 'low';
}

function findModuleFor(className: string, modules: UpstreamAPI['modules'], classes: UpstreamAPI['classes']): string {
  for (const mod of modules) { if (mod.relatedClasses.includes(className)) return mod.name; }
  return '未分类';
}
