/** Compact-mode Tab quick send: skip memory I/O, keep auth + credits + chat history. */
export function isQuickChatRequest(msg: any): boolean {
  return msg?.skipMemoryIngestion === true || msg?.context?.quickResponse === true;
}
