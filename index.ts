// THE EDIT — server function "ai" (Supabase Edge Function, Deno).
// Keeps your Anthropic API key on the server. Two actions:
//   { action: "ai", prompt, images: [{type, data}], tier }  -> { text }
//   { action: "fetchImage", url }                           -> { type, data }  (Pinterest links only)
//
// Secrets (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY  required
//   ALLOWED_EMAIL      optional, e.g. you@gmail.com — only this account may use the function
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const MODEL = "claude-opus-5-5";
// THE EDIT asks for three kinds of work; effort sets how deeply Claude thinks.
const EFFORT: Record<string, "low" | "medium" | "high"> = { quick: "low", default: "medium", complex: "high" };
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const SYSTEM =
  "You are the styling engine inside THE EDIT, a private wardrobe and outfit-planning app used by one person. " +
  "Follow the requested output format exactly. When the request asks for JSON, reply with a single JSON object and nothing else.";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
const client = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Pinterest pages and their image CDN only, so the function can't be used as an open proxy.
const pinterestHost = (h: string) => /(^|\.)pinterest\.[a-z.]+$/i.test(h) || /(^|\.)pin\.it$/i.test(h) || /(^|\.)pinimg\.com$/i.test(h);

async function fetchPinterestImage(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { return json({ code: "unsupported_site", error: "Not a valid link" }, 400); }
  if (url.protocol !== "https:" || !pinterestHost(url.hostname)) return json({ code: "unsupported_site" }, 400);
  const headers = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", Accept: "text/html,image/*;q=0.9" };
  let res = await fetch(url, { headers, redirect: "follow" });
  if (!pinterestHost(new URL(res.url).hostname)) return json({ code: "unsupported_site" }, 400);
  let type = (res.headers.get("content-type") || "").split(";")[0];
  if (!type.startsWith("image/")) {
    const html = (await res.text()).slice(0, 3_000_000);
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (!m) return json({ code: "no_image" }, 404);
    const img = new URL(m[1].replace(/&amp;/g, "&"));
    if (img.protocol !== "https:" || !pinterestHost(img.hostname)) return json({ code: "no_image" }, 404);
    res = await fetch(img, { headers });
    type = (res.headers.get("content-type") || "").split(";")[0];
  }
  if (!res.ok || !IMAGE_TYPES.includes(type)) return json({ code: "no_image" }, 404);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 12_000_000) return json({ code: "too_large" }, 413);
  return json({ type, data: toBase64(bytes) });
}

async function askClaude(body: { prompt?: unknown; images?: unknown; tier?: unknown }) {
  if (!client) return json({ code: "not_configured", error: "ANTHROPIC_API_KEY is not set" }, 503);
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt || prompt.length > 300_000) return json({ code: "invalid_request" }, 400);
  // deno-lint-ignore no-explicit-any
  const images: any[] = Array.isArray(body.images) ? body.images : [];
  if (images.length > 8) return json({ code: "too_large" }, 413);
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const im of images) {
    const t = im && typeof im.type === "string" ? im.type : "";
    const d = im && typeof im.data === "string" ? im.data : "";
    if (!IMAGE_TYPES.includes(t) || !d || d.length > 7_000_000) return json({ code: "image_rejected" }, 400);
    content.push({ type: "image", source: { type: "base64", media_type: t as "image/jpeg", data: d } });
  }
  content.push({ type: "text", text: prompt });
  const effort = EFFORT[String(body.tier)] || "medium";

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort },
      // If a safety classifier declines, the API retries on a suitable fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content }],
    } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);

    if (response.stop_reason === "refusal") return json({ code: "refused" }, 422);
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) return json({ code: "empty_completion" }, 502);
    return json({ text, truncated: response.stop_reason === "max_tokens" });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ code: "rate_limited" }, 429);
    if (error instanceof Anthropic.AuthenticationError) return json({ code: "not_configured", error: "The Anthropic API key was rejected" }, 503);
    if (error instanceof Anthropic.BadRequestError) return json({ code: "invalid_request", error: error.message }, 400);
    if (error instanceof Anthropic.APIError) return json({ code: "upstream_error", error: `${error.status} ${error.message}` }, 502);
    return json({ code: "upstream_error", error: String(error) }, 502);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ code: "invalid_request" }, 405);

  // Only signed-in users of this project (and, if set, only ALLOWED_EMAIL).
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, (Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!);
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return json({ code: "session_expired" }, 401);
  const allowed = (Deno.env.get("ALLOWED_EMAIL") || "").trim().toLowerCase();
  if (allowed && (user.email || "").toLowerCase() !== allowed) return json({ code: "not_granted" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ code: "invalid_request" }, 400); }
  if (body.action === "fetchImage") return fetchPinterestImage(String(body.url || ""));
  return askClaude(body);
});
