/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                  一致性插件 — 上游安卓 SDK 解析                                ║
║                                                                              ║
║     功能：读取上游安卓 SDK 的文档和源码，提取公开 API 清单                       ║
║                                                                              ║
║     解析对象：                                                                 ║
║       · README / API 文档 → 功能模块列表、使用示例中的关键类和方法               ║
║       · 源码目录结构 → 包名、类名、模块划分                                     ║
║       · 公开接口定义 → 类名、方法签名（含参数和返回值类型）                       ║
║       · 常量 / 枚举 / 配置项                                                   ║
║                                                                              ║
║     资料来源：                                                                 ║
║       · 安卓 Maven/AAR 中的 classes.jar（提取公开类和方法）                     ║
║       · SDK 的公开 API 文档（如果有）                                          ║
║       · 源码仓库中的 public API 定义                                           ║
║                                                                              ║
║     提取的信息结构：                                                            ║
║       类 → 方法列表 → 参数类型/返回值类型                                        ║
║       类 → 属性/字段列表                                                        ║
║       模块 → 类列表                                                             ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

/** 上游 SDK API 清单 */
export interface UpstreamAPI {
  sdkName: string;               // SDK 名称
  sdkVersion: string;            // 上游版本号
  source: string;                // 资料来源（如 Maven 坐标、源码路径）
  packages: PackageInfo[];       // 包/模块列表
  classes: ClassInfo[];          // 所有公开类
  functions: FunctionInfo[];     // 所有公开方法（扁平化）
  modules: ModuleInfo[];         // 功能模块（语义分组）
}

interface PackageInfo {
  name: string;                  // 包名，如 com.example.sdk.pay
  classes: string[];             // 该类下的类名列表
}

interface ClassInfo {
  name: string;                  // 完整类名
  type: string;                  // class / interface / enum / abstract
  methods: FunctionInfo[];       // 公开方法
  fields: FieldInfo[];           // 公开字段
  parentClass: string | null;    // 继承/实现的类或接口
}

interface FunctionInfo {
  name: string;                  // 方法名
  signature: string;             // 完整签名
  params: ParamInfo[];           // 参数列表
  returnType: string;            // 返回值类型
  isAsync: boolean;              // 是否异步
  throwsInfo: string[];          // 可能抛出的异常
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
  name: string;                  // 功能模块名，如"支付模块"、"地图渲染模块"
  description: string;           // 模块说明
  relatedClasses: string[];      // 属于该模块的类
}

// ============================================================
//  [核心] parseUpstreamAPI — 解析上游安卓 SDK
//  从文档和源码中提取公开 API 清单
//  资料来源从 .sdk-governance.yml 的 consistency.sources 读取
// ============================================================
export async function parseUpstreamAPI(): Promise<UpstreamAPI> {
  console.log('[上游解析] 开始解析上游安卓 SDK 文档和代码...');

  // ----------------------------------------------------------
  //  读取配置，获取上游 SDK 资料来源
  //  配置格式：.sdk-governance.yml → consistency.sources[]
  //    例：{ sdk: "pay-sdk", maven: "com.example:pay-sdk:2.0.0" }
  // ----------------------------------------------------------
  const sources = readConsistencyConfig();

  // TODO: 根据 sources 配置获取上游 SDK 资料
  //   方式1：从 Maven Central/私有仓库下载 AAR，解包提取 classes.jar
  //   方式2：克隆上游源码仓库，扫描 public API 定义
  //   方式3：读取上游 API 文档的 HTML/Markdown

  // ----------------------------------------------------------
  //  提取 API 清单（模拟示例数据，开发时替换为实际解析逻辑）
  // ----------------------------------------------------------
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

/** 读取一致性检测的数据源配置 */
function readConsistencyConfig(): { sdkName: string; version: string; source: string } | null {
  // TODO: 从 .sdk-governance.yml 读取 consistency 配置
  return null;
}
