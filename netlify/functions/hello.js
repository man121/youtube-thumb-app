// netlify/functions/hello.js
exports.handler = async () => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ok: true, msg: "Functions are working." })
});
