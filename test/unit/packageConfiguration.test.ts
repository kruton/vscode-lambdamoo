import * as assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

test("disables color decorators for LambdaMOO documents", async () => {
  const packageJson = JSON.parse(
    await readFile(join(process.cwd(), "package.json"), "utf8"),
  ) as {
    contributes?: {
      configurationDefaults?: Record<string, Record<string, unknown>>;
    };
  };

  assert.equal(
    packageJson.contributes?.configurationDefaults?.["[lambdamoo]"]?.[
      "editor.colorDecorators"
    ],
    false,
  );
});
