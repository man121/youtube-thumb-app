'use strict';

// Log helper
const $ = (id) => document.getElementById(id);
const logEl = $('log');
function log(m){ try{ logEl.textContent += m + '\n'; logEl.scrollTop = logEl.scrollHeight; }catch{} console.log(m); }
log('app.js loaded ✅');

// Global config
const W=1280,H=720;
const EP_CANDIDATES=['/.netlify/functions/image-gen','/.netlify/functions/openai-image','/.netlify/functions/img-gen'];
let FN_PATH = null;

// Error surfaces
window.addEventListener('error', e => log('JS ERROR: ' + (e.message || e.error || e)));
window.addEventListener('unhandledrejection', e => log('PROMISE ERROR: ' + (e.reason?.message || e.reason || e)));

// Helpers
function loadImage(src,{crossOrigin}={}){return new Promise((res,rej)=>{const img=new Image();if(crossOrigin)img.crossOrigin=crossOrigin;img.onload=()=>res(img);img.onerror=e=>rej(e);img.src=src;});}
function coverContainRect(sw,sh,dw,dh,mode='cover'){
  if(mode==='stretch') return {sx:0,sy:0,sWidth:sw,sHeight:sh,dx:0,dy:0,dWidth:dw,dHeight:dh};
  const sr=sw/sh, dr=dw/dh;
  if(mode==='cover'){let sW,sH,sx,sy;if(sr>dr){sH=sh;sW=dr*sH;sx=(sw-sW)/2;sy=0;}else{sW=sw;sH=sW/dr;sx=0;sy=(sh-sH)/2;}return {sx,sy,sWidth:sW,sHeight:sH,dx:0,dy:0,dWidth:dw,dHeight:dh};}
  let dW,dH,dx,dy;if(sr>dr){dW=dw;dH=dW/sr;dx=0;dy=(dh-dH)/2;}else{dH=dh;dW=dH*sr;dy=0;dx=(dw-dW)/2;}return {sx:0,sy:0,sWidth:sw,sHeight:sh,dx,dy,dWidth:dW,dHeight:dH};
}
function wrapText(ctx,text,maxWidth,font){
  if(!text||!text.trim())return[];ctx.save();ctx.font=font;const words=text.split(/\s+/);const lines=[];let line='';
  for(const w of words){const test=line?line+' '+w:w;if(ctx.measureText(test).width<=maxWidth){line=test;}else{if(line)lines.push(line);line=w;}}
  if(line)lines.push(line);ctx.restore();return lines;
}
function applyPromptPalette(prompt){
  const p=(prompt||'').toLowerCase();
  const palettes=[
    {match:/cyber|neon|punk/,primary:'#ff006e',secondary:'#3a0ca3'},
    {match:/ocean|wave|blue/,primary:'#0ea5e9',secondary:'#082f49'},
    {match:/forest|green|nature/,primary:'#22c55e',secondary:'#064e3b'},
    {match:/sunset|orange|gold/,primary:'#f59e0b',secondary:'#7c2d12'},
    {match:/pink|magenta|rose/,primary:'#ec4899',secondary:'#831843'}
  ];
  const f=palettes.find(x=>x.match.test(p))||palettes[0];
  state.primary=f.primary; state.secondary=f.secondary; state.bgImg=null; draw();
}
function setLoading(on){
  const overlay=$('loadingOverlay'); const btn=$('btnAI');
  if(!btn.dataset.label) btn.dataset.label=btn.textContent;
  btn.disabled=on; btn.textContent=on?'Generating…':btn.dataset.label;
  overlay.classList.toggle('active',on);
  overlay.setAttribute('aria-hidden',String(!on));
  overlay.parentElement.setAttribute('aria-busy',String(on));
}
async function detectEndpoint(){
  for(const ep of EP_CANDIDATES){
    try{
      const r=await fetch(ep,{method:'GET',cache:'no-store'});
      if(r.ok){ FN_PATH=ep; const lbl=$('aiEndpointLabel'); if(lbl) lbl.textContent=location.origin+ep; log('AI endpoint: '+ep); return ep; }
    }catch{}
  }
  const lbl=$('aiEndpointLabel'); if(lbl) lbl.textContent='none found';
  log('No AI function found (404).');
  return null;
}
async function callImageAPI(body){
  if(!FN_PATH) await detectEndpoint();
  if(!FN_PATH) throw new Error('No function endpoint detected');
  log('POST '+FN_PATH);
  const res=await fetch(FN_PATH,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {res, ep: FN_PATH};
}

// Drawing
const state={ primary:'#0ea5e9', secondary:'#1e293b', text:'#ffffff', title:'How to Build a Thumbnail Generator', subtitle:'Step-by-step in 10 minutes', titleSize:120, subtitleSize:56, strokeWidth:8, shadow:'on', layout:'left', fit:'cover', bgImg:null, logoImg:null };
const canvas=$('canvas');

function draw(){
  const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,W,H);
  if(state.bgImg){const r=coverContainRect(state.bgImg.naturalWidth,state.bgImg.naturalHeight,W,H,state.fit);try{ctx.drawImage(state.bgImg,r.sx,r.sy,r.sWidth,r.sHeight,r.dx,r.dy,r.dWidth,r.dHeight);}catch{}}
  else{const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,state.secondary);g.addColorStop(1,state.primary);ctx.fillStyle=g;ctx.fillRect(0,0,W,H);}
  ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fillRect(0,H*0.55,W,H*0.45);

  const pad=64, textW=W-pad*2, align=state.layout;
  const titleFont=`bold ${state.titleSize}px Bebas Neue, Impact, Arial Black, sans-serif`;
  const subFont=`bold ${state.subtitleSize}px Bebas Neue, Impact, Arial Black, sans-serif`;
  function drawLines(lines,startY,fs){
    const lh=Math.round(fs*1.05); let y=startY;
    for(const line of lines){
      const w=ctx.measureText(line).width;
      let x=pad; if(align==='center')x=(W-w)/2; else if(align==='right')x=W-pad-w;
      if(state.shadow==='on'){ctx.shadowColor='#000';ctx.shadowBlur=16;ctx.shadowOffsetX=2;ctx.shadowOffsetY=4;}else{ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;}
      if(state.strokeWidth>0){ctx.lineWidth=state.strokeWidth;ctx.strokeStyle=state.secondary;ctx.strokeText(line,x,y);}
      ctx.fillStyle=state.text; ctx.fillText(line,x,y); y+=lh;
    }
    return y;
  }
  ctx.font=titleFont; ctx.textBaseline='top';
  const titleLines=wrapText(ctx,state.title,textW,titleFont);
  let nextY=drawLines(titleLines,H*0.58,state.titleSize);
  if((state.subtitle||'').trim()){
    ctx.font=subFont; ctx.textBaseline='top';
    const subLines=wrapText(ctx,state.subtitle,textW,subFont);
    nextY=drawLines(subLines,nextY+16,state.subtitleSize);
  }
  if(state.logoImg){
    const max=200; const r=coverContainRect(state.logoImg.naturalWidth,state.logoImg.naturalHeight,max,max,'contain');
    ctx.drawImage(state.logoImg,r.sx,r.sy,r.sWidth,r.sHeight,24,24,r.dWidth,r.dHeight);
  }
}

// Wire controls
function on(id,ev,fn){ const el=$(id); if(!el){ log('MISSING ELEMENT: #'+id); return; } el.addEventListener(ev,fn); log('wired #'+id+' – '+ev); }

on('title','input',e=>{state.title=e.target.value;draw()});
on('subtitle','input',e=>{state.subtitle=e.target.value;draw()});
on('titleSize','input',e=>{state.titleSize=+e.target.value;$('lblTitleSize').textContent=state.titleSize;draw()});
on('subtitleSize','input',e=>{state.subtitleSize=+e.target.value;$('lblSubtitleSize').textContent=state.subtitleSize;draw()});
on('strokeWidth','input',e=>{state.strokeWidth=+e.target.value;$('lblStroke').textContent=state.strokeWidth;draw()});
on('shadow','change',e=>{state.shadow=e.target.value;draw()});
on('layout','change',e=>{state.layout=e.target.value;draw()});
on('fit','change',e=>{state.fit=e.target.value;draw()});
on('colorPrimary','input',e=>{state.primary=e.target.value;draw()});
on('colorSecondary','input',e=>{state.secondary=e.target.value;draw()});
on('colorText','input',e=>{state.text=e.target.value;draw()});

on('fileBg','change',async e=>{
  const file=e.target.files && e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async ()=>{try{state.bgImg=await loadImage(reader.result);draw();log('bg loaded');}catch{alert('Could not load image.');}};
  reader.readAsDataURL(file);
});

on('fileLogo','change',async e=>{
  const file=e.target.files && e.target.files[0];
  if(!file){state.logoImg=null;draw();return;}
  const reader=new FileReader();
  reader.onload=async ()=>{try{state.logoImg=await loadImage(reader.result);draw();log('logo loaded');}catch{alert('Could not load logo image.');}};
  reader.readAsDataURL(file);
});

on('btnUseYT','click', async ()=>{
  const id=(function(input){try{const s=(input||'').trim();if(/^[A-Za-z0-9_-]{11}$/.test(s))return s;const url=new URL(s);const host=url.hostname.replace(/^www\./,'');if(host==='youtu.be'){const seg=url.pathname.replace(/^\//,'').split('/')[0];return /^[A-Za-z0-9_-]{11}$/.test(seg)?seg:null;}if(host.endsWith('youtube.com')){const v=url.searchParams.get('v');if(v&&/^[A-Za-z0-9_-]{11}$/.test(v))return v;const m=url.pathname.match(/\/(shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:\b|\/|$)/);if(m)return m[2];}return null;}catch{return null;}})($('ytUrl').value);
  if(!id){ alert('Please paste a full YouTube URL or a valid 11-char video ID.'); return; }
  const list=[`https://img.youtube.com/vi/${id}/maxresdefault.jpg`,`https://img.youtube.com/vi/${id}/sddefault.jpg`,`https://img.youtube.com/vi/${id}/hqdefault.jpg`,`https://img.youtube.com/vi/${id}/default.jpg`];
  let loaded=null,lastErr=null;
  for(const u of list){ try{ loaded=await loadImage(u,{crossOrigin:'anonymous'}); break; }catch(e){ lastErr=e; } }
  if(!loaded){ console.error(lastErr); alert('Could not load YouTube thumbnail. Try another video, upload a screenshot, or use AI Generate.'); return; }
  state.bgImg=loaded; draw();
});

on('btnAI','click', async ()=>{
  const prompt=$('aiPrompt').value||'high-contrast abstract ocean waves, vivid, cinematic lighting';
  const size=($('imgSize')?.value)||'1024x1024';
  setLoading(true);
  try{
    if(!FN_PATH) await detectEndpoint();
    const { res, ep } = await callImageAPI({ prompt, size });
    if(!res.ok){
      const txt=await res.text();
      if(res.status===402||res.status===403||res.status===504){
        applyPromptPalette(prompt);
        alert(`AI image unavailable right now (status ${res.status}).\n${txt}\n(Endpoint: ${ep})\nUsing a styled gradient instead so you can keep designing.`);
        return;
      }
      if(res.status===404){
        const newEp=await detectEndpoint();
        if(newEp && newEp!==ep){
          const retry=await fetch(newEp,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,size})});
          if(retry.ok){
            const blob=await retry.blob(); const url=URL.createObjectURL(blob);
            try{state.bgImg=await loadImage(url);draw();}finally{setTimeout(()=>URL.revokeObjectURL(url),2000);}
            return;
          }
        }
      }
      alert(`Could not generate an AI background.\nServer responded ${res.status}: ${txt}\n(Endpoint tried: ${ep})`);
      return;
    }
    const blob=await res.blob(); const url=URL.createObjectURL(blob);
    try{state.bgImg=await loadImage(url);draw();}finally{setTimeout(()=>URL.revokeObjectURL(url),2000);}
  }catch(e){
    applyPromptPalette(prompt);
    alert(`Network error calling the image function.\n${e.message||e}\nUsing a styled gradient instead so you can continue.`);
  }finally{ setLoading(false); }
});

on('btnExport','click',()=>{
  try{
    const dataUrl=canvas.toDataURL('image/png');
    const a=document.createElement('a'); a.href=dataUrl; a.download=`thumbnail-${Date.now()}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }catch{ alert('Export failed. If background came from YouTube, try Upload or AI Generate before exporting.'); }
});

// Test endpoint button
on('btnTestAI','click', async ()=>{
  const ep = await detectEndpoint();
  alert(ep ? `AI function is reachable:\n${location.origin}${ep}` : 'No AI function endpoint was found (404).');
});

// Tests + init
function runTests(){
  const tests=[]; const t=(n,f)=>{ try{const r=f(); tests.push({n,ok:r===true});}catch(e){tests.push({n,ok:false});} };
  const extract=(input)=>{try{const s=(input||'').trim();if(/^[A-Za-z0-9_-]{11}$/.test(s))return s;const url=new URL(s);const host=url.hostname.replace(/^www\./,'');if(host==='youtu.be'){const seg=url.pathname.replace(/^\//,'').split('/')[0];return /^[A-Za-z0-9_-]{11}$/.test(seg)?seg:null;}if(host.endsWith('youtube.com')){const v=url.searchParams.get('v');if(v&&/^[A-Za-z0-9_-]{11}$/.test(v))return v;const m=url.pathname.match(/\/(shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:\b|\/|$)/);if(m)return m[2];}return null;}catch{return null;}};
  const cases=[['dQw4w9WgXcQ','dQw4w9WgXcQ'],['https://www.youtube.com/watch?v=dQw4w9WgXcQ','dQw4w9WgXcQ'],['https://youtu.be/dQw4w9WgXcQ','dQw4w9WgXcQ'],['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=60s','dQw4w9WgXcQ'],['https://m.youtube.com/watch?v=dQw4w9WgXcQ','dQw4w9WgXcQ'],['https://www.youtube.com/shorts/dQw4w9WgXcQ?si=abc','dQw4w9WgXcQ'],['https://www.youtube.com/embed/dQw4w9WgXcQ','dQw4w9WgXcQ'],['   dQw4w9WgXcQ   ','dQw4w9WgXcQ'],['not-a-url-or-id',null],['short-id',null]];
  for(const [inp,exp] of cases){t(`extract(${inp})`,()=>extract(inp)===exp);}
  t('stretch',()=>{const r=coverContainRect(100,50,200,100,'stretch');return r.dWidth===200&&r.dHeight===100;});
  t('contain tall',()=>{const r=coverContainRect(100,200,200,100,'contain');return r.dx===75&&r.dy===0&&Math.round(r.dWidth)===50&&Math.round(r.dHeight)===100;});
  t('cover wide',()=>{const r=coverContainRect(400,100,200,100,'cover');return Math.round(r.sWidth)===200&&Math.round(r.sHeight)===100;});
  $('tests').textContent=tests.map(x=>`${x.ok?'✅':'❌'} ${x.n}`).join('\n');
  return tests.every(x=>x.ok);
}
draw(); runTests(); detectEndpoint().then(()=>log('INIT OK'));
