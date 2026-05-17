export function validateUser(input: unknown): void {
  if (!input) throw new Error("invalid");
}
