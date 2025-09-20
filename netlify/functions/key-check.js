// netlify/functions/key-check.js
const https = require("https");
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const agent = new https.Agent({ keepAlive: true });

function getJSON({ hostname, path, headers = {}, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: "GET", headers, agent }, (res) => {
      let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Upstream request timeout")));
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };

  if (!process.env.OPENAI_API_KEY) {
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, hasKey: false, reason: "Missing OPENAI_API_KEY env var on Netlify." }) };
  }

  try {
    const resp = await getJSON({
      hostname: "api.openai.com",
      path: "/v1/models",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      timeoutMs: 5000,
    });
    let parsed = null; try { parsed = JSON.parse(resp.body); } catch {}
    const ok = resp.status === 200 && parsed && Array.isArray(parsed.data);
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok, hasKey: true, httpStatus: resp.status,
        error: ok ? null : (parsed && parsed.error) || resp.body,
        keyLooksLike: process.env.OPENAI_API_KEY.startsWith("sk-"),
        keyLength: process.env.OPENAI_API_KEY.length,
        note: "If httpStatus is 401, your key is invalid. If 403, org/account lacks access.",
      }) };
  } catch (e) {
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, hasKey: true, httpStatus: 0, error: String(e), note: "Network error reaching OpenAI from Netlify." }) };
  }
};
