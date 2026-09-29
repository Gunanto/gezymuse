/**
 * OpenAI Chat Completions (`/v1/chat/completions`) wire-format helpers —
 * request/response transform, the SSE delta stream parser, and the
 * OpenAI-internal tool-call/content parsing they share. The Responses
 * API (`/v1/responses`) counterpart lives in provider-openai-responses.ts
 * — its native event shape is materially different from this legacy
 * delta stream.
 */

import {
  ModelProviderError,
  parseModelName,
  type ModelEvent,
  type ModelMessage,
  type ModelRequest,
  type ModelResponse,
  type ModelToolCall
} from "./index.js";
import {
  createLeadingThinkStripper,
  isRecord,
  parseJson,
  sanitizeToolCallName,
  stripLeadingThinkBlock
} from "./provider-shared.js";
import { parseOpenAIToolCalls, parseOpenAIUsage, parseToolArguments, readOpenAIContent } from "./provider-openai-parse.js";

const OPENAI_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/u;

export interface OpenAIToolNameCodec {
  readonly fromWire: (name: string) => string;
  readonly toWire: (name: string) => string;
}

/**
 * OpenAI-compatible gateways commonly enforce the function-name grammar
 * `[a-zA-Z0-9_-]{1,64}`. Muse intentionally uses dotted names such as
 * `muse.tasks`, so translate only the incompatible names at this provider
 * boundary and keep a request-local reverse map for returned tool calls.
 */
export function createOpenAIToolNameCodec(request: Pick<ModelRequest, "messages" | "tools">): OpenAIToolNameCodec {
  const names = new Set<string>();
  for (const tool of request.tools ?? []) names.add(tool.name);
  for (const message of request.messages) {
    for (const toolCall of message.toolCalls ?? []) names.add(toolCall.name);
  }

  const originalToWire = new Map<string, string>();
  const wireToOriginal = new Map<string, string>();

  // Reserve valid names first so an alias can never shadow a real tool.
  for (const name of names) {
    if (OPENAI_TOOL_NAME.test(name)) {
      originalToWire.set(name, name);
      wireToOriginal.set(name, name);
    }
  }

  for (const name of names) {
    if (originalToWire.has(name)) continue;

    const readable = name.replace(/[^a-zA-Z0-9_-]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 36) || "tool";
    const base = `muse_tool_${readable}_${fnv1a64(name)}`;
    let wireName = base;
    let attempt = 2;
    while (wireToOriginal.has(wireName)) {
      const suffix = `_${attempt}`;
      wireName = `${base.slice(0, 64 - suffix.length)}${suffix}`;
      attempt += 1;
    }

    originalToWire.set(name, wireName);
    wireToOriginal.set(wireName, name);
  }

  return {
    fromWire: (name) => wireToOriginal.get(name) ?? name,
    toWire: (name) => originalToWire.get(name) ?? name
  };
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function toOpenAIChatRequest(
  request: ModelRequest,
  defaultModel: string | undefined,
  toWireToolName: (name: string) => string = (name) => name
) {
  const modelId = parseModelName(request.model || defaultModel || "").modelId;
  return {
    max_tokens: request.maxOutputTokens,
    messages: request.messages.map((message) => toOpenAIMessage(message, toWireToolName)),
    model: modelId,
    temperature: request.temperature,
    tools: request.tools?.map((tool) => ({
      function: {
        description: tool.description,
        name: toWireToolName(tool.name),
        parameters: tool.inputSchema
      },
      type: "function"
    })),
    // Qwen3 emits chain-of-thought by default. The native Ollama
    // path kills it with `think:false`; on OpenAI-compatible
    // backends (vLLM / SGLang / LM Studio / OpenRouter) the
    // portable switch is the chat-template kwarg. Gated to qwen3
    // model ids so a strict server (real OpenAI/Azure) never sees
    // an unknown body key for non-Qwen models.
    ...(/qwen3/iu.test(modelId)
      ? { chat_template_kwargs: { enable_thinking: false } }
      : {})
  };
}

function toOpenAIMessage(message: ModelMessage, toWireToolName: (name: string) => string) {
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      content: message.content,
      role: message.role,
      tool_calls: message.toolCalls.map((toolCall) => ({
        function: {
          arguments: JSON.stringify(toolCall.arguments),
          name: toWireToolName(toolCall.name)
        },
        id: toolCall.id,
        type: "function"
      }))
    };
  }

  if (message.role === "tool") {
    return {
      content: message.content,
      role: message.role,
      tool_call_id: message.toolCallId
    };
  }

  // Vision-capable provider: user message can carry multipart
  // content with image parts. OpenAI Chat Completions accepts
  // `{ type: "image_url", image_url: { url } }` for hosted refs
  // and `{ type: "image_url", image_url: { url: "data:<mime>;base64,<b64>" } }`
  // for inline bytes. Build the multipart array only when at least
  // one attachment is present; otherwise keep the simple string
  // content shape so unaffected calls aren't rewritten.
  if (message.role === "user" && message.attachments && message.attachments.length > 0) {
    const parts: Array<Record<string, unknown>> = [];
    if (message.content && message.content.length > 0) {
      parts.push({ text: message.content, type: "text" });
    }
    for (const attachment of message.attachments) {
      const url = attachment.url
        ?? (attachment.dataBase64 ? `data:${attachment.mimeType};base64,${attachment.dataBase64}` : undefined);
      if (!url) continue;
      parts.push({ image_url: { url }, type: "image_url" });
    }
    return {
      content: parts,
      name: message.name,
      role: message.role
    };
  }

  return {
    content: message.content,
    name: message.name,
    role: message.role
  };
}

export function fromOpenAIChatResponse(
  providerId: string,
  requestedModel: string,
  payload: unknown,
  fromWireToolName: (name: string) => string = (name) => name
): ModelResponse {
  if (!isRecord(payload)) {
    throw new ModelProviderError(providerId, "OpenAI-compatible response was not an object");
  }

  const choice = Array.isArray(payload.choices) && isRecord(payload.choices[0]) ? payload.choices[0] : undefined;
  const message = isRecord(choice?.message) ? choice.message : undefined;
  const output = stripLeadingThinkBlock(readOpenAIContent(message?.content));

  return {
    id: typeof payload.id === "string" ? payload.id : `${providerId}-response`,
    model: typeof payload.model === "string" ? payload.model : requestedModel,
    output,
    raw: payload,
    toolCalls: parseOpenAIToolCalls(message?.tool_calls, fromWireToolName),
    usage: parseOpenAIUsage(payload.usage)
  };
}

export async function* parseOpenAIStream(
  providerId: string,
  requestedModel: string,
  body: ReadableStream<Uint8Array>,
  fromWireToolName: (name: string) => string = (name) => name
): AsyncIterable<ModelEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const stripThink = createLeadingThinkStripper();
  let buffer = "";
  let output = "";
  let responseId = `${providerId}-stream`;
  let model = requestedModel;
  const streamedToolCalls = new Map<number, MutableOpenAIStreamToolCall>();
  let errored = false;

  async function* handleEvent(event: string): AsyncGenerator<ModelEvent> {
    const data = readSseData(event);

    if (!data || data === "[DONE]") {
      return;
    }

    const parsed = parseJson(data);

    if (!isRecord(parsed)) {
      return;
    }

    // A streaming error chunk (`{"error": {...}}`) emitted after the
    // 200 — OpenRouter / vLLM / OpenAI surface mid-generation failures
    // this way — would otherwise be read as a delta-less chunk and
    // silently dropped, ending the stream with a truncated/empty
    // answer and no error. Surface it and stop (mirrors the native
    // Ollama stream's mid-stream error handling).
    const streamError = readOpenAIStreamError(parsed);
    if (streamError !== undefined) {
      yield { error: new ModelProviderError(providerId, streamError, true), type: "error" };
      errored = true;
      return;
    }

    responseId = typeof parsed.id === "string" ? parsed.id : responseId;
    model = typeof parsed.model === "string" ? parsed.model : model;

    const delta = readOpenAIStreamDelta(parsed);

    if (delta.length > 0) {
      output += delta;
      const emit = stripThink(delta);
      if (emit.length > 0) {
        yield { text: emit, type: "text-delta" };
      }
    }

    for (const toolCall of readOpenAIStreamToolCallDeltas(parsed)) {
      mergeOpenAIStreamToolCall(streamedToolCalls, toolCall);
    }
  }

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n/u);
    buffer = events.pop() ?? "";

    for (const event of events) {
      yield* handleEvent(event);
      if (errored) return;
    }
  }

  // A compliant server ends with `[DONE]\n\n`, but OpenAI-compatible local
  // backends (LM Studio, llama.cpp, …) may close the stream right after the
  // last event with no trailing blank line. Flush the decoder and process
  // the remaining buffer so that final delta / tool-call isn't dropped.
  buffer += decoder.decode();
  if (buffer.length > 0) {
    yield* handleEvent(buffer);
    if (errored) return;
  }

  const toolCalls = materializeOpenAIStreamToolCalls(streamedToolCalls, fromWireToolName);

  for (const toolCall of toolCalls) {
    yield { toolCall, type: "tool-call" };
  }

  yield {
    response: {
      id: responseId,
      model,
      output: stripLeadingThinkBlock(output),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    },
    type: "done"
  };
}

function readOpenAIStreamError(payload: Record<string, unknown>): string | undefined {
  const err = payload.error;
  if (typeof err === "string") {
    return err.trim().length > 0 ? `OpenAI-compatible stream error: ${err.trim()}` : undefined;
  }
  if (isRecord(err)) {
    const message = typeof err.message === "string" && err.message.trim().length > 0
      ? err.message.trim()
      : JSON.stringify(err);
    return `OpenAI-compatible stream error: ${message}`;
  }
  return undefined;
}

function readSseData(event: string): string | undefined {
  const lines = event
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());

  return lines.length > 0 ? lines.join("\n") : undefined;
}

function readOpenAIStreamDelta(payload: Record<string, unknown>): string {
  const choice = Array.isArray(payload.choices) && isRecord(payload.choices[0]) ? payload.choices[0] : undefined;
  const delta = isRecord(choice?.delta) ? choice.delta : undefined;
  return readOpenAIContent(delta?.content);
}

interface OpenAIStreamToolCallDelta {
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  readonly argumentsChunk?: string;
}

interface MutableOpenAIStreamToolCall {
  id?: string;
  name?: string;
  argumentsText: string;
}

function readOpenAIStreamToolCallDeltas(payload: Record<string, unknown>): readonly OpenAIStreamToolCallDelta[] {
  const choice = Array.isArray(payload.choices) && isRecord(payload.choices[0]) ? payload.choices[0] : undefined;
  const delta = isRecord(choice?.delta) ? choice.delta : undefined;
  const toolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];

  return toolCalls.flatMap((entry, fallbackIndex) => {
    if (!isRecord(entry)) {
      return [];
    }

    const fn = isRecord(entry.function) ? entry.function : {};
    return [{
      argumentsChunk: typeof fn.arguments === "string" ? fn.arguments : undefined,
      id: typeof entry.id === "string" ? entry.id : undefined,
      index: typeof entry.index === "number" ? entry.index : fallbackIndex,
      name: typeof fn.name === "string" ? fn.name : undefined
    }];
  });
}

function mergeOpenAIStreamToolCall(
  target: Map<number, MutableOpenAIStreamToolCall>,
  delta: OpenAIStreamToolCallDelta
): void {
  const current = target.get(delta.index) ?? { argumentsText: "" };

  target.set(delta.index, {
    argumentsText: current.argumentsText + (delta.argumentsChunk ?? ""),
    id: delta.id ?? current.id,
    name: delta.name ?? current.name
  });
}

function materializeOpenAIStreamToolCalls(
  source: ReadonlyMap<number, MutableOpenAIStreamToolCall>,
  fromWireToolName: (name: string) => string
): readonly ModelToolCall[] {
  return [...source.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([index, value]) => {
      if (!value.name) {
        return [];
      }

      return [{
        arguments: parseToolArguments(value.argumentsText),
        id: value.id ?? `tool_call_${index}`,
        name: fromWireToolName(sanitizeToolCallName(value.name))
      }];
    });
}
