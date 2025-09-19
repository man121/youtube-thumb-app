// netlify/functions/openai-image.js
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { prompt } = JSON.parse(event.body || '{}');
    const body = { model: 'gpt-image-1', prompt: prompt || 'high-contrast abstract ocean waves, vivid, cinematic lighting', size: '1280x720', n: 1 };
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) return { statusCode: 500, body: await r.text() };
    const data = await r.json();
    const image = data?.data?.[0];
    let buf = null;
    if (image?.b64_json) {
      buf = Buffer.from(image.b64_json, 'base64');
    } else if (image?.url) {
      const proxied = await fetch(image.url);
      const ab = await proxied.arrayBuffer();
      buf = Buffer.from(ab);
    }
    if (!buf) return { statusCode: 500, body: 'No image returned' };
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
      body: buf.toString('base64'),
      isBase64Encoded: true
    };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
};
