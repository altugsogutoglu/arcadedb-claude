export function detectModule(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length === 1) return "root";
  if (parts[0] === "app" && parts.length >= 3 && /^[A-Z]/.test(parts[1]!)) {
    return parts[1]!;
  }
  return parts[0]!;
}
