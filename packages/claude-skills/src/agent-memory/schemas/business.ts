import type { Schema } from "./types.js";

export const businessSchema: Schema = {
  name: "business",
  vertices: [
    { name: "Store",    properties: [{ name: "name", type: "STRING", primaryKey: true, notNull: true }] },
    { name: "Product",  properties: [
        { name: "sku", type: "STRING", primaryKey: true, notNull: true },
        { name: "name", type: "STRING" },
        { name: "priceIncVat", type: "FLOAT" },
      ] },
    { name: "Category", properties: [{ name: "name", type: "STRING", primaryKey: true, notNull: true }] },
    { name: "Order",    properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "placedAt", type: "DATETIME" },
      ] },
    { name: "Customer", properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "email", type: "STRING" },
      ] },
    { name: "Concept",  properties: [{ name: "name", type: "STRING", primaryKey: true, notNull: true }] },
  ],
  edges: [
    { name: "SELLS" },
    { name: "BELONGS_TO" },
    { name: "PLACED" },
    { name: "CONTAINS_PRODUCT" },
  ],
};
