const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = new Set(["clientUuid", "messages", "stream"]);

export function validateLegacyChat(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !FIELDS.has(key)) || !UUID.test(value.clientUuid ?? "") || (value.stream != null && typeof value.stream !== "boolean") || !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 10) throw new Error("invalid chat request");
  let total = 0;
  const messages = value.messages.map((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message) || Object.keys(message).some((key) => !["role", "content"].includes(key)) || !["user", "assistant"].includes(message.role) || typeof message.content !== "string") throw new Error("invalid chat request");
    const content = message.content.trim();
    if (!content || content.length > 2_000) throw new Error("invalid chat request");
    total += content.length;
    return { role: message.role, content };
  });
  if (total > 12_000 || messages.at(-1).role !== "user") throw new Error("invalid chat request");
  return { clientUuid: value.clientUuid, messages, stream: value.stream === true };
}
