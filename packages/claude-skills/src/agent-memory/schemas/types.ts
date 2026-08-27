export type PropertyType = "STRING" | "INTEGER" | "LONG" | "FLOAT" | "DOUBLE" | "BOOLEAN" | "DATETIME" | "ARRAY_OF_FLOATS";

export interface VectorIndexDef {
  dimensions: number;
  similarity: "COSINE" | "EUCLIDEAN" | "DOT_PRODUCT";
}

export interface PropertyDef {
  name: string;
  type: PropertyType;
  primaryKey?: boolean;
  notNull?: boolean;
  vectorIndex?: VectorIndexDef;
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
