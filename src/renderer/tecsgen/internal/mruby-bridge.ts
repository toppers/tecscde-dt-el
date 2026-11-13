// [[TECSCDE-DT-EL内部仕様 - 09D V0.2.0tecsgen設定と内部処理]] 9D.6 の10 — MrubyBridgePlugin 系の CDL 生成を、
// tecsgen 1.9.1 のプラグイン（MrubyBridgePlugin version 2.0.0）から移植する。
//
// 移植元（tecsgen 1.9.1 の tecslib/plugin/）:
//   MrubyBridgePlugin.rb（MultiPlugin。対象の種類で下の3つへ振り分ける）
//   MrubyBridgeSignaturePlugin.rb・lib/MrubyBridgeSignaturePluginModule.rb（署名）
//   MrubyBridgeCelltypePlugin.rb・lib/MrubyBridgeCelltypePluginModule.rb（セルタイプ）
//   MrubyBridgeCellPlugin.rb（セル）
// 移すのは CDL の生成（gen_cdl_file・new_cell・gen_post_code）だけで、C コードの生成は移さない。
// Ruby 版のクラス変数（@@...）は、実行ごとの `MrubyBridgeState` に置く（実行をまたいで残さない）。

import type { CTypeRegistry } from "../../cdecl/type-registry";
import type { CType } from "../../cdecl/types";
import type { ParameterUse, SignatureFunctionDecl } from "../../cdl/signature-types";
import {
  absoluteName, stripQuotes,
  type CdlProgram, type CellSymbol, type CelltypeSymbol, type PluginInstance, type SignatureSymbol,
} from "./cdl-program";
import { parsePluginArgs } from "./plugin-args";

/** プラグインの実行で起きた、tecsgen ならエラーになる事象。生成物は取り込まない。 */
export class PluginError extends Error {}

/** 生成した CDL を書き、その場で読む口（プロセッサが実装する）。 */
export interface PluginHost {
  readonly program: CdlProgram;
  readonly cTypes: CTypeRegistry;
  /** tecsgen の generate_and_parse: `tmp_<クラス名>_<番号>.cdl` に書いて読む。 */
  generateAndParse(className: string, genCdlFile: () => string, owner: PluginInstance): void;
  /** 名前を指定して書き、読む（Import.new・Generator.parse に当たる）。 */
  writeAndParse(className: string, fileName: string, text: string, owner?: PluginInstance): void;
  /** post code を出すクラスとして登録する（tecsgen の loaded_plugin_list）。 */
  registerPostCode(className: string, genPostCode: () => string): void;
  /** プラグインごとの、実行中だけ残る状態（Ruby 版のクラス変数）。 */
  state<T>(key: string, create: () => T): T;
  info(message: string): void;
}

// MrubyBridgeSignaturePluginModule の @@TYPE_MAP（型の文字列 → [型, クラス名の部分, ...]）。CDL の生成に使うのは2列目だけ。
const TYPE_MAP: ReadonlyMap<string, string> = new Map([
  ["char_t", "Char"], ["uchar_t", "UChar"], ["schar_t", "SChar"],
  ["bool_t", "Bool"],
  ["int8_t", "Int8"], ["int16_t", "Int16"], ["int32_t", "Int32"], ["int64_t", "Int64"],
  ["uint8_t", "UInt8"], ["uint16_t", "UInt16"], ["uint32_t", "UInt32"], ["uint64_t", "UInt64"],
  ["int", "Int"], ["char", "Char"], ["short", "Short"], ["long", "Long"],
  ["unsigned char", "UChar"], ["unsigned int", "UInt"], ["unsigned short", "UShort"], ["unsigned long", "ULong"],
  ["signed char", "SChar"], ["signed int", "Int"], ["signed short", "Short"], ["signed long", "Long"],
  ["float32_t", "Float32"], ["double64_t", "Double64"],
  ["float", "Float32"], ["double", "Double64"],
]);

const INT_NAMES = new Set([
  "char", "short", "int", "long", "int64", "char_t", "schar_t", "uchar_t",
  "int8_t", "int16_t", "int32_t", "int64_t", "int128_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t", "uint128_t",
]);
const FLOAT_NAMES = new Set(["float", "double", "float32_t", "double64_t"]);
const BOOL_NAMES = new Set(["bool", "bool_t"]);

type Category = "int" | "float" | "bool" | "void" | "pointer" | "struct" | "other";

interface StructInfo {
  readonly tag: string;
}

/** Ruby 版のクラス変数。実行ごとに作る。 */
export class MrubyBridgeState {
  readonly celltypes = new Map<string, SignaturePlugin[]>();
  readonly initCelltypes = new Set<string>();
  readonly structList = new Map<string, StructInfo>();
  readonly ptrList = new Map<string, string>();
  readonly vmList = new Set<string>();
  readonly vmCelltypes = new Map<string, Map<string, CellSymbol[]>>();
  readonly vmStructList = new Map<string, Map<string, StructInfo>>();
  readonly vmPtrList = new Map<string, Map<string, string>>();
  postCoded = false;
  // MrubyBridgeCellPlugin
  readonly cellList = new Set<CellSymbol>();
  readonly signatureList = new Set<SignatureSymbol>();
  // MrubyBridgeCelltypePluginModule（@@count は 1 から）
  celltypeModuleCount = 1;
}

export const SIGNATURE_PLUGIN = "MrubyBridgeSignaturePlugin";
export const CELLTYPE_PLUGIN = "MrubyBridgeCelltypePlugin";
export const CELL_PLUGIN = "MrubyBridgeCellPlugin";

export function signatureNamespacePath(signature: SignatureSymbol): string {
  return absoluteName(signature.scope, signature.name);
}

function globalName(scope: readonly string[], name: string): string {
  return [...scope, name].join("_");
}

/** tecsgen の get_original_type の分類と、TYPE_MAP の鍵になる型の文字列。 */
interface Classified {
  readonly category: Category;
  readonly typeStr?: string;
  readonly pointee?: CType;
  readonly struct?: { readonly tag?: string; readonly members: readonly { readonly name: string; readonly type: CType }[] };
  readonly unsignedChar?: boolean;
}

function classify(type: CType | undefined, cTypes: CTypeRegistry, where: string): Classified {
  if (!type) throw new PluginError(`${where}: 型を解析できません`);
  const resolved = cTypes.resolve(type);
  if (!resolved.type) {
    // 列挙型などの未対応の型は、tecsgen でも整数・浮動小数・真偽のどれでもない（扱えない型）。
    if (resolved.reason?.startsWith("未対応")) return { category: "other" };
    throw new PluginError(`${where}: ${resolved.reason ?? "型を解決できません"}`);
  }
  const t = resolved.type;
  switch (t.kind) {
    case "primitive": {
      const typeStr = (t.spelling ?? t.name).replace(/\bconst\s+/g, "").replace(/\bvolatile\s+/g, "").trim();
      if (t.name === "void") return { category: "void", typeStr };
      if (INT_NAMES.has(t.name)) return { category: "int", typeStr };
      if (FLOAT_NAMES.has(t.name)) return { category: "float", typeStr };
      if (BOOL_NAMES.has(t.name)) return { category: "bool", typeStr };
      return { category: "other", typeStr };
    }
    case "pointer": return { category: "pointer", pointee: t.pointee };
    case "struct": return { category: "struct", struct: { ...(t.tag ? { tag: t.tag } : {}), members: t.members ?? [] } };
    default: return { category: "other" };
  }
}

interface SignatureOptions {
  ignoreUnsigned: boolean;
  includes: string[];
  excludes: string[];
  autoExclude: boolean;
}

/** MrubyBridgeSignaturePlugin（署名プラグイン）。 */
export class SignaturePlugin implements PluginInstance {
  readonly celltypeName: string;
  readonly initCelltypeName: string;
  private readonly structs = new Map<string, StructInfo>();
  private readonly ptrs = new Map<string, string>();
  private readonly autoExcluded = new Set<string>();
  private readonly options: SignatureOptions = { ignoreUnsigned: false, includes: [], excludes: [], autoExclude: true };

  constructor(
    private readonly signature: SignatureSymbol,
    option: string,
    private readonly state: MrubyBridgeState,
    private readonly host: PluginHost,
  ) {
    for (const [ident, rhs] of parsePluginArgs(option)) this.setArg(ident, rhs);
    const global = globalName(signature.scope, signature.name);
    this.celltypeName = `t${global}`;
    this.initCelltypeName = `${this.celltypeName}_Initializer`;
    if (this.options.includes.length > 0 && this.options.excludes.length > 0) {
      throw new PluginError("MRB1011 both include && exclude are specified");
    }
    const heads = signature.functions.filter((fn) =>
      this.options.includes.length > 0 ? this.options.includes.includes(fn.name)
        : this.options.excludes.length > 0 ? !this.options.excludes.includes(fn.name) : true);
    this.checkReturnTypes(heads);
    this.checkParameterTypes(heads);
    if (heads.every((fn) => this.autoExcluded.has(fn.name))) {
      throw new PluginError(`MRB1012 '${signature.name}' no function remained by exclude`);
    }
  }

  private setArg(ident: string, rhs: string): void {
    switch (ident) {
      case "ignoreUnsigned":
        if (rhs === "true") this.options.ignoreUnsigned = true;
        return;
      case "include":
      case "exclude": {
        const names = this.signature.functions.map((fn) => fn.name);
        for (const raw of rhs.split(",")) {
          const fn = raw.replace(/\s/g, "");
          if (!names.includes(fn)) throw new PluginError(`MRB10${ident === "include" ? "09" : "10"} ${ident} function '${rhs}' not found in signagture '${this.signature.name}'`);
          (ident === "include" ? this.options.includes : this.options.excludes).push(fn);
        }
        return;
      }
      case "auto_exclude":
        if (rhs === "false") this.options.autoExclude = false;
        else if (rhs === "true") this.options.autoExclude = true;
        else this.host.info("MRB9999 auto_exclude: unknown rhs value ignored. specify true or false");
        return;
      default:
        throw new PluginError(`MrubyBridgePlugin: 未知のプラグイン引数 '${ident}'`);
    }
  }

  private exclude(fn: SignatureFunctionDecl, message: string): void {
    if (!this.options.autoExclude) throw new PluginError(message);
    this.autoExcluded.add(fn.name);
  }

  private where(fn: SignatureFunctionDecl, parameter?: ParameterUse): string {
    return `${this.signature.name}.${fn.name}${parameter?.name ? `(${parameter.name})` : ""}`;
  }

  private checkReturnTypes(heads: readonly SignatureFunctionDecl[]): void {
    for (const fn of heads) {
      const c = classify(fn.returns.type, this.host.cTypes, this.where(fn));
      if (!["bool", "int", "float", "void"].includes(c.category)) this.exclude(fn, `MRB1001 cannot return type (${fn.name})`);
    }
  }

  private checkParameterTypes(heads: readonly SignatureFunctionDecl[]): void {
    for (const fn of heads) {
      for (const parameter of realParameters(fn)) {
        const where = this.where(fn, parameter);
        const direction = directionOf(parameter);
        if (direction === "send" || direction === "receive") this.exclude(fn, `MRB1003 ${parameter.name}: ${direction} parameter cannot be used in mruby Bridge`);
        const c = classify(parameter.type, this.host.cTypes, where);
        let ng = false;
        switch (c.category) {
          case "int":
          case "bool":
          case "float":
            break;
          case "pointer": {
            const target = classify(c.pointee, this.host.cTypes, where);
            this.registerPtrType(target);
            if (hasSpecifier(parameter, /^string$/) && (direction === "out" || direction === "inout")) {
              this.exclude(fn, "MRB9999 string specifier without length cannot be used for out & inout parameter");
            }
            if (target.category === "struct") {
              if (hasSpecifier(parameter, /^(size_is|count_is|string)\b/)) {
                this.exclude(fn, `MRB1004 ${parameter.name}: size_is, count_is, string cannot be specified for struct pointer`);
              }
              this.checkStructMember(target, fn);
            } else if (!["int", "float", "bool"].includes(target.category)) {
              ng = true;
            }
            break;
          }
          case "struct":
            this.checkStructMember(c, fn);
            break;
          default:
            ng = true;
        }
        if (ng) this.exclude(fn, `MRB1005 ${parameter.name}: type cannot be used in mruby Bridge`);
      }
    }
  }

  private checkStructMember(c: Classified, fn: SignatureFunctionDecl): void {
    const struct = c.struct;
    if (!struct) return;
    if (!struct.tag) {
      this.exclude(fn, "MRB10007 tagless-struct cannot be handled");
      return;
    }
    for (const member of struct.members) {
      const m = classify(member.type, this.host.cTypes, `struct ${struct.tag}.${member.name}`);
      if (!["int", "float", "bool"].includes(m.category)) {
        this.exclude(fn, `MRB1006 ${member.name}: type not allowed for struct member`);
        return;
      }
    }
    if (!this.structs.has(struct.tag)) this.structs.set(struct.tag, { tag: struct.tag });
  }

  private registerPtrType(target: Classified): void {
    if (target.category === "struct" || !target.typeStr) return;
    let typeStr = target.typeStr;
    if (this.options.ignoreUnsigned) {
      typeStr = typeStr.replace("unsigned ", "").replace("uint", "int").replace(/[cs]char/, "char");
    }
    const className = TYPE_MAP.get(typeStr);
    if (!className) return;
    const ptrCelltypeName = `t${className}Pointer`;
    if (!this.state.ptrList.has(ptrCelltypeName)) this.state.ptrList.set(ptrCelltypeName, className);
    if (!this.ptrs.has(ptrCelltypeName)) this.ptrs.set(ptrCelltypeName, className);
  }

  genCdlFile(): string {
    const existing = this.state.celltypes.get(this.celltypeName);
    if (existing) {
      this.host.info(`MRBW001 MrubyBridgePlugin: signature '${signatureNamespacePath(this.signature)}' duplicate. ignored current one`);
      existing.push(this);
      return "";
    }
    this.state.celltypes.set(this.celltypeName, [this]);
    this.state.initCelltypes.add(this.initCelltypeName);
    const nsp = signatureNamespacePath(this.signature);
    const className = `T${globalName(this.signature.scope, this.signature.name)}`;
    let out = `/*
 * MrubyBridgeSignaturePlugin:
 *     signature=${nsp}
 *
 *   => celltype=nMruby::${this.celltypeName}
 *      (bridge cell's celltype; generated in this file)
 *      cell nMruby::${this.celltypeName} BridgeCellName { cTECS = CellName.eEntry; };
 *        where eEntry's signature must be ${nsp}.
 *      => class=TECS::${className}
 *         (mruby's class; accessible from your script)
 *          bridge = TECS::${className}.new("BridgeCellName")
 */
import( <mruby.cdl> );

/****  Ruby => TECS Bridge Celltype (MBP500) ****/
namespace nMruby{
    // bridge celltype
    [idx_is_id,active]   // not actually active, to avoid warning W1002, W1007
    celltype ${this.celltypeName} {
        call ${nsp} cTECS;
        attr {
            [omit]
            char_t *VMname = "VM";
            [omit]
            char_t *bridgeName = C_EXP( "$cell$" );
        };
    };
    // bridge initializer celltype
    celltype ${this.initCelltypeName} {
        entry sInitializeTECSBridge eInitialize;
    };
};
`;
    for (const [name, struct] of this.structs) {
      if (this.state.structList.has(name)) continue;
      out += `namespace nMruby{
    [singleton]
    celltype ${name} {
        entry sInitializeTECSBridge eInitialize;
    };
};
`;
      this.state.structList.set(name, struct);
    }
    return out;
  }

  newCell(cell: CellSymbol): void {
    if (cell.celltype?.name !== this.celltypeName) return;
    const vmJoin = cell.joins.get("VMname");
    const vmName = vmJoin !== undefined ? stripQuotes(vmJoin) : "VM";
    if (!this.state.vmList.has(vmName)) {
      this.state.vmList.add(vmName);
      this.host.writeAndParse(SIGNATURE_PLUGIN, `${cell.name}Initializer.cdl`, `
  // prototype of TECSInitializer (MBP510)
  cell nMruby::tTECSInitializer ${vmName}_TECSInitializer;
`, this);
    }
    let vma = this.state.vmCelltypes.get(vmName);
    if (!vma) {
      vma = new Map();
      this.state.vmCelltypes.set(vmName, vma);
    }
    const cells = vma.get(this.celltypeName);
    if (cells) cells.push(cell);
    else vma.set(this.celltypeName, [cell]);
    for (const [, struct] of this.structs) {
      const list = this.state.vmStructList.get(vmName) ?? new Map<string, StructInfo>();
      list.set(struct.tag, struct);
      this.state.vmStructList.set(vmName, list);
    }
    for (const [name, className] of this.ptrs) {
      const list = this.state.vmPtrList.get(vmName) ?? new Map<string, string>();
      list.set(name, className);
      this.state.vmPtrList.set(vmName, list);
    }
  }
}

/** MrubyBridgeSignaturePlugin.gen_post_code_body。 */
export function signaturePostCode(state: MrubyBridgeState): string {
  if (state.postCoded) return "";
  state.postCoded = true;
  let out = "\n  // MrubyBridgeSignaturePlugin: MBP601\n";
  for (const [vmName, instances] of state.vmCelltypes) {
    for (const [, cells] of instances) {
      const celltype = cells[0]?.celltype;
      if (!celltype) continue;
      const info = /^tInfo/.test(celltype.name) ? "Info" : "";
      out += `  cell nMruby${info}::${celltype.name}_Initializer ${vmName}_${celltype.name}_Initializer{ };\n`;
    }
  }
  out += "  // MBP602\n";
  for (const [name] of state.ptrList) out += `  cell nMruby::${name} C${name} { };\n`;
  out += "  // MBP603\n";
  for (const [name] of state.structList) out += `  cell nMruby::${name} C${name} { };\n`;
  for (const [vmName, instances] of state.vmCelltypes) {
    out += `  /* === VM name is '${vmName}' === (MBP610) */\n`;
    out += `  cell nMruby::tTECSInitializer ${vmName}_TECSInitializer {\n`;
    for (const [celltypeName] of instances) out += `    cInitialize[] = ${vmName}_${celltypeName}_Initializer.eInitialize;\n`;
    for (const [name] of state.vmPtrList.get(vmName) ?? []) out += `    cInitialize[] = C${name}.eInitialize;\n`;
    for (const [name] of state.vmStructList.get(vmName) ?? []) out += `    cInitialize[] = C${name}.eInitialize;\n`;
    out += "  };";
  }
  return out;
}

interface BridgeOptions {
  ignoreUnsigned: boolean;
  autoExclude: boolean;
  excludePort: string[];
  excludePortFunc: Map<string, string[]>;
}

function setBridgeOption(options: BridgeOptions, ident: string, rhs: string, celltype: CelltypeSymbol | undefined, host: PluginHost): void {
  switch (ident) {
    case "ignoreUnsigned":
      if (rhs === "true") options.ignoreUnsigned = true;
      return;
    case "auto_exclude":
      if (rhs === "false") options.autoExclude = false;
      else if (rhs === "true") options.autoExclude = true;
      else host.info("MRB9999 auto_exclude: unknown rhs value ignored. specify true or false");
      return;
    case "exclude_port":
      if (!celltype) return;
      for (const port of rhs.split(",")) {
        const found = celltype.ports.find((p) => p.name === port);
        if (!found || found.kind !== "entry") throw new PluginError(`MRB9999 exclude_port '${port}' not found or not entry in celltype '${celltype.name}'`);
        options.excludePort.push(port);
      }
      return;
    case "exclude_port_func":
      if (!celltype) return;
      for (const item of rhs.split(",")) {
        const [portName, funcName, ...rest] = item.split(".");
        if (!portName || !funcName || rest.length > 0) throw new PluginError(`MRB9999 exclude_port_func: '${item}' not in 'port.func' form`);
        const port = celltype.ports.find((p) => p.name === portName);
        if (!port || port.kind !== "entry") throw new PluginError(`MRB9999 exclude_port_func: port '${item}' not found in celltype '${celltype.name}'`);
        if (!port.signature) continue;
        if (!port.signature.functions.some((fn) => fn.name === funcName)) {
          throw new PluginError(`MRB9999 exclude_port_func: func '${funcName}' not found in port '${portName}' celltype ${celltype.name}`);
        }
        options.excludePortFunc.set(portName, [...(options.excludePortFunc.get(portName) ?? []), funcName]);
      }
      return;
    default:
      throw new PluginError(`MrubyBridgePlugin: 未知のプラグイン引数 '${ident}'`);
  }
}

/** MrubyBridgeCellPlugin（セルプラグイン）。 */
export class CellPlugin implements PluginInstance {
  private readonly options: BridgeOptions = { ignoreUnsigned: false, autoExclude: true, excludePort: [], excludePortFunc: new Map() };
  private readonly portList = new Map<string, string>();

  constructor(private readonly cell: CellSymbol, option: string, private readonly state: MrubyBridgeState, private readonly host: PluginHost) {
    for (const [ident, rhs] of parsePluginArgs(option)) setBridgeOption(this.options, ident, rhs, cell.celltype, host);
    const celltype = cell.celltype;
    if (!celltype) return;
    for (const port of celltype.ports) {
      if (this.options.excludePort.length > 0 && this.options.excludePort.includes(port.name)) continue;
      this.portList.set(port.name, "");
    }
    if (this.options.excludePortFunc.size > 0) {
      for (const [portName, initial] of this.portList) {
        let optStr = initial;
        let delim = "";
        for (const funcName of this.options.excludePortFunc.get(portName) ?? []) {
          optStr += `${delim}exclude=${funcName}`;
          delim = ",";
        }
        this.portList.set(portName, optStr);
      }
    }
  }

  /** セルプラグインの生成物はセルタイプを定義しないので、通知されるセルは無い。 */
  newCell(): void {}

  genCdlFile(): string {
    let out = `/* MrubyBridgeCellPlugin: generate for cell=${this.cell.name} */\n`;
    if (this.state.cellList.has(this.cell)) {
      out += `
/*
 * generate for ${this.cell.name} duplicate and ignored.
 * This might comes from generate for celltype.
 */
`;
      this.host.info(`MrubyBridgeCellPlugin: generate duplicate for cell '${this.cell.name}'`);
      return out;
    }
    this.state.cellList.add(this.cell);
    const ports = this.cell.celltype?.ports ?? [];
    const cellPath = absoluteName(this.cell.scope, this.cell.name);
    for (const [portName, optStr] of this.portList) {
      const port = ports.find((p) => p.name === portName);
      const signature = port?.signature;
      if (!port || !signature) continue;
      const context = signature.context ?? "task";
      if (context !== "task" && context !== "any") continue;
      if (port.kind !== "entry") continue;
      if (!this.state.signatureList.has(signature)) {
        const opt = `ignoreUnsigned=${this.options.ignoreUnsigned}, auto_exclude=${this.options.autoExclude}, ${optStr}`;
        out += `
/* cell.port=${this.cell.name}.${port.name} */
generate( MrubyBridgePlugin, ${signatureNamespacePath(signature)}, "${opt}" );
`;
        this.state.signatureList.add(signature);
      }
      // Region#gen_region_str_pre / gen_region_str_post
      const regions = this.cell.scope;
      regions.forEach((name, i) => { out += `${"  ".repeat(i)}region ${name}{\n`; });
      const nest = "  ".repeat(regions.length);
      out += `${nest}/* BridgeCell */
${nest}cell nMruby::t${globalName(signature.scope, signature.name)} ${this.cell.name}${port.name}Bridge {
${nest}    cTECS = ${cellPath}.${port.name};
${nest}};
`;
      for (let i = regions.length - 1; i >= 0; i -= 1) out += `${"  ".repeat(i)}};\n`;
    }
    return out;
  }
}

/** MrubyBridgeCelltypePlugin（MrubyBridgeCelltypePluginModule）。 */
export class CelltypePlugin implements PluginInstance {
  private readonly options: BridgeOptions = { ignoreUnsigned: false, autoExclude: true, excludePort: [], excludePortFunc: new Map() };
  private readonly excludeCells: string[] = [];

  constructor(private readonly celltype: CelltypeSymbol, option: string, private readonly state: MrubyBridgeState, private readonly host: PluginHost) {
    for (const [ident, rhs] of parsePluginArgs(option)) {
      if (ident === "include_inner_cell") continue; // 内側のセル（composite）は扱わない
      if (ident === "exclude_cell") {
        for (const name of rhs.split(",")) this.excludeCells.push(name.replace(/\s/g, ""));
        continue;
      }
      if (ident === "exclude_port") {
        // Ruby 版はここで @cell（未定義）を参照して失敗する。同じく失敗として扱う。
        throw new PluginError("MrubyBridgeCelltypePlugin: exclude_port は扱えません");
      }
      setBridgeOption(this.options, ident, rhs, celltype, host);
    }
  }

  genCdlFile(): string {
    return "";
  }

  newCell(cell: CellSymbol): void {
    if (this.host.program.isPostCoded) {
      this.host.info(`I9999 MrubyBridgeCelltypePlugin: ${cell.name} is excluded because cell generated after post_coded`);
      return;
    }
    if (this.excludeCells.includes(cell.name)) return;
    let optStr = `ignoreUnsigned=${this.options.ignoreUnsigned}, auto_exclude=${this.options.autoExclude}`;
    for (const port of this.options.excludePort) optStr += `,exclude_port=${port}`;
    for (const [port, funcs] of this.options.excludePortFunc) for (const func of funcs) optStr += `,exclude_port_func=${port}.${func}`;
    const fileName = `tmp_MrubyBridgeCelltypePluginModule_${this.celltype.name}_${this.state.celltypeModuleCount}.cdl`;
    const text = `/* MrubyBridgeCelltypePluginModule: celltype=${this.celltype.name} */
generate( MrubyBridgeCellPlugin, ${absoluteName(cell.scope, cell.name)}, "${optStr}" );
`;
    this.state.celltypeModuleCount += 1;
    this.host.writeAndParse(CELLTYPE_PLUGIN, fileName, text);
  }
}

/** `f(void)` は引数なし（tecsgen の ParamList も空になる）。 */
function realParameters(fn: SignatureFunctionDecl): readonly ParameterUse[] {
  const only = fn.parameters[0];
  if (fn.parameters.length === 1 && only && !only.name && only.type?.kind === "primitive" && only.type.name === "void") return [];
  return fn.parameters;
}

function directionOf(parameter: ParameterUse): string | undefined {
  for (const s of parameter.specifiers) {
    if (["in", "out", "inout", "send", "receive"].includes(s)) return s;
    const m = /^(send|receive)\(/.exec(s);
    if (m) return m[1];
  }
  return undefined;
}

function hasSpecifier(parameter: ParameterUse, pattern: RegExp): boolean {
  return parameter.specifiers.some((s) => pattern.test(s));
}
