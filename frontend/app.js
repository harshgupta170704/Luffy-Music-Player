// ── YouTube IFrame Player ─────────────────────────────────────────────────────
let ytPlayer=null,ytReady=false,ytVideoCache={};
window.onYouTubeIframeAPIReady=function(){
  ytPlayer=new YT.Player("yt-player",{height:"200",width:"200",
    playerVars:{autoplay:0,controls:0,playsinline:1,rel:0,origin:window.location.origin,enablejsapi:1},
    events:{
      onReady:()=>{ytReady=true;},
      onStateChange:(e)=>{
        const S=YT.PlayerState;
        if(e.data===S.PLAYING){setPlay(true);startYTP();}
        if(e.data===S.PAUSED)setPlay(false);
        if(e.data===S.ENDED){setPlay(false);advanceQueue();}
      },
      onError:(err)=>{
        console.warn("YouTube embedding restricted or unavailable, falling back to iTunes preview.", err.data);
        const tag = document.getElementById("player-preview-tag");
        tag.textContent = "30s Preview";
        tag.style.color = "";
        if(currentSong) loadItunesPreview(currentSong);
      }
    }});
};
let ytTimer=null;
function startYTP(){
  clearInterval(ytTimer);
  ytTimer=setInterval(()=>{
    if(!ytPlayer?.getDuration)return;
    const dur=ytPlayer.getDuration(),cur=ytPlayer.getCurrentTime();
    if(!dur)return;
    document.getElementById("progress-fill").style.width=(cur/dur*100)+"%";
    document.getElementById("time-cur").textContent=fmt(cur);
    document.getElementById("time-dur").textContent=fmt(dur);
  },500);
}
async function loadYouTube(song){
  const bar=document.getElementById("player-bar");
  bar.style.display="flex";
  document.getElementById("player-title").textContent=song.name;
  document.getElementById("player-artist").textContent=song.artist;
  drawArt(document.getElementById("player-canvas"),song,50);
  document.getElementById("player-art-img").style.display="none";
  const tag=document.getElementById("player-preview-tag");
  tag.textContent="Loading..."; tag.style.color="";
  document.getElementById("time-dur").textContent="--:--";
  document.getElementById("progress-fill").style.width="0%";
  const cached=previewCache[song.id];
  if(cached?.album_art){const pi=document.getElementById("player-art-img");pi.src=cached.album_art;pi.style.display="block";}
  let vid=ytVideoCache[song.id];
  if(!vid){const d=await apiFetch("/youtube/"+song.id);vid=d?.youtube_id;if(vid)ytVideoCache[song.id]=vid;}
  if(vid&&ytReady){ytPlayer.loadVideoById(vid);tag.textContent="Full Song";tag.style.color="#00ffb3";}
  else if(!vid){tag.textContent="30s Preview";tag.style.color="";loadItunesPreview(song);}
  else setTimeout(()=>loadYouTube(song),800);
}
async function loadItunesPreview(song){
  let p=previewCache[song.id];
  if(!p){p=await apiFetch("/preview/"+song.id);if(p)previewCache[song.id]=p;}
  if(p?.album_art){
    document.getElementById("np-art-img").src=p.album_art;document.getElementById("np-art-img").style.display="block";
    document.getElementById("player-art-img").src=p.album_art;document.getElementById("player-art-img").style.display="block";
  }
  if(p?.preview_url){
    audioEl.src=p.preview_url;audioEl.load();
    const go=()=>audioEl.play().then(()=>setPlay(true)).catch(()=>setPlay(false));
    audioEl.readyState>=2?go():audioEl.addEventListener("canplay",go,{once:true});
  }else setTimeout(()=>advanceQueue(),1200);
}
// ── Keyboard Shortcuts ────────────────────────────────────────────────────────
document.addEventListener("keydown",(e)=>{
  const t=document.activeElement.tagName,typing=(t==="INPUT"||t==="TEXTAREA");
  if((e.ctrlKey||e.metaKey)&&e.key==="k"){e.preventDefault();toggleCmd();return;}
  if(e.key==="Escape"){closeCmd();return;}
  if(typing)return;
  if(e.key===" "){e.preventDefault();togglePlay();}
  else if(e.key==="["||e.key==="ArrowLeft"){e.preventDefault();queuePrev();}
  else if(e.key==="]"||e.key==="ArrowRight"){e.preventDefault();queueNext();}
});
// ── Command Palette ───────────────────────────────────────────────────────────
let fuseIdx=null,cmdSel=-1;
function buildFuse(){if(typeof Fuse!=="undefined")fuseIdx=new Fuse(allSongs,{keys:["name","artist","album","genre"],threshold:0.4});}
function toggleCmd(){document.getElementById("cmd-palette").classList.contains("hidden")?openCmd():closeCmd();}
function openCmd(){document.getElementById("cmd-palette").classList.remove("hidden");setTimeout(()=>document.getElementById("cmd-input").focus(),40);renderCmd(allSongs.slice(0,8));}
function closeCmd(){document.getElementById("cmd-palette").classList.add("hidden");document.getElementById("cmd-input").value="";cmdSel=-1;}
document.addEventListener("DOMContentLoaded",()=>{
  const ci=document.getElementById("cmd-input");if(!ci)return;
  ci.addEventListener("input",()=>{
    const q=ci.value.trim();
    if(!q){renderCmd(allSongs.slice(0,8));return;}
    const res=fuseIdx?fuseIdx.search(q).slice(0,8).map(r=>r.item):allSongs.filter(s=>s.name.toLowerCase().includes(q.toLowerCase())).slice(0,8);
    renderCmd(res);
  });
  ci.addEventListener("keydown",(e)=>{
    const items=[...document.querySelectorAll(".cmd-result-item")];
    if(e.key==="ArrowDown"){cmdSel=Math.min(cmdSel+1,items.length-1);hlCmd(items);}
    if(e.key==="ArrowUp"){cmdSel=Math.max(cmdSel-1,0);hlCmd(items);}
    if(e.key==="Enter"){const id=items[Math.max(cmdSel,0)]?.dataset?.id;if(id){closeCmd();selectSong(id);}}
  });
  document.getElementById("cmd-palette")?.addEventListener("click",(e)=>{if(e.target.id==="cmd-palette")closeCmd();});
});
function renderCmd(songs){
  cmdSel=-1;
  document.getElementById("cmd-results").innerHTML=songs.map(s=>`<div class="cmd-result-item" data-id="${s.id}" onclick="closeCmd();selectSong('${s.id}')"><img src="${artURL(s,60)}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;flex-shrink:0"/><div style="flex:1;min-width:0"><div style="font-size:.84rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.name}</div><div style="font-size:.7rem;color:#8892b0">${s.artist} - ${s.genre}</div></div></div>`).join("");
}
function hlCmd(items){items.forEach((el,i)=>el.classList.toggle("selected",i===cmdSel));items[cmdSel]?.scrollIntoView({block:"nearest"});}
// ── Infinite Scroll ───────────────────────────────────────────────────────────
let visibleCount=30,filteredSongs=[];
function setupInfiniteScroll(){
  const s=document.getElementById("scroll-sentinel");if(!s)return;
  new IntersectionObserver((ents)=>{
    if(ents[0].isIntersecting&&visibleCount<filteredSongs.length){visibleCount+=20;appendCards(filteredSongs.slice(visibleCount-20,visibleCount));}
  },{rootMargin:"300px"}).observe(s);
}
function appendCards(songs){
  const grid=document.getElementById("songs-grid");
  songs.forEach(s=>{
    if(document.getElementById("card-"+s.id))return;
    const isA=String(currentSong?.id)===String(s.id);
    const div=document.createElement("div");
    div.className="song-card"+(isA?" active":"");div.id="card-"+s.id;
    div.innerHTML="<div class='song-card-img-wrap'><img class='song-card-art' id='art-"+s.id+"' src='"+artURL(s,150)+"' loading='lazy'/>"+(isA?"<div class='card-playing-bar'><span></span><span></span><span></span></div>":"")+"<button class='card-play-btn'><svg width='14' height='14' viewBox='0 0 24 24' fill='white'><path d='M8 5v14l11-7z'/></svg></button></div><div class='song-card-meta'><div class='song-card-name'>"+s.name+"</div><div class='song-card-artist'>"+s.artist+"</div><span class='song-card-genre'>"+s.genre+"</span></div>";
    div.addEventListener("click",()=>selectSong(s.id));grid.appendChild(div);
  });
  fetchAlbumArtForGrid(songs);
}
// ── Config ───────────────────────────────────────────────────────────────────
const API = "";
let SESSION_ID = localStorage.getItem("animuse_session");
if (!SESSION_ID) { SESSION_ID = "sess_" + Math.random().toString(36).slice(2,11); localStorage.setItem("animuse_session", SESSION_ID); }

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let allSongs=[], currentSong=null, currentMood="", currentGenre="";
let likedSongs = new Set(JSON.parse(localStorage.getItem("liked")||"[]"));
let isAutoAdvancing = false; // KEY FIX: prevents queue rebuild on auto-play

// â”€â”€ DLL Queue (fixed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class QNode { constructor(s){this.song=s;this.prev=null;this.next=null;} }
class Queue {
  constructor(){ this.head=null; this.tail=null; this.current=null; this.size=0; }
  push(song){
    const n=new QNode(song);
    if(!this.tail){ this.head=this.tail=this.current=n; }
    else{ n.prev=this.tail; this.tail.next=n; this.tail=n; }
    this.size++;
  }
  goNext(){ if(this.current?.next){ this.current=this.current.next; return this.current.song; } return null; }
  goPrev(){ if(this.current?.prev){ this.current=this.current.prev; return this.current.song; } return null; }
  setCurrent(id){ let n=this.head; while(n){ if(String(n.song.id)===String(id)){this.current=n;return;} n=n.next; } }
  clear(){ this.head=null; this.tail=null; this.current=null; this.size=0; }
  toArray(){ const a=[]; let n=this.head; while(n){a.push(n.song);n=n.next;} return a; }
  hasMore(){ return !!this.current?.next; }
}
const queue = new Queue();

// â”€â”€ Anime Palettes & Canvas Art â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Dark, muted palettes â€” less saturated, won't fight the UI
const PALETTES=[
  ["#2a1500","#1a0d00","#3a2000"],  // deep gold-brown
  ["#0d1a2d","#081018","#1a2840"],  // deep ocean night
  ["#2d0a0a","#1f0606","#3d1010"],  // Shanks red
  ["#0d2820","#081c14","#1a382a"],  // Going Merry green
  ["#2a1a00","#1c1000","#3a2a00"],  // straw hat amber
  ["#1a0d2d","#100822","#2a1545"],  // Nami violet
  ["#2d1500","#1f0e00","#3d2200"],  // gold treasure
  ["#0a1e2d","#061420","#162e40"],  // deep sea blue
];
const KANJI=["麦","海","夢","宝","剣","自由","仒間","冒险","炎","月","風","王"];

function pal(song){ return PALETTES[(song.name.charCodeAt(0)+(song.artist.charCodeAt(0)||0))%PALETTES.length]; }

function drawArt(canvas,song,size=150){
  canvas.width=canvas.height=size;
  const ctx=canvas.getContext("2d");
  const [c1,c2,c3]=pal(song);
  // Dark radial gradient — subtle, not eye-burning
  const g=ctx.createRadialGradient(size*.25,size*.25,0,size*.75,size*.75,size*.9);
  g.addColorStop(0,c1); g.addColorStop(.6,c2); g.addColorStop(1,c3);
  ctx.fillStyle=g; ctx.fillRect(0,0,size,size);
  // Soft glow circles
  ctx.globalAlpha=0.12; ctx.fillStyle="#fff";
  for(let i=0;i<6;i++){
    const x=(Math.sin(i*137.5+song.name.charCodeAt(0))*.45+.5)*size;
    const y=(Math.cos(i*137.5+song.name.charCodeAt(0))*.45+.5)*size;
    ctx.beginPath(); ctx.arc(x,y,size*(0.03+(i%3)*0.02),0,Math.PI*2); ctx.fill();
  }
  // Subtle vignette
  const vg=ctx.createRadialGradient(size/2,size/2,size*.25,size/2,size/2,size*.8);
  vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,0.4)');
  ctx.globalAlpha=1; ctx.fillStyle=vg; ctx.fillRect(0,0,size,size);
  // Kanji — bright against dark bg
  ctx.globalAlpha=0.92; ctx.fillStyle="rgba(255,255,255,0.95)";
  const sym=KANJI[Number(song.id)%KANJI.length]||song.name[0];
  ctx.font=`900 ${size*.38}px 'Noto Sans JP',sans-serif`;
  ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=8;
  ctx.fillText(sym,size/2,size/2);
  ctx.shadowBlur=0; ctx.globalAlpha=1;
}
function artURL(song,size=150){ const c=document.createElement("canvas"); drawArt(c,song,size); return c.toDataURL(); }

// â”€â”€ Sakura Particles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
(function(){
  const cv=document.getElementById("particle-canvas"),ctx=cv.getContext("2d");
  let W,H,ptls=[];
  function resize(){W=cv.width=innerWidth;H=cv.height=innerHeight;}
  resize(); addEventListener("resize",resize);
  function mkSpark(){
    return{type:"spark",x:Math.random()*W,y:H+10,r:Math.random()*2+0.6,
      vx:(Math.random()-.5)*.8,vy:-(Math.random()*1.1+0.4),
      alpha:Math.random()*.55+.1,
      col:Math.random()>.55?"rgba(245,197,24,":"rgba(230,57,70,"};
  }
  function mkBubble(){
    return{type:"bubble",x:Math.random()*W,y:H+10,r:Math.random()*4+1.5,
      vx:(Math.random()-.5)*.35,vy:-(Math.random()*.65+0.2),
      alpha:Math.random()*.1+.03,col:"rgba(80,160,255,"};
  }
  for(let i=0;i<28;i++){const p=mkSpark();p.y=Math.random()*H;ptls.push(p);}
  for(let i=0;i<22;i++){const p=mkBubble();p.y=Math.random()*H;ptls.push(p);}
  function draw(){
    ctx.clearRect(0,0,W,H);
    ptls.forEach(p=>{
      if(p.type==="spark"){
        ctx.save();ctx.globalAlpha=p.alpha;
        ctx.fillStyle=p.col+p.alpha+")";
        ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=p.col+(p.alpha*0.6)+")";ctx.lineWidth=0.5;
        ctx.beginPath();ctx.moveTo(p.x-p.r*2,p.y);ctx.lineTo(p.x+p.r*2,p.y);ctx.stroke();
        ctx.beginPath();ctx.moveTo(p.x,p.y-p.r*2);ctx.lineTo(p.x,p.y+p.r*2);ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();ctx.globalAlpha=p.alpha;
        ctx.strokeStyle=p.col+p.alpha+")";
        ctx.lineWidth=0.8;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.stroke();
        ctx.restore();
      }
      p.x+=p.vx;p.y+=p.vy;
      if(p.y<-20){const n=p.type==="spark"?mkSpark():mkBubble();Object.assign(p,n);p.y=H+10;}
    });
    requestAnimationFrame(draw);
  }
  draw();
})();

// â”€â”€ Toast â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function toast(msg,icon="âœ¨"){
  const t=document.createElement("div");
  t.className="toast"; t.textContent=icon+" "+msg;
  document.body.appendChild(t);
  requestAnimationFrame(()=>t.classList.add("show"));
  setTimeout(()=>{t.classList.remove("show");setTimeout(()=>t.remove(),400);},2200);
}

// â”€â”€ API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function apiFetch(path,opts={}){
  try{const r=await fetch(API+path,opts);return r.ok?r.json():null;}catch{return null;}
}
async function sendInteraction(type,songId=currentSong?.id){
  if(!songId)return;
  if(type==="like"){
    const has=likedSongs.has(String(songId));
    has?likedSongs.delete(String(songId)):likedSongs.add(String(songId));
    document.getElementById("btn-like").classList.toggle("liked",!has);
    localStorage.setItem("liked",JSON.stringify([...likedSongs]));
    toast(has?"Removed from likes":"Added to likes",has?"ðŸ’”":"â¤ï¸");
  }
  const d=await apiFetch("/interact",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({session_id:SESSION_ID,song_id:String(songId),interaction_type:type})});
  if(d?.engine)updateEnginePanel(d.engine);
}

// â”€â”€ Audio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const audioEl=document.getElementById("audio-el");
let isPlaying=false, previewCache={};
audioEl.volume=0.8;

audioEl.addEventListener("timeupdate",()=>{
  const pct=audioEl.duration?(audioEl.currentTime/audioEl.duration)*100:0;
  document.getElementById("progress-fill").style.width=pct+"%";
  document.getElementById("time-cur").textContent=fmt(audioEl.currentTime);
});
audioEl.addEventListener("loadedmetadata",()=>{document.getElementById("time-dur").textContent=fmt(audioEl.duration);});
audioEl.addEventListener("ended",()=>{
  setPlay(false);
  advanceQueue();
});
audioEl.addEventListener("error",()=>{ setPlay(false); advanceQueue(); });

function advanceQueue(){
  const next=queue.goNext();
  if(next){ isAutoAdvancing=true; selectSong(next.id); }
  else if(queue.toArray().length>1) toast("End of queue","ðŸŽµ");
}

function fmt(s){if(!s||isNaN(s))return"0:00";const m=Math.floor(s/60),sec=Math.floor(s%60);return`${m}:${sec.toString().padStart(2,"0")}`;}
function setPlay(v){
  isPlaying=v;
  const ip=document.getElementById("icon-play");
  const ipa=document.getElementById("icon-pause");
  const wf=document.getElementById("waveform");
  if(ip) ip.style.display=v?"none":"block";
  if(ipa) ipa.style.display=v?"block":"none";
  if(wf) wf.classList.toggle("playing",v);
}
function togglePlay(){
  if(document.getElementById("player-preview-tag").textContent.includes("Full Song")){
    if(ytPlayer && ytPlayer.getPlayerState){
      const s = ytPlayer.getPlayerState();
      if(s === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
      else ytPlayer.playVideo();
    }
    return;
  }
  if(!audioEl.src||audioEl.src===location.href)return;
  if(isPlaying){audioEl.pause();setPlay(false);}
  else audioEl.play().then(()=>setPlay(true)).catch(()=>{});
}
function seekAudio(e){
  const r=e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX-r.left)/r.width;
  if(document.getElementById("player-preview-tag").textContent.includes("Full Song")){
    if(ytPlayer && ytPlayer.getDuration){
      ytPlayer.seekTo(pct * ytPlayer.getDuration(), true);
    }
    return;
  }
  if(!audioEl.duration)return;
  audioEl.currentTime=pct*audioEl.duration;
}
function setVolume(v){
  audioEl.volume=parseFloat(v);
  if(ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(parseFloat(v)*100);
}

async function loadPreview(song){
  document.getElementById("player-bar").style.display="flex";
  document.getElementById("player-title").textContent=song.name;
  document.getElementById("player-artist").textContent=song.artist;
  drawArt(document.getElementById("player-canvas"),song,50);
  const pImg=document.getElementById("player-art-img"); pImg.style.display="none";

  let p=previewCache[song.id];
  if(!p){p=await apiFetch(`/preview/${song.id}`);if(p)previewCache[song.id]=p;}

  if(p?.album_art){
    const ni=document.getElementById("np-art-img");
    ni.src=p.album_art; ni.style.display="block";
    pImg.src=p.album_art; pImg.style.display="block";
  }
  if(p?.preview_url){
    audioEl.src=p.preview_url; audioEl.load();
    // Wait for enough data, then play
    const doPlay=()=>{
      audioEl.play()
        .then(()=>setPlay(true))
        .catch(()=>{
          setPlay(false);
          // Autoplay blocked â€” show click-to-play hint
          document.getElementById("btn-play").title="Click â–¶ to play";
        });
    };
    if(audioEl.readyState>=2){ doPlay(); }
    else{ audioEl.addEventListener('canplay',doPlay,{once:true}); }
  } else {
    setPlay(false);
    // No preview for this song â€” skip to next after short delay
    setTimeout(()=>{ if(!isPlaying) advanceQueue(); },1200);
  }
}

// â”€â”€ Mood Filters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MOOD={
  hype:      s=>s.energy>0.78&&s.tempo>155,
  emotional: s=>s.valence<0.45&&s.energy<0.72,
  chill:     s=>s.energy<0.60&&s.valence>0.45,
  battle:    s=>s.energy>0.82&&s.tempo>160,
  dance:     s=>s.danceability>0.75,
  grandline: s=>s.album&&s.album.toLowerCase().includes("one piece"),
};

// â”€â”€ Load Songs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadSongs(){
  const d=await apiFetch("/songs");
  if(!d){
    document.getElementById("songs-grid").innerHTML=
      '<p style="color:#ff6b9d;padding:20px;grid-column:1/-1">âš ï¸ Backend offline.<br><code style="font-size:.75rem">cd backend && uvicorn main:app --reload</code></p>';
    return;
  }
  allSongs=d.songs; buildGenreBar(); renderGrid(allSongs); loadTrending(); updateEngineStatus();
  buildFuse();
  setupInfiniteScroll();
}

function buildGenreBar(){
  const genres=[...new Set(allSongs.map(s=>s.genre))].sort();
  document.getElementById("genre-bar").innerHTML=genres.map(g=>
    `<button class="genre-chip" onclick="filterGenre(this,'${g}')">${g}</button>`).join("");
}
function filterGenre(btn,g){
  document.querySelectorAll(".genre-chip").forEach(b=>b.classList.remove("active"));
  currentGenre=currentGenre===g?"":g;
  if(currentGenre)btn.classList.add("active");
  applyFilters();
}
document.querySelectorAll(".mood-btn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".mood-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active"); currentMood=btn.dataset.mood; applyFilters();
  });
});
function applyFilters(){
  let songs=allSongs;
  if(currentGenre) songs=songs.filter(s=>s.genre===currentGenre);
  if(currentMood&&MOOD[currentMood]) songs=songs.filter(MOOD[currentMood]);
  const moodLabel=currentMood==="grandline"?"One Piece OST":currentMood;
  document.getElementById("browse-title").textContent=
    [moodLabel,currentGenre].filter(Boolean).join(" · ")||"⚓ All Grand Line Tracks";
  renderGrid(songs);
}

function renderGrid(songs){
  const grid=document.getElementById("songs-grid");
  if(!songs.length){grid.innerHTML='<p style="color:#4a5580;padding:20px;grid-column:1/-1">No songs found.</p>';return;}
  grid.innerHTML=songs.map(s=>{
    const isActive=String(currentSong?.id)===String(s.id);
    const isOP=s.album&&s.album.toLowerCase().includes("one piece");
    return`<div class="song-card${isActive?" active":""}" id="card-${s.id}" onclick="selectSong('${s.id}')">
      <div class="song-card-img-wrap">
        <img class="song-card-art" id="art-${s.id}" src="${artURL(s,150)}" alt="${s.name}" loading="lazy"/>
        ${isOP?'<span class="op-badge">⚓ ONE PIECE</span>':""}
        ${isActive?'<div class="card-playing-bar"><span></span><span></span><span></span></div>':""}
        <button class="card-play-btn" onclick="event.stopPropagation();selectSong('${s.id}')" title="Play">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
      <div class="song-card-meta">
        <div class="song-card-name">${s.name}</div>
        <div class="song-card-artist">${s.artist}</div>
        <span class="song-card-genre">${s.genre}</span>
      </div>
    </div>`;
  }).join("");
  // Progressively load real iTunes art in background
  fetchAlbumArtForGrid(songs);
}

async function fetchAlbumArtForGrid(songs){
  const BATCH=5;
  for(let i=0;i<songs.length;i+=BATCH){
    const batch=songs.slice(i,i+BATCH);
    await Promise.all(batch.map(async song=>{
      if(previewCache[song.id]?.album_art){ swapCardArt(song.id,previewCache[song.id].album_art); return; }
      const p=await apiFetch(`/preview/${song.id}`);
      if(p){ previewCache[song.id]=p; if(p.album_art) swapCardArt(song.id,p.album_art); }
    }));
  }
}
function swapCardArt(songId,artUrl){
  const img=document.getElementById(`art-${songId}`);
  if(img&&artUrl){ const t=new Image(); t.onload=()=>{img.src=artUrl;}; t.src=artUrl; }
}



// ——— 3D Card Tilt —————————————————————————————————————————————————
function tilt3d(el,e){
  const r=el.getBoundingClientRect();
  const x=((e.clientX-r.left)/r.width-.5)*18;
  const y=((e.clientY-r.top)/r.height-.5)*-18;
  el.style.transform=`perspective(600px) rotateY(${x}deg) rotateX(${y}deg) translateY(-4px)`;
}
function resetTilt(el){el.style.transform="";}

// ——— Select Song ——————————————————————————————————————————————————
async function selectSong(songId){
  const song=allSongs.find(s=>String(s.id)===String(songId));
  if(!song)return;
  currentSong=song;

  document.querySelectorAll(".song-card").forEach(c=>c.classList.remove("active"));
  document.getElementById(`card-${songId}`)?.classList.add("active");

  showNP(song);
  loadYouTube(song);
  sendInteraction("play",songId);

  if(!isAutoAdvancing){
    // Manual select —> rebuild queue with new recommendations
    await getRecs(songId);
  } else {
    // Auto-advance —> just update queue display, keep existing queue intact
    isAutoAdvancing=false;
    renderQueue();
  }
}

function showNP(song){
  document.getElementById("placeholder").style.display="none";
  const np=document.getElementById("now-playing"); np.style.display="flex";
  const ni=document.getElementById("np-art-img"); ni.style.display="none"; ni.src="";
  drawArt(document.getElementById("np-canvas"),song,210);
  document.getElementById("np-genre").textContent=song.genre;
  document.getElementById("np-title").textContent=song.name;
  document.getElementById("np-artist").textContent=song.artist;
  document.getElementById("np-album").textContent=`${song.album} · ${song.year}`;
  document.getElementById("btn-like").classList.toggle("liked",likedSongs.has(String(song.id)));
  const feats=[
    {label:"Dance",val:song.danceability,color:"#ff6b9d"},
    {label:"Energy",val:song.energy,color:"#b366ff"},
    {label:"Valence",val:song.valence,color:"#ffd700"},
    {label:"Acoustic",val:song.acousticness,color:"#00d4ff"},
    {label:"Live",val:song.liveness,color:"#00ffb3"},
  ];
  // Inline row layout to match slim CSS
  document.getElementById("audio-features").innerHTML=feats.map(f=>`
    <div class="feat-pill">
      <span class="feat-pill-label">${f.label}</span>
      <div class="feat-pill-bar"><div class="feat-pill-fill" style="width:${Math.round(f.val*100)}%;background:var(--pk)"></div></div>
      <span class="feat-pill-val">${Math.round(f.val*100)}%</span>
    </div>`).join("");
  // Update background accent
  const [c1,,c3]=pal(song);
  document.querySelector(".panel-center").style.setProperty("--song-c1",c1);
  document.querySelector(".panel-center").style.setProperty("--song-c3",c3);
}

async function getRecs(songId){
  const d=await apiFetch("/recommend",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({song_id:String(songId),session_id:SESSION_ID,n:8,mood_filter:currentMood||null})});
  if(!d)return;

  // Rebuild queue with seed + ALL recommendations
  queue.clear();
  queue.push(d.seed_song);
  d.recommendations.forEach(r=>queue.push(r));
  queue.setCurrent(songId);
  renderQueue();

  document.getElementById("recs-section").style.display="block";
  document.getElementById("engine-chip").textContent=d.engine_info?.mode||"AI";
  document.getElementById("recs-list").innerHTML=d.recommendations.map(r=>`
    <div class="rec-item" onclick="selectSong('${r.id}')">
      <img class="rec-art" src="${artURL(r,80)}" alt="${r.name}"/>
      <div class="rec-info">
        <div class="rec-name">${r.name}</div>
        <div class="rec-artist">${r.artist} · ${r.genre}</div>
      </div>
      <span class="rec-add" onclick="event.stopPropagation();addSpecificToQueue(${r.id})" title="Add">+</span>
    </div>`).join("");
  updateEnginePanel(d.engine_info);
}

// ——— Queue ————————————————————————————————————————————————————————
function renderQueue(){
  const items=queue.toArray();
  const ql=document.getElementById("queue-list");
  if(!items.length){ql.innerHTML='<p class="queue-empty">Queue is empty</p>';return;}
  document.getElementById("queue-count").textContent=items.length+" songs";
  ql.innerHTML=items.map((s,i)=>{
    const isCur=queue.current&&String(queue.current.song.id)===String(s.id);
    return`<div class="queue-item${isCur?" current":""}" onclick="queueJump('${s.id}')">
      <span class="queue-idx">${isCur?'▶':i+1}</span>
      <img class="queue-art" src="${artURL(s,68)}" alt="${s.name}"/>
      <div class="queue-meta"><div class="queue-name">${s.name}</div><div class="queue-artist">${s.artist}</div></div>
      ${isCur?'<div class="queue-bars"><span></span><span></span><span></span></div>':""}
    </div>`;
  }).join("");
}

function queueNext(){ const s=queue.goNext(); if(s){isAutoAdvancing=true;selectSong(s.id);}else toast("End of queue","🎵"); }
function queuePrev(){ const s=queue.goPrev(); if(s){isAutoAdvancing=true;selectSong(s.id);} }
function queueJump(id){ queue.setCurrent(id); selectSong(id); }
function addToPlaylist(){
  if(!currentSong)return;
  if(!queue.toArray().find(s=>String(s.id)===String(currentSong.id))){queue.push(currentSong);renderQueue();toast("Added to queue","➕");}
  sendInteraction("add_playlist");
}
function addSpecificToQueue(songId){
  const song=allSongs.find(s=>Number(s.id)===Number(songId));
  if(!song)return;
  if(!queue.toArray().find(s=>String(s.id)===String(songId))){queue.push(song);renderQueue();toast(`Added ${song.name}`,"➕");}
}

// ——— Search ———————————————————————————————————————————————————————
const SI=document.getElementById("search-input"),SD=document.getElementById("search-dropdown");
let ST;
SI.addEventListener("input",()=>{clearTimeout(ST);const q=SI.value.trim();if(!q){SD.classList.add("hidden");return;}ST=setTimeout(()=>doSearch(q),250);});
SI.addEventListener("blur",()=>setTimeout(()=>SD.classList.add("hidden"),200));
SI.addEventListener("focus",()=>{if(SI.value.trim())doSearch(SI.value.trim());});
async function doSearch(q){
  const d=await apiFetch(`/songs/search?q=${encodeURIComponent(q)}`);
  if(!d?.songs?.length){SD.classList.add("hidden");return;}
  SD.innerHTML=d.songs.slice(0,8).map(s=>`
    <div class="search-item" onclick="searchSel('${s.id}')">
      <img class="search-item-art" src="${artURL(s,72)}"/>
      <div><div class="search-item-name">${s.name}</div><div class="search-item-sub">${s.artist} · ${s.genre}</div></div>
    </div>`).join("");
  SD.classList.remove("hidden");
}
function searchSel(id){SD.classList.add("hidden");SI.value="";sendInteraction("search_click",id);selectSong(id);}

// ——— Engine ———————————————————————————————————————————————————————
function updateEnginePanel(info){
  const cw=Math.round((info.content_weight??1)*100);
  const colw=Math.round((info.collaborative_weight??0)*100);
  const total=info.total_interactions??0;
  const mode=info.mode??"content";
  document.getElementById("content-bar").style.width=cw+"%";
  document.getElementById("collab-bar").style.width=colw+"%";
  document.getElementById("content-pct").textContent=cw+"%";
  document.getElementById("collab-pct").textContent=colw+"%";
  document.getElementById("engine-label").textContent=
    mode==="content"?"Log Pose Active":mode==="collaborative"?"Navigator AI":"Hybrid Navigator";
  const hints={
    content:`🗺️ ${Math.max(0,10-total)} more plays to unlock the Navigator AI`,
    hybrid:`⚡ Hybrid Navigator active — ${total} sea miles logged`,
    collaborative:`🏴‍☠️ Full Grand Line AI — ${total} voyages analysed`,
  };
  document.getElementById("engine-hint").textContent=hints[mode]||hints.hybrid;
}
async function updateEngineStatus(){
  const d=await apiFetch(`/engine-status?session_id=${SESSION_ID}`);
  if(d)updateEnginePanel(d);
  const s=await apiFetch("/stats");
  if(s)document.getElementById("stats-row").innerHTML=`
    <div class="stat-pill"><div class="stat-pill-val">${s.total_songs}</div><div class="stat-pill-label">Songs</div></div>
    <div class="stat-pill"><div class="stat-pill-val">${s.total_interactions}</div><div class="stat-pill-label">Plays</div></div>
    <div class="stat-pill"><div class="stat-pill-val">${s.total_sessions}</div><div class="stat-pill-label">Users</div></div>`;
}

async function loadTrending(){
  const d=await apiFetch("/trending?limit=12");
  if(!d)return;
  document.getElementById("trending-list").innerHTML=d.songs.map(s=>`
    <div class="trending-item" onclick="selectSong('${s.id}')">
      <img class="trending-art" id="trend-art-${s.id}" src="${artURL(s,220)}" alt="${s.name}"/>
      <div class="trending-name">${s.name}</div>
      <div class="trending-artist">${s.artist}</div>
    </div>`).join("");
  // Progressively load real iTunes art for trending items
  for(const s of d.songs){
    if(previewCache[s.id]?.album_art){
      const img=document.getElementById(`trend-art-${s.id}`);
      if(img) img.src=previewCache[s.id].album_art;
      continue;
    }
    const p=await apiFetch(`/preview/${s.id}`);
    if(p){
      previewCache[s.id]=p;
      if(p.album_art){
        const img=document.getElementById(`trend-art-${s.id}`);
        if(img){ const t=new Image(); t.onload=()=>{img.src=p.album_art;}; t.src=p.album_art; }
      }
    }
  }
}

loadSongs();
setInterval(updateEngineStatus,30000);
