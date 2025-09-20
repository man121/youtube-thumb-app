// netlify/functions/openai-image.js
const https = require("https");

function postJSON(hostname, path, body, headers = {}) {
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
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function downloadBuffer(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    https
      .get(
        { hostname: u.hostname, path: u.pathname + u.search, protocol: u.protocol },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks)));
        }
      )
      .on("error", reject);
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { prompt } = JSON.parse(event.body || "{}");

    if (!process.env.OPENAI_API_KEY) {
      return { statusCode: 500, body: "Missing OPENAI_API_KEY env var" };
    }

    // Use a supported size (landscape). 16:9 export still works via the canvas.
    const body = {
      model: "gpt-image-1",
      prompt: prompt || "high-contrast abstract ocean waves, vivid, cinematic lighting",
      size: "1536x1024", // <-- FIXED: valid size
      n: 1,
    };

    const resp = await postJSON(
      "api.openai.com",
      "/v1/images/generations",
      body,
      { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    );

    if (resp.status < 200 || resp.status >= 300) {
      return { statusCode: 500, body: `OpenAI error ${resp.status}: ${resp.body}` };
    }

    const data = JSON.parse(resp.body);
    const image = data?.data?.[0];
    let pngBuffer = null;

    if (image?.b64_json) {
      pngBuffer = Buffer.from(image.b64_json, "base64");
    } else if (image?.url) {
      pngBuffer = await downloadBuffer(image.url);
    }

    if (!pngBuffer) {
      return { statusCode: 500, body: "No image returned from OpenAI" };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      body: pngBuffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: String(e) };
  }
};
