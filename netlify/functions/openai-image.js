// netlify/functions/openai-image.js
const https = require("https");

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function postJSON({ hostname, path, body, headers = {}, timeoutMs = 12000 }){
  const payload = JSON.stringify(body);
  return new Promise((resolve,reject)=>{
    const req = https.request({ hostname, path, method:"POST", headers:{
      "Content-Type":"application/json",
      "Content-Length":Buffer.byteLength(payload),
      ...headers
    }}, res=>{
      let data=""; res.on("data",c=>data+=c); res.on("end",()=>resolve({status:res.statusCode, body:data}));
    });
    req.on("error",reject);
    req.setTimeout(timeoutMs,()=>req.destroy(new Error("Upstream request timeout")));
    req.write(payload); req.end();
  });
}

function downloadBuffer(urlStr, timeoutMs = 8000){
  return new Promise((resolve,reject)=>{
    const u=new URL(urlStr);
    const req=https.get({hostname:u.hostname,path:u.pathname+u.search,protocol:u.protocol},res=>{
      if(res.statusCode>=300 && res.statusCode<400 && res.headers.location){
        return downloadBuffer(res.headers.location,timeoutMs).then(resolve).catch(reject);
      }
      const chunks=[]; res.on("data",c=>chunks.push(c)); res.on("end",()=>resolve(Buffer.concat(chunks)));
    });
    req.on("error",reject);
    req.setTimeout(timeoutMs,()=>req.destroy(new Error("Download timeout")));
  });
}

const ALLOWED_SIZES = new Set(["1024x1024","1024x1536","1536x1024","auto"]);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function generateImage({ prompt, size }){
  const body={ model:"gpt-image-1", prompt, size, n:1 };
  const resp=await postJSON({
    hostname:"api.openai.com",
    path:"/v1/images/generations",
    body,
    headers:{ Authorization:`Bearer ${process.env.OPENAI_API_KEY}` },
    timeoutMs:12000
  });

  if(resp.status<200 || resp.status>=300){
    const text=resp.body;
    const err=new Error(`OpenAI error ${resp.status}: ${text}`);
    err.status=resp.status; err.body=text;
    throw err;
  }

  const data=JSON.parse(resp.body);
  const image=data && data.data && data.data[0];
  let buf=null;
  if(image && image.b64_json){ buf=Buffer.from(image.b64_json,"base64"); }
  else if(image && image.url){ buf=await downloadBuffer(image.url); }
  if(!buf) throw new Error("No image returned from OpenAI");
  return buf;
}

exports.handler = async (event)=>{
  // CORS / preflight
  if(event.httpMethod === "OPTIONS"){
    return { statusCode:204, headers:CORS, body:"" };
  }

  // GET health check (so browsing endpoint shows success)
  if(event.httpMethod === "GET"){
    return {
      statusCode:200,
      headers: { ...CORS, "Content-Type":"application/json" },
      body: JSON.stringify({
        ok: true,
        hasKey: Boolean(process.env.OPENAI_API_KEY),
        allowedSizes: Array.from(ALLOWED_SIZES)
      })
    };
  }

  if(event.httpMethod!=="POST"){
    return { statusCode:405, headers:CORS, body:"Method Not Allowed" };
  }
  if(!process.env.OPENAI_API_KEY){
    return { statusCode:500, headers:CORS, body:"Missing OPENAI_API_KEY env var" };
  }

  try{
    const { prompt, size } = JSON.parse(event.body || "{}");
    const userPrompt = prompt || "high-contrast abstract ocean waves, vivid, cinematic lighting";
    const requestedSize = ALLOWED_SIZES.has(size) ? size : "1024x1024";

    for(let attempt=1; attempt<=2; attempt++){
      try{
        const png = await generateImage({ prompt:userPrompt, size:requestedSize });
        return {
          statusCode:200,
          headers:{ ...CORS, "Content-Type":"image/png", "Cache-Control":"no-store" },
          body: png.toString("base64"),
          isBase64Encoded:true
        };
      }catch(e){
        const status = e.status || 0;
        const bodyText = e.body || String(e);
        if(status===401) return { statusCode:401, headers:CORS, body:"Invalid or missing API key" };
        if(status===403 && /must be verified/i.test(bodyText)){
          return { statusCode:403, headers:CORS, body:"Org not verified for gpt-image-1 yet. Verify in OpenAI dashboard and retry." };
        }
        if(status===402 || /billing_hard_limit_reached/i.test(bodyText)){
          return { statusCode:402, headers:CORS, body:"OpenAI billing hard limit reached on this account." };
        }
        if(status && status<500 && status!==429){
          return { statusCode:Math.max(status,400), headers:CORS, body:`OpenAI error ${status}: ${bodyText}` };
        }
        await sleep(600); // brief backoff then retry once
      }
    }
    return { statusCode:504, headers:CORS, body:"Upstream timed out generating image (try again or use gradient fallback)" };
  }catch(e){
    return { statusCode:500, headers:CORS, body:String(e) };
  }
};
