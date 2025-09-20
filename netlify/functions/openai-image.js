// netlify/functions/openai-image.js
const https = require("https");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function postJSON({ hostname, path, body, headers = {}, timeoutMs = 25000 }) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: "POST", headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers
        }
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Upstream request timeout")));
    req.write(payload);
    req.end();
  });
}

function downloadBuffer(urlStr, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.get(
      { hostname: u.hostname, path: u.pathname + u.search, protocol: u.protocol },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Download timeout")));
  });
}

function shouldRetry(status, bodyText, err) {
  if (err && /timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(String(err))) return true;
  if (status === 429) return true;
  if (status >= 500) return true;
  if (status === 504 || status === 502) return true;
  return false;
}

async function generateImage({ prompt, size }) {
  const resp = await postJSON({
    hostname: "api.openai.com",
    path: "/v1/images/generations",
    body: { model: "gpt-image-1", prompt, size, n: 1 },
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    timeoutMs: 25000
  });

  if (resp.status < 200 || resp.status >= 300) {
    const text = resp.body;
    const err = new Error(`OpenAI error ${resp.status}: ${text}`);
    err.status = resp.status;
    err.body = text;
    throw err;
  }

  const data = JSON.parse(resp.body);
  const image = data && data.data && data.data[0];
  let pngBuffer = null;

  if (image && image.b64_json) {
    pngBuffer = Buffer.from(image.b64_json, "base64");
  } else if (image && image.url) {
    pngBuffer = await downloadBuffer(image.url);
  }
  if (!pngBuffer) throw new Error("No image returned from OpenAI");

  return pngBuffer;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { statusCode: 500, body: "Missing OPENAI_API_KEY env var" };
  }

  try {
    const { prompt } = JSON.parse(event.body || "{}");
    const userPrompt = prompt || "high-contrast abstract ocean waves, vivid, cinematic lighting";

    // Try landscape first, then smaller square as fallback (faster).
    const sizes = ["1536x1024", "1024x1024"];

    let lastErr = null;
    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i];
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const buf = await generateImage({ prompt: userPrompt, size });
          return {
            statusCode: 200,
            headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
            body: buf.toString("base64"),
            isBase64Encoded: true
          };
        } catch (e) {
          lastErr = e;
          const status = e.status || 0;
          const bodyText = e.body || String(e);

          // Pass through known, non-retriable client errors clearly
          if (status === 401) return { statusCode: 401, body: "Invalid or missing API key" };
          if (status === 403 && /must be verified/i.test(bodyText)) {
            return { statusCode: 403, body: "Org not verified for gpt-image-1 yet. Verify in OpenAI dashboard and retry." };
          }
          if (status === 402 || /billing_hard_limit_reached/i.test(bodyText)) {
            return { statusCode: 402, body: "OpenAI billing hard limit reached on this account." };
          }
          if (!shouldRetry(status, bodyText, e)) break;

          // Backoff: 0.8s then 1.6s
          await sleep(800 * attempt);
        }
      }
      // Next size
    }

    return { statusCode: 504, body: String(lastErr || "Image generation timed out") };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: String(e) };
  }
};
