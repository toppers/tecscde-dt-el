/** A binding inside an internal cell of a composite celltype. */
export interface CompositeInternalBinding {
  readonly kind: "join" | "external";
  readonly name: string;
  readonly target: string;
  readonly rawText: string;
}

export interface CompositeInternalCell {
  readonly celltypeName: string;
  readonly name: string;
  readonly bindings: readonly CompositeInternalBinding[];
  readonly rawText: string;
}

export interface CompositePortExport {
  readonly externalPortName: string;
  readonly cellName: string;
  readonly portName: string;
  readonly rawText: string;
}

/** Internal CDL retained for round trips; these cells are not diagram cells. */
export interface CompositeStructure {
  readonly internalCells: readonly CompositeInternalCell[];
  readonly portExports: readonly CompositePortExport[];
  readonly rawText: string;
}
