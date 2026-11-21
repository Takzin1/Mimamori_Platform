import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../src");

test("Core ships only domain, projection and repository interfaces", () => {
  const allowed = new Set(["core", "operations", "persistence", "index.ts"]);
  assert.deepEqual(readdirSync(root).sort(), [...allowed].sort());
  assert.deepEqual(readdirSync(join(root, "persistence")).sort(), ["index.ts", "types.ts"]);
  assert.deepEqual(readdirSync(join(root, "operations")).sort(), ["index.ts", "queue.ts", "sla.ts"]);
});

test("production exports must not include synthetic stores or service configuration", () => {
  const paths = ["index.ts", "persistence/index.ts", "operations/index.ts"];
  for (const path of paths) {
    const content = readFileSync(join(root, path), "utf8");
    for (const forbidden of ["in-memory", "policy-directory", "postgrest", "react", "http", "session"]) {
      assert.equal(content.includes(forbidden), false, `${path} exports ${forbidden}`);
    }
  }
});

test("pure Core must not depend on CareOps runtime or external services", () => {
  const inspect = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { inspect(path); continue; }
      if (!entry.name.endsWith(".ts")) continue;
      const content = readFileSync(path, "utf8");
      assert.doesNotMatch(content, /from\s+["\u0027](?:node:)?(?:react|next|express|@supabase|openai|aws-sdk)/i);
      assert.doesNotMatch(content, /\b(?:fetch\(|localStorage\.|process\.env\b)/);
    }
  };
  inspect(root);
});
