import type { TypeResolution } from "../cdecl/type-registry";

export interface ResolvedFunctionType {
  readonly name: string;
  readonly returns: TypeResolution;
  readonly parameters: readonly TypeResolution[];
}

export interface ResolvedSignatureType {
  readonly id: string;
  readonly functions: readonly ResolvedFunctionType[];
  readonly valid: boolean;
}

export interface ResolvedPortType {
  readonly signatureId?: string;
  readonly valid: boolean;
}

export interface PortTypeIndex {
  readonly signatures: ReadonlyMap<string, ResolvedSignatureType>;
  /** Key: celltype name, direction (`call` / `entry`), port name. */
  readonly ports: ReadonlyMap<string, ResolvedPortType>;
}

export function portTypeKey(celltype: string, direction: "call" | "entry", name: string): string {
  return `${celltype}\0${direction}\0${name}`;
}

export const emptyPortTypeIndex = (): PortTypeIndex => ({ signatures: new Map(), ports: new Map() });
