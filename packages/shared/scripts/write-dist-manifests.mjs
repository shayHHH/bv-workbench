// 为双格式产物写入各自的 package.json 标记：
// 包根未声明 "type"，dist/esm 需要 {"type":"module"} 才能被 Node/工具按 ESM 解析。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist/cjs"), { recursive: true });
mkdirSync(join(root, "dist/esm"), { recursive: true });
writeFileSync(join(root, "dist/cjs/package.json"), JSON.stringify({ type: "commonjs" }) + "\n");
writeFileSync(join(root, "dist/esm/package.json"), JSON.stringify({ type: "module" }) + "\n");
