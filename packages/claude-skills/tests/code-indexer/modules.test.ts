import { describe, it, expect } from "vitest";
import { detectModule } from "../../src/code-indexer/modules.js";

describe("detectModule", () => {
  it("groups Next.js app dir files under the 'app' module", () => {
    expect(detectModule("app/page.tsx")).toBe("app");
    expect(detectModule("app/api/users/route.ts")).toBe("app");
  });

  it("groups components/* under 'components'", () => {
    expect(detectModule("components/Button.tsx")).toBe("components");
  });

  it("groups lib/* under 'lib'", () => {
    expect(detectModule("lib/db.ts")).toBe("lib");
    expect(detectModule("lib/validate.ts")).toBe("lib");
  });

  it("groups Laravel app/Http/* under 'Http'", () => {
    expect(detectModule("app/Http/Controllers/UserController.php")).toBe("Http");
  });

  it("groups Laravel app/Models/* under 'Models'", () => {
    expect(detectModule("app/Models/User.php")).toBe("Models");
  });

  it("groups Laravel app/Services/* under 'Services'", () => {
    expect(detectModule("app/Services/AuthService.php")).toBe("Services");
  });

  it("returns 'root' for files at the top level", () => {
    expect(detectModule("README.md")).toBe("root");
    expect(detectModule("vite.config.ts")).toBe("root");
  });
});
