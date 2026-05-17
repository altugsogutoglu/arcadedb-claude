export class ArcadeDBConnectionError extends Error {
  constructor(public uri: string, public override cause?: unknown) {
    super(`Could not reach ArcadeDB at ${uri}. Is the container running? Try \`docker ps\`.`);
    this.name = "ArcadeDBConnectionError";
  }
}

export class DatabaseNotFoundError extends Error {
  constructor(public database: string) {
    super(`Database "${database}" does not exist. Run \`arcadedb-memory migrate ${database}\` to create it.`);
    this.name = "DatabaseNotFoundError";
  }
}

export class SchemaMismatchError extends Error {
  constructor(public typeName: string) {
    super(`Vertex/edge type "${typeName}" is not defined in this database. Run a migration with --auto-migrate, or apply the schema first.`);
    this.name = "SchemaMismatchError";
  }
}
