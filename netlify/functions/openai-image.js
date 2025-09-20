// netlify/functions/img-gen.js
const https = require("https");

// ---- Tunables: keep the whole round-trip under ~10s ----
const OPENAI_TIMEOUT_MS = 9000;     // single attempt to avoid hanging
const DOWNLOAD_TIMEOUT_MS = 6000;   // for fetching URL image if returned
// -------------------------------------------------------

const agent = new https.Agent({ keepAlive: true });

function postJSON({ hostname, path, body, headers = {}, timeoutMs }) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
        agent,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ status: res.statusCode || 0, body: data })
        );
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () =>
      req.destroy(new Error("Upstream request timeout"))
    );
    req.write(payload);
    req.end();
  });
}

function downloadBuffer(urlStr, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.get(
      { hostname: u.hostname, path: u.pathname + u.search, protocol: u.protocol, agent },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadBuffer(res.headers.location, timeoutMs).then(resolve).catch(reject);
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () =>
      req.destroy(new Error("Download timeout"))
    );
  });
}

const ALLOWED_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function generateImage({ prompt, size }) {
  // Single quick attempt — fail fast so the browser never times out
  const resp = await postJSON({
    hostname: "api.openai.com",
    path: "/v1/images/generations",
    body: { model: "gpt-image-1", prompt, size, n: 1 },
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    timeoutMs: OPENAI_TIMEOUT_MS,
  });

  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error(`OpenAI error ${resp.status}: ${resp.body}`);
    err.status = resp.status; err.body = resp.body;
    throw err;
  }

  const data = JSON.parse(resp.body);
  const image = data && data.data && data.data[0];
  let buf = null;
  if (image && image.b64_json) buf = Buffer.from(image.b64_json, "base64");
  else if (image && image.url) buf = await downloadBuffer(image.url, DOWNLOAD_TIMEOUT_MS);
  if (!buf) throw new Error("No image returned from OpenAI");
  return buf;
}

exports.handler = async (event) => {
  // CORS / preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // GET health (lets you check quickly in the browser)
  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        hasKey: Boolean(process.env.OPENAI_API_KEY),
        allowedSizes: Array.from(ALLOWED_SIZES),
        note: "POST to generate; responds fast to avoid client timeouts.",
      }),
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { statusCode: 500, headers: CORS, body: "Missing OPENAI_API_KEY env var" };
  }

  const started = Date.now();
  try {
    const { prompt, size } = JSON.parse(event.body || "{}");
    const userPrompt = prompt || "high-contrast abstract ocean waves, vivid, cinematic lighting";
    const requestedSize = ALLOWED_SIZES.has(size) ? size : "1024x1024";

    const png = await generateImage({ prompt: userPrompt, size: requestedSize });

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "image/png", "Cache-Control": "no-store", "X-Elapsed": String(Date.now() - started) },
      body: png.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (e) {
    const status = e.status || 0;
    const bodyText = e.body || String(e);

    // Quick, clear errors (no long hanging)
    if (status === 401) return { statusCode: 401, headers: CORS, body: "Invalid or missing API key" };
    if (status === 403 && /must be verified/i.test(bodyText)) {
      return { statusCode: 403, headers: CORS, body: "Org not verified for gpt-image-1 yet. Verify in OpenAI dashboard and retry." };
    }
    if (status === 402 || /billing_hard_limit_reached/i.test(bodyText)) {
      return { statusCode: 402, headers: CORS, body: "OpenAI billing hard limit reached on this account." };
    }
    if (String(e).includes("Upstream request timeout")) {
      return { statusCode: 504, headers: CORS, body: "OpenAI request timed out quickly (fast-fail). Try again or use gradient fallback." };
    }
    if (status && status < 500 && status !== 429) {
      return { statusCode: Math.max(status, 400), headers: CORS, body: `OpenAI error ${status}: ${bodyText}` };
    }
    return { statusCode: 500, headers: CORS, body: String(e) };
  }
};
