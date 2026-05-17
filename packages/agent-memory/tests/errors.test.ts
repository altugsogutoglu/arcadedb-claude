import { describe, it, expect } from "vitest";
import {
  ArcadeDBConnectionError,
  DatabaseNotFoundError,
  SchemaMismatchError,
} from "../src/errors.js";

describe("error classes", () => {
  it("ArcadeDBConnectionError carries the URI", () => {
    const err = new ArcadeDBConnectionError("http://localhost:2480", new Error("ECONNREFUSED"));
    expect(err.message).toContain("http://localhost:2480");
    expect(err.uri).toBe("http://localhost:2480");
    expect(err.cause).toBeInstanceOf(Error);
    expect(err.name).toBe("ArcadeDBConnectionError");
  });

  it("DatabaseNotFoundError carries the db name", () => {
    const err = new DatabaseNotFoundError("nope");
    expect(err.message).toContain("nope");
    expect(err.database).toBe("nope");
    expect(err.name).toBe("DatabaseNotFoundError");
  });

  it("SchemaMismatchError carries the type name", () => {
    const err = new SchemaMismatchError("Decision");
    expect(err.message).toContain("Decision");
    expect(err.typeName).toBe("Decision");
    expect(err.name).toBe("SchemaMismatchError");
  });
});
