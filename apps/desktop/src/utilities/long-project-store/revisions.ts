import { TextDecoder } from "node:util";
import type { LongFileRevision } from "@deepwrite/contracts";
import { projectTransactionContentSha256 } from "../project-transaction";
import type { SecureTextFile } from "./types";

export function encodeUtf8Strict(content: string): Buffer {
  const bytes = Buffer.from(content, "utf8");
  if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== content) {
    throw new Error("长篇文件内容包含无效 Unicode 字符。");
  }
  return bytes;
}

export function createLongFileRevision(
  content: string | Uint8Array
): LongFileRevision {
  const bytes =
    typeof content === "string"
      ? encodeUtf8Strict(content)
      : Buffer.from(content);
  const hash = projectTransactionContentSha256(bytes);
  return `v2:${bytes.byteLength}:${hash}` as LongFileRevision;
}

export function longRevisionMatchesBytes(
  revision: LongFileRevision,
  content: string | Uint8Array
): boolean {
  const bytes =
    typeof content === "string"
      ? encodeUtf8Strict(content)
      : Buffer.from(content);
  const match = /^(v1|v2):(\d+):([0-9a-f]+)$/u.exec(revision);
  if (!match || Number(match[2]) !== bytes.byteLength) return false;
  const sha256 = projectTransactionContentSha256(bytes);
  return match[1] === "v1" ? sha256.startsWith(match[3]!) : sha256 === match[3];
}

export function longRevisionsMatchContent(
  left: LongFileRevision,
  right: LongFileRevision,
  content: string | Uint8Array
): boolean {
  return (
    longRevisionMatchesBytes(left, content) &&
    longRevisionMatchesBytes(right, content)
  );
}

export function longRevisionMatchesSecureTextFile(
  revision: LongFileRevision,
  disk: SecureTextFile
): boolean {
  const match = /^(v1|v2):(\d+):([0-9a-f]+)$/u.exec(revision);
  if (!match || Number(match[2]) !== disk.size) return false;
  return match[1] === "v1"
    ? disk.sha256.startsWith(match[3]!)
    : disk.sha256 === match[3];
}
