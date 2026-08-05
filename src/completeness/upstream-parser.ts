/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                  完整性检测插件 — 上游安卓 SDK 解析                              ║
║                                                                              ║
║     功能：读取上游安卓 SDK 的文档和源码，提取公开 API 清单                       ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

/** 上游 SDK API 清单 */
export interface UpstreamAPI {
  sdkName: string;
  sdkVersion: string;
  source: string;
  packages: PackageInfo[];
  classes: ClassInfo[];
  functions: FunctionInfo[];
  modules: ModuleInfo[];
}

interface PackageInfo {
  name: string;
  classes: string[];
}

interface ClassInfo {
  name: string;
  type: string;
  methods: FunctionInfo[];
  fields: FieldInfo[];
  parentClass: string | null;
}

interface FunctionInfo {
  name: string;
  signature: string;
  params: ParamInfo[];
  returnType: string;
  isAsync: boolean;
  throwsInfo: string[];
}

interface ParamInfo {
  name: string;
  type: string;
  isOptional: boolean;
}

interface FieldInfo {
  name: string;
  type: string;
  isConstant: boolean;
}

interface ModuleInfo {
  name: string;
  description: string;
  relatedClasses: string[];
}

// ============================================================
//  [核心] parseUpstreamAPI — 解析上游安卓 SDK
// ============================================================
export async function parseUpstreamAPI(): Promise<UpstreamAPI> {
  console.log('[上游解析] 开始解析上游安卓 SDK 文档和代码...');

  const sources = readCompletenessConfig();

  // TODO: 根据 sources 配置获取上游 SDK 资料
  return {
    sdkName: sources?.sdkName || 'unknown',
    sdkVersion: sources?.version || 'unknown',
    source: sources?.source || 'unknown',
    packages: [],
    classes: [],
    functions: [],
    modules: [],
  };
}

function readCompletenessConfig(): { sdkName: string; version: string; source: string } | null {
  // TODO: 从 .sdk-governance.yml 读取 completeness 配置
  return null;
}
