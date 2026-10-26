import { assertJson } from "../json.js";
import type { Batch, Json } from "../types.js";

export function parseEditor(
  text: string,
  authorText: string,
): { operations: Batch; authorInputs?: Json } {
  const operations: unknown = JSON.parse(text);
  assertJson(operations);
  const object = (value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  if (
    !(
      object(operations) ||
      (Array.isArray(operations) &&
        operations.length > 0 &&
        operations.every(object))
    )
  ) {
    throw new Error("操作必须是 JSON 对象，或非空对象数组。");
  }
  const authorInputs: unknown = authorText.trim()
    ? JSON.parse(authorText)
    : undefined;
  if (authorInputs !== undefined) assertJson(authorInputs);
  return {
    operations: operations as Batch,
    authorInputs: authorInputs as Json | undefined,
  };
}

export interface PreviewTicket {
  input: string;
  author: string;
  head: string;
  actionId: string;
}
export function isPreviewCurrent(
  ticket: PreviewTicket | undefined,
  input: string,
  author: string,
  head: string | undefined,
): boolean {
  return (
    !!ticket &&
    ticket.input === input &&
    ticket.author === author &&
    ticket.head === head
  );
}
