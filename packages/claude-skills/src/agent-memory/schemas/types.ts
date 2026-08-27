export type PropertyType = "STRING" | "INTEGER" | "LONG" | "FLOAT" | "DOUBLE" | "BOOLEAN" | "DATETIME";

export interface PropertyDef {
  name: string;
  type: PropertyType;
  primaryKey?: boolean;
  notNull?: boolean;
}

export interface VertexTypeDef {
  name: string;
  properties?: PropertyDef[];
}

export interface EdgeTypeDef {
  name: string;
  properties?: PropertyDef[];
}

export interface Schema {
  name: string;
  vertices: VertexTypeDef[];
  edges: EdgeTypeDef[];
}
