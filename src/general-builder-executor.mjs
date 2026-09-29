#!/usr/local/bin/node
import fs from "node:fs";
import path from "node:path";

function validPath(value) {
  return typeof value === "string" && value.length > 0 && !path.isAbsolute(value) && !value.split("/").some((part) => !part || part === "." || part === "..") && !value.startsWith(".git/");
}
const input = JSON.parse(fs.readFileSync(0, "utf8"));
if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > 32) throw new Error("GENERAL_BUILDER_FILES_INVALID");
const root = fs.realpathSync(process.env.GENERAL_WORKSPACE_ROOT);
for (const item of input.files) {
  if (!item || Object.keys(item).sort().join(",") !== "content,path" || !validPath(item.path) || typeof item.content !== "string" || Buffer.byteLength(item.content) > 262144) throw new Error("GENERAL_BUILDER_FILE_INVALID");
  const destination = path.resolve(root, item.path);
  if (!destination.startsWith(root + path.sep)) throw new Error("GENERAL_BUILDER_PATH_ESCAPE");
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.writeFileSync(destination, item.content, { encoding: "utf8", mode: 0o644 });
  fs.chmodSync(destination, 0o644);
}
process.stdout.write(JSON.stringify({ written: input.files.map((item) => item.path) }));
