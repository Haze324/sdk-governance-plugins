/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                  完整性检测插件 — 鸿蒙包解析                                    ║
║                                                                              ║
║     功能：读取仓库中已安装的鸿蒙包（oh_modules），提取公开 API 清单               ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

/** 鸿蒙包 API 清单 */
export interface HarmonyAPI {
  sdkName: string;
  sdkVersion: string;
  packages: HarmonyPackage[];
  classes: HarmonyClass[];
  functions: HarmonyFunction[];
  exports: ExportEntry[];
}

interface HarmonyPackage {
  name: string;
  classes: string[];
}

interface HarmonyClass {
  name: string;
  type: string;
  methods: HarmonyFunction[];
  fields: HarmonyField[];
  parentClass: string | null;
}

interface HarmonyFunction {
  name: string;
  signature: string;
  params: HarmonyParam[];
  returnType: string;
  isAsync: boolean;
}

interface HarmonyParam {
  name: string;
  type: string;
  isOptional: boolean;
}

interface HarmonyField {
  name: string;
  type: string;
  isConstant: boolean;
}

interface ExportEntry {
  name: string;
  type: string;
  sourceFile: string;
}

// ============================================================
//  [核心] parseHarmonyPackage — 解析鸿蒙包
// ============================================================
export async function parseHarmonyPackage(): Promise<HarmonyAPI> {
  console.log('[鸿蒙解析] 开始解析鸿蒙包代码...');

  const targets = readTargetSDKs();

  // TODO: 后续迭代实现完整的 .ets 解析
  return {
    sdkName: targets?.[0]?.name || 'unknown',
    sdkVersion: '',
    packages: [],
    classes: [],
    functions: [],
    exports: [],
  };
}

function readTargetSDKs(): { name: string; version: string }[] | null {
  // TODO: 从 .sdk-governance.yml 读取 completeness.targets
  return null;
}
