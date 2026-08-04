/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                  一致性插件 — 鸿蒙包解析                                       ║
║                                                                              ║
║     功能：读取仓库中已安装的鸿蒙包（oh_modules），提取公开 API 清单               ║
║                                                                              ║
║     解析对象：                                                                 ║
║       · Index.ets / Index.ts → 入口文件，包的对外接口                           ║
║       · *.ets / *.ts 源码 → 类、方法、类型定义                                  ║
║       · oh-package.json5 → 包名、版本、依赖                                    ║
║       · 类型定义文件（*.d.ts / *.ets）→ 类型签名                               ║
║                                                                              ║
║     提取的信息结构：                                                            ║
║       类 → 方法列表 → 参数类型/返回值类型                                        ║
║       类 → 属性/字段列表                                                        ║
║       模块 → 导出列表（export 语句）                                             ║
║                                                                              ║
║     注意：                                                                     ║
║       - .ets 语法和 .ts 不完全相同，需要处理 ArkTS 特有语法                       ║
║       - 鸿蒙的 export/import 等价于公开 API                                     ║
║       - 需要处理 namespace、default export 等特殊导出形式                        ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

/** 鸿蒙包 API 清单 */
export interface HarmonyAPI {
  sdkName: string;               // 鸿蒙包名
  sdkVersion: string;            // 鸿蒙包版本
  packages: HarmonyPackage[];    // 包/模块列表
  classes: HarmonyClass[];       // 所有公开类
  functions: HarmonyFunction[];  // 所有公开方法（扁平化）
  exports: ExportEntry[];        // 导出清单（Index.ets 中的 export 语句）
}

interface HarmonyPackage {
  name: string;
  classes: string[];
}

interface HarmonyClass {
  name: string;
  type: string;                  // class / interface / enum / struct
  methods: HarmonyFunction[];
  fields: HarmonyField[];
  parentClass: string | null;
}

interface HarmonyFunction {
  name: string;
  signature: string;
  params: HarmonyParam[];
  returnType: string;
  isAsync: boolean;              // Promise / async
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
  name: string;                  // 导出的名称
  type: string;                  // class / function / constant / type
  sourceFile: string;            // 来源文件
}

// ============================================================
//  [核心] parseHarmonyPackage — 解析鸿蒙包
//  扫描 oh_modules 中的指定 SDK
//  从入口文件 Index.ets 开始，递归解析所有 export
// ============================================================
export async function parseHarmonyPackage(): Promise<HarmonyAPI> {
  console.log('[鸿蒙解析] 开始解析鸿蒙包代码...');

  // ----------------------------------------------------------
  //  Step 1：定位鸿蒙包在 oh_modules 中的位置
  //  根据 .sdk-governance.yml 中的 consistency.targets 指定
  // ----------------------------------------------------------
  const targets = readTargetSDKs();

  // ----------------------------------------------------------
  //  Step 2：读取入口文件 Index.ets
  //  入口文件是所有 export 的汇聚点
  //  解析 export { ... } from 'xxx' 语句，建立导出清单
  // ----------------------------------------------------------
  // TODO: 读取 Index.ets，解析 export 语句

  // ----------------------------------------------------------
  //  Step 3：递归解析所有 .ets 文件
  //  提取类定义、方法签名、属性、类型定义
  //  注意 ArkTS 特有语法
  // ----------------------------------------------------------
  // TODO: 遍历源码文件，解析类、方法、类型

  // ----------------------------------------------------------
  //  Step 4：检查关键文件完整性
  //  入口文件是否存在、文件是否可读
  // ----------------------------------------------------------
  // TODO: 检查 Index.ets 等关键文件

  return {
    sdkName: targets?.[0]?.name || 'unknown',
    sdkVersion: '',
    packages: [],
    classes: [],
    functions: [],
    exports: [],
  };
}

/** 读取需要检测的鸿蒙 SDK 列表 */
function readTargetSDKs(): { name: string; version: string }[] | null {
  // TODO: 从 .sdk-governance.yml 读取 consistency.targets
  return null;
}
