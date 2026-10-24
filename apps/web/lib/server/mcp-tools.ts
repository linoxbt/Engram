/** Tool descriptions are prompts: agents decide when to call a tool from these words. */
export const REMEMBER_DESCRIPTION = `Save a durable memory that will matter in later conversations: a fact about a person or thing, a preference, an event, or an observation. Write one clear self-contained sentence. Include a subject like "customer:ada" or "project:apollo" when there is one. Do not save secrets, passwords or one-off chit-chat. Engram detects duplicates and contradictions automatically and tells you what it found.`;

export const RECALL_DESCRIPTION = `Find memories relevant to a question. Results include who wrote each memory, when, whether it is still valid, and whether it conflicts with another memory. Pass asOf (ISO time) to see what was known at a past moment. Prefer memories marked valid; mention conflicts to the user.`;

export const FORGET_DESCRIPTION = `Permanently erase a memory's content, for example when a user asks to be forgotten or a memory is wrong and harmful. The erasure is recorded; the content cannot be recovered. Do not repeat the erased content in the reason.`;

export const TIMELINE_DESCRIPTION = `List every memory about one subject in the order it was written, including superseded and forgotten ones, so you can see how knowledge about it changed.`;

export const VERIFY_DESCRIPTION = `Check that memory has not been altered. Without an id, checks the whole space and returns its integrity status. With an id, returns a cryptographic proof that this memory is part of the latest signed checkpoint.`;

export const RESOLVE_DESCRIPTION = `Settle a conflict between two memories by choosing which one is correct. Use only when the user or a reliable source confirms the answer.`;
