import type { CdeclResult } from "./extractor";
import type { CType, CStructDef } from "./types";

export interface TypeDefinition {
  readonly name: string;
  readonly type: CType;
  readonly origin: string;
  readonly fallback: boolean;
}

export interface TypeResolution {
  readonly type?: CType;
  readonly origins: readonly string[];
  readonly fallback: boolean;
  readonly reason?: string;
}

interface RegistryEntry {
  readonly type: CType;
  readonly origins: Set<string>;
  fallback: boolean;
  conflict: boolean;
}

/** Merge all C declarations before resolving any signature, so import order cannot select a type. */
export class CTypeRegistry {
  private readonly typedefs = new Map<string, RegistryEntry>();
  private readonly structs = new Map<string, RegistryEntry>();

  constructor(results: ReadonlyMap<string, CdeclResult> = new Map(), localTypedefs: readonly TypeDefinition[] = []) {
    for (const [path, result] of results) {
      for (const [name, type] of result.typedefs) this.add(this.typedefs, name, type, path, result.usedFallback);
      for (const [name, def] of result.structs) {
        this.add(this.structs, name, { kind: "struct", tag: name, members: def.members }, path, result.usedFallback);
      }
    }
    for (const def of localTypedefs) this.add(this.typedefs, def.name, def.type, def.origin, def.fallback);
  }

  private add(table: Map<string, RegistryEntry>, name: string, type: CType, origin: string, fallback: boolean): void {
    const existing = table.get(name);
    if (!existing) {
      table.set(name, { type, origins: new Set([origin]), fallback, conflict: false });
      return;
    }
    existing.origins.add(origin);
    existing.fallback ||= fallback;
    if (JSON.stringify(existing.type) !== JSON.stringify(type)) existing.conflict = true;
  }

  resolve(type: CType): TypeResolution {
    return this.expand(type, new Set(), new Set());
  }

  private expand(type: CType, aliases: Set<string>, structTags: Set<string>): TypeResolution {
    switch (type.kind) {
      case "primitive": return { type, origins: [], fallback: false };
      case "unsupported": return { origins: [], fallback: false, reason: `未対応の C 型 ${type.name}` };
      case "defined": {
        const entry = this.typedefs.get(type.name);
        if (!entry) return { origins: [], fallback: false, reason: `未定義の C 型 ${type.name}` };
        const origins = [...entry.origins].sort();
        if (entry.conflict) return { origins, fallback: entry.fallback, reason: `C 型 ${type.name} の定義が競合しています: ${origins.join(", ")}` };
        if (aliases.has(type.name)) return { origins, fallback: entry.fallback, reason: `typedef ${type.name} が循環しています` };
        const next = new Set(aliases);
        next.add(type.name);
        const expanded = this.expand(entry.type, next, structTags);
        return { ...expanded, origins: [...new Set([...origins, ...expanded.origins])].sort(), fallback: entry.fallback || expanded.fallback };
      }
      case "pointer": {
        const nested = this.expand(type.pointee, aliases, structTags);
        return nested.type ? { ...nested, type: { kind: "pointer", pointee: nested.type } } : nested;
      }
      case "array": {
        const nested = this.expand(type.element, aliases, structTags);
        return nested.type ? { ...nested, type: { kind: "array", element: nested.type, size: type.size } } : nested;
      }
      case "function": {
        const returns = this.expand(type.returns, aliases, structTags);
        if (!returns.type) return returns;
        const parameters = (type.parameters ?? []).map((parameter) => this.expand(parameter, aliases, structTags));
        const failed = parameters.find((parameter) => !parameter.type);
        if (failed) return failed;
        return {
          type: { kind: "function", returns: returns.type, parameters: parameters.map((parameter) => parameter.type!) },
          origins: [...new Set([...returns.origins, ...parameters.flatMap((parameter) => parameter.origins)])].sort(),
          fallback: returns.fallback || parameters.some((parameter) => parameter.fallback),
        };
      }
      case "struct": {
        const entry = type.tag ? this.structs.get(type.tag) : undefined;
        if (entry?.conflict) {
          const origins = [...entry.origins].sort();
          return { origins, fallback: entry.fallback, reason: `struct ${type.tag} の定義が競合しています: ${origins.join(", ")}` };
        }
        const members = type.members ?? (entry?.type.kind === "struct" ? entry.type.members : undefined);
        if (!members) return { origins: entry ? [...entry.origins].sort() : [], fallback: entry?.fallback ?? false, reason: `未定義の struct ${type.tag ?? "(無名)"}` };
        if (type.tag && structTags.has(type.tag)) return { type: { kind: "struct", tag: type.tag }, origins: [], fallback: false };
        const nextTags = new Set(structTags);
        if (type.tag) nextTags.add(type.tag);
        const resolvedMembers: CStructDef["members"][number][] = [];
        const origins = new Set(entry?.origins ?? []);
        let fallback = entry?.fallback ?? false;
        for (const member of members) {
          const nested = this.expand(member.type, aliases, nextTags);
          if (!nested.type) return { origins: [...new Set([...origins, ...nested.origins])].sort(), fallback: fallback || nested.fallback, reason: nested.reason };
          resolvedMembers.push({ name: member.name, type: nested.type });
          nested.origins.forEach((origin) => origins.add(origin));
          fallback ||= nested.fallback;
        }
        return { type: { kind: "struct", tag: type.tag, members: resolvedMembers }, origins: [...origins].sort(), fallback };
      }
    }
  }
}
