import type { ConversationPersistenceApi } from "@deepwrite/contracts";
import type { ConversationPersistenceAdapter } from "../stores/conversationStore";

const HISTORY_PREFIX = "conversation-history:";
const MAX_PERSISTENCE_KEY_LENGTH = 240;
const HASH_OFFSET = 0xcbf29ce484222325n;
const HASH_PRIME = 0x100000001b3n;
const HASH_MASK = 0xffffffffffffffffn;

function stableKeyHash(value: string): string {
  let hash = HASH_OFFSET;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * HASH_PRIME) & HASH_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Converts an in-memory conversation identity into a contract-safe key.
 * Long filesystem-derived identities retain a readable prefix plus a stable
 * suffix, while ordinary keys remain fully reversible in diagnostics.
 */
export function conversationHistoryPersistenceKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) throw new Error("会话 key 不能为空。");
  const encoded = encodeURIComponent(normalized);
  const direct = `${HISTORY_PREFIX}${encoded}`;
  if (direct.length <= MAX_PERSISTENCE_KEY_LENGTH) return direct;

  const hash = stableKeyHash(normalized);
  const suffix = `~${hash}`;
  const prefixLength =
    MAX_PERSISTENCE_KEY_LENGTH - HISTORY_PREFIX.length - suffix.length;
  return `${HISTORY_PREFIX}${encoded.slice(0, prefixLength)}${suffix}`;
}

export function createConversationPersistenceAdapter(
  api: ConversationPersistenceApi | undefined
): ConversationPersistenceAdapter | null {
  if (!api) return null;
  return {
    load: (key) => api.load(key),
    save: (key, value) => api.save(key, value),
    remove: (key) => api.remove(key)
  };
}
