import assert from "node:assert/strict";
import test from "node:test";
import { BoundedTtlCache, RequestCoalescer } from "../../src/remoteCache";
import {
  canonicalObjectPath,
  classifyPreconditionFailure,
  invalidateKeys,
  isEditorMetadataPath,
  normalizeEtag,
  verbDefinitionPaths,
} from "../../src/remoteFileSystemLogic";

test("normalizes WebDAV ETags for conditional requests", () => {
  assert.equal(normalizeEtag("content-hash"), '"content-hash"');
  assert.equal(normalizeEtag('"content-hash"'), '"content-hash"');
  assert.equal(normalizeEtag("W/content-hash"), 'W/"content-hash"');
  assert.equal(normalizeEtag('W/"content-hash"'), 'W/"content-hash"');
  assert.equal(normalizeEtag(null), undefined);
});

test("caches values until expiry and retains expired values for revalidation", () => {
  let now = 100;
  const cache = new BoundedTtlCache<string, string>({ maxEntries: 2, now: () => now });
  assert.equal(cache.set("file", "contents", 10), true);
  assert.equal(cache.getFresh("file"), "contents");
  now = 110;
  assert.equal(cache.getFresh("file"), undefined);
  assert.equal(cache.peek("file"), "contents");
  assert.equal(cache.set("disabled", "value", 0), false);
  assert.equal(cache.peek("disabled"), undefined);
});

test("evicts least-recently-used and overweight cache entries", () => {
  const cache = new BoundedTtlCache<string, string>({
    maxEntries: 2,
    maxWeight: 5,
    weight: (value) => value.length,
  });
  cache.set("a", "aa", 1000);
  cache.set("b", "bb", 1000);
  assert.equal(cache.getFresh("a"), "aa");
  cache.set("c", "cc", 1000);
  assert.equal(cache.peek("b"), undefined);
  assert.equal(cache.set("large", "123456", 1000), false);
  assert.equal(cache.peek("large"), undefined);
});

test("coalesces concurrent requests and retries failures", async () => {
  const coalescer = new RequestCoalescer();
  let calls = 0;
  let resolveRequest: ((value: string) => void) | undefined;
  const operation = () => {
    calls += 1;
    return new Promise<string>((resolve) => {
      resolveRequest = resolve;
    });
  };
  const first = coalescer.run("same", operation);
  const second = coalescer.run("same", operation);
  assert.equal(calls, 1);
  resolveRequest?.("done");
  assert.deepEqual(await Promise.all([first, second]), ["done", "done"]);

  await assert.rejects(coalescer.run("failure", async () => {
    calls += 1;
    throw new Error("failed");
  }), /failed/);
  assert.equal(await coalescer.run("failure", async () => {
    calls += 1;
    return "retried";
  }), "retried");
  assert.equal(calls, 3);
});

test("detaches invalidated in-flight requests without cancelling their callers", async () => {
  const coalescer = new RequestCoalescer();
  let resolveOld: ((value: string) => void) | undefined;
  const oldRequest = coalescer.run("file\nserver\n/path", () => new Promise<string>((resolve) => {
    resolveOld = resolve;
  }));
  coalescer.deleteWhere((key) => key.includes("\nserver\n"));
  const newRequest = coalescer.run("file\nserver\n/path", async () => "new");
  assert.equal(await newRequest, "new");
  resolveOld?.("old");
  assert.equal(await oldRequest, "old");
});

test("identifies local workspace metadata paths", () => {
  assert.equal(isEditorMetadataPath("/.vscode"), true);
  assert.equal(isEditorMetadataPath("/.vscode/tasks.json"), true);
  assert.equal(isEditorMetadataPath("/.vscode/settings.json"), true);
  assert.equal(isEditorMetadataPath("/.agents/skills"), true);
  assert.equal(isEditorMetadataPath("/.claude/agents"), true);
  assert.equal(isEditorMetadataPath("/.claude/settings.json"), true);
  assert.equal(isEditorMetadataPath("/.devcontainer"), true);
  assert.equal(isEditorMetadataPath("/.devcontainer.json"), true);
  assert.equal(isEditorMetadataPath("/.git/config"), true);
  assert.equal(isEditorMetadataPath("/.github/copilot/settings.json"), true);
  assert.equal(isEditorMetadataPath("/.mcp.json"), true);
  assert.equal(isEditorMetadataPath("/app/src/main/AndroidManifest.xml"), true);
  assert.equal(isEditorMetadataPath("/node_modules"), true);
  assert.equal(isEditorMetadataPath("/pom.xml"), true);
  assert.equal(isEditorMetadataPath("/object/454/verb/.vscode"), false);
  assert.equal(isEditorMetadataPath("/object/454/verb/look"), false);
  assert.equal(isEditorMetadataPath("/.vscode-backup/tasks.json"), false);
});

test("canonicalizes paths opened through the owned-object collection", () => {
  assert.equal(
    canonicalObjectPath("/owned/454/verb/check_authorization"),
    "/object/454/verb/check_authorization",
  );
  assert.equal(canonicalObjectPath("/owned/-1/property/name/string"), "/object/-1/property/name/string");
  assert.equal(canonicalObjectPath("/owned"), undefined);
  assert.equal(canonicalObjectPath("/object/454/verb/check_authorization"), undefined);
});

test("classifies stale ETag writes as remote changes", () => {
  assert.equal(classifyPreconditionFailure({
    kind: "write",
    exists: true,
    overwrite: true,
    etag: '"old-etag"',
  }), "remoteChanged");
});

test("classifies create and destination conflicts as existing files", () => {
  assert.equal(classifyPreconditionFailure({
    kind: "write",
    exists: false,
    overwrite: false,
  }), "fileExists");
  assert.equal(classifyPreconditionFailure({
    kind: "destination",
    overwrite: false,
  }), "fileExists");
});

test("leaves other precondition failures unclassified", () => {
  assert.equal(classifyPreconditionFailure({
    kind: "destination",
    overwrite: true,
  }), "preconditionFailed");
});

test("invalidates only the requested ETag keys", () => {
  const etags = new Map([
    ["source", '"source-etag"'],
    ["destination", '"destination-etag"'],
    ["unaffected", '"unaffected-etag"'],
  ]);
  invalidateKeys(etags, "source", "destination");
  assert.deepEqual([...etags], [["unaffected", '"unaffected-etag"']]);

  etags.set("source", '"source-etag"');
  etags.set("destination", '"destination-etag"');
  invalidateKeys(etags, "destination");
  assert.equal(etags.get("source"), '"source-etag"');
  assert.equal(etags.has("destination"), false);
});

test("builds inherited verb resolution paths after property traversal", () => {
  assert.deepEqual(
    verbDefinitionPaths("/object/0/property/local/object/property/webdav/object/verb/name"),
    {
      verbName: "name",
      resolutionPath: "/object/0/property/local/object/property/webdav/object/resolve/verb/name/defined-on",
    },
  );
  assert.deepEqual(verbDefinitionPaths("/object/494/verb/read_bytes"), {
    verbName: "read_bytes",
    resolutionPath: "/object/494/resolve/verb/read_bytes/defined-on",
  });
  assert.equal(verbDefinitionPaths("/object/0/property/local"), undefined);
});
