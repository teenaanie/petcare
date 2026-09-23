// netlify/functions/_pricing.js
//
// One place for what the AI costs, so `api_usage.estimated_cost_usd` means the
// same thing on every row and a price change is one edit rather than a search.
//
// CHECK THESE AGAINST OPENAI'S CURRENT PRICE LIST. They were correct when
// written and they are not fetched from anywhere — a stale number here makes
// every cost report quietly wrong, which is worse than no report at all. The
// env overrides exist so a price change can be applied without a deploy.
//
//   gpt-4o-mini   $0.15 per 1M input tokens, $0.60 per 1M output tokens
//   whisper-1     $0.006 per minute, billed on audio duration
//
// Last checked: 2026-09-23.

export const USD_PER_INPUT_TOKEN =
  Number(process.env.PRICE_PER_INPUT_TOKEN  || 0.00000015)
export const USD_PER_OUTPUT_TOKEN =
  Number(process.env.PRICE_PER_OUTPUT_TOKEN || 0.0000006)
export const USD_PER_AUDIO_MINUTE =
  Number(process.env.PRICE_PER_AUDIO_MINUTE || 0.006)

/** Cost of one chat completion, from OpenAI's own `usage` block. */
export function chatCost(usage = {}) {
  const inTok  = usage.prompt_tokens     || 0
  const outTok = usage.completion_tokens || 0
  return {
    promptTokens: inTok,
    completionTokens: outTok,
    costUsd: inTok * USD_PER_INPUT_TOKEN + outTok * USD_PER_OUTPUT_TOKEN,
  }
}

/**
 * Cost of one transcription.
 *
 * Whisper bills by audio DURATION, which the response does not report, so this
 * estimates from the encoded size. Opus from a browser recorder measures about
 * 15 KB per second (measured: a 1.0s clip is ~15,600 bytes, a 2.5s clip
 * ~38,000). It is an estimate and is labelled as one — a recording at a very
 * different bitrate will be off, and the honest fix is to send the real
 * duration from the client.
 */
export const BYTES_PER_AUDIO_SECOND = 15_000

export function audioCost(byteLength) {
  const seconds = byteLength / BYTES_PER_AUDIO_SECOND
  return { seconds, costUsd: (seconds / 60) * USD_PER_AUDIO_MINUTE }
}
