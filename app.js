(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const STORAGE = "puzzleme.v1";
  const META_KEY = "puzzleme.v2.meta";
  const SAVE_KEY = "puzzleme.v2.save";
  const THEME_KEY = "puzzleme.theme";
  const SCHEMA = 2;
  const MAX_FILE_BYTES = 12*1024*1024;
  const MAX_IMAGE_EDGE = 1600;
  const MAX_DATA_URL = 1800000;
  const TAB_DEPTH = 0.22;
  const TAB_MARGIN = 0.27;
  const MAX_PIECE_BITMAP = 720;
  const SNAP_MS = 300;
  const MOLD_STROKE = 2.5;
  const PIECE_STROKE = 3;
  const PIECE_STROKE_INNER = 1.5;
  const PLACED_STROKE = 1.75;
  const PLACED_STROKE_INNER = .9;
  const FOCUS_STROKE = 3.5;
  const HINT_STROKE = 4;
  const defaults = {profile:{name:"Player",avatar:"P"},records:[],saved:null,wins:0};
  let loadWarning = "";
  let data = loadData(), image = null, imageUrl = "", imageData = "", pieces = [];
  let rows=4, cols=4, total=16, selected=null, dragging=null, hintPiece=null;
  let elapsed=0, startedAt=0, timerInterval=null, soundOn=true, zoom=1, completed=false, gameActive=false;
  let canvas,ctx,board={x:0,y:0,w:0,h:0},tray={x:0,y:0,w:0,h:0},trayMode="bottom";
  let audioCtx=null, toastTimer=null, lastFocus=null, lastSaveAt=0, lastSaveError=0, resuming=false, autoResumeDone=false;
  let molds=null, moldCtx=null, animating=false, palette=null, themeQuery=null;

  function parseStored(key){
    let raw=null;
    try{raw=localStorage.getItem(key);}catch{return {exists:false,ok:false,raw:null,value:null};}
    if(raw==null)return {exists:false,ok:false,raw:null,value:null};
    try{return {exists:true,ok:true,raw,value:JSON.parse(raw)};}
    catch{return {exists:true,ok:false,raw,value:null};}
  }
  function normalizeMeta(value){
    const m=value&&typeof value==="object"?value:{};
    return {profile:{...defaults.profile,...(m.profile&&typeof m.profile==="object"?m.profile:{})},records:Array.isArray(m.records)?m.records:[],wins:Number.isFinite(m.wins)?m.wins:(Array.isArray(m.records)?m.records.length:0)};
  }
  function metaFrom(value){return {schemaVersion:SCHEMA,profile:value.profile,records:value.records,wins:value.wins||0};}
  function migrateSave(value){
    if(!value||typeof value!=="object")return null;
    const out={...value,schemaVersion:SCHEMA};
    out.rows=Number.isInteger(out.rows)?out.rows:0;
    out.cols=Number.isInteger(out.cols)?out.cols:0;
    out.total=out.rows*out.cols;
    out.elapsed=Number.isFinite(out.elapsed)?out.elapsed:0;
    out.pieces=Array.isArray(out.pieces)?out.pieces:[];
    return out;
  }
  function isValidSave(value){
    const s=value;
    if(!s||typeof s.image!=="string"||!s.image.startsWith("data:image/"))return false;
    if(!Number.isInteger(s.rows)||s.rows<1||!Number.isInteger(s.cols)||s.cols<1)return false;
    if(!Array.isArray(s.pieces)||s.pieces.length!==s.rows*s.cols)return false;
    return s.pieces.every(p=>p&&Number.isInteger(p.id)&&Number.isInteger(p.r)&&Number.isInteger(p.c)&&Number.isFinite(p.srcX)&&Number.isFinite(p.srcY)&&Number.isFinite(p.srcW)&&Number.isFinite(p.srcH)&&Number.isFinite(p.correctX)&&Number.isFinite(p.correctY)&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.rotation||0));
  }
  function loadData(){
    const meta=parseStored(META_KEY),save=parseStored(SAVE_KEY),legacy=parseStored(STORAGE);
    let out=structuredClone(defaults);
    if(meta.exists&&!meta.ok)loadWarning="No se pudieron leer el perfil ni los récords. Se conservó la copia existente.";
    if(save.exists&&!save.ok)loadWarning="La partida guardada está dañada; se conserva sin borrar.";
    if(meta.ok&&meta.value)out={...out,...normalizeMeta(meta.value)};
    else if(legacy.ok&&legacy.value)out={...out,...normalizeMeta(legacy.value)};
    if(save.ok&&save.value)out.saved=migrateSave(save.value);
    else if(legacy.ok&&legacy.value&&legacy.value.saved)out.saved=migrateSave(legacy.value.saved);
    if(legacy.ok&&legacy.value){
      try{
        if(!meta.exists){
          localStorage.setItem(META_KEY,JSON.stringify(metaFrom(out)));
          if(!meta.ok)loadWarning=loadWarning||"No se pudieron migrar el perfil ni los récords.";
        }
        if(out.saved&&!save.exists)localStorage.setItem(SAVE_KEY,JSON.stringify(out.saved));
        const metaOk=parseStored(META_KEY).ok,saveOk=!out.saved||parseStored(SAVE_KEY).ok;
        if(metaOk&&saveOk)localStorage.removeItem(STORAGE);
      }catch{loadWarning=loadWarning||"No se pudo migrar el guardado anterior; se conserva la copia antigua.";}
    }
    return out;
  }
  function persistMeta(){
    try{
      localStorage.setItem(META_KEY,JSON.stringify(metaFrom(data)));
      if(!data.saved||localStorage.getItem(SAVE_KEY))localStorage.removeItem(STORAGE);
    }catch{notify("No se pudieron guardar el perfil y los récords.");}
  }
  function persistSave(){
    if(!data.saved)return false;
    const raw=JSON.stringify(data.saved);
    try{localStorage.setItem(SAVE_KEY,raw);if(parseStored(META_KEY).ok)localStorage.removeItem(STORAGE);return true;}
    catch{
      let legacyRaw=null;
      try{
        if(!parseStored(META_KEY).ok)localStorage.setItem(META_KEY,JSON.stringify(metaFrom(data)));
        const metaOk=parseStored(META_KEY).ok;
        legacyRaw=localStorage.getItem(STORAGE);
        if(legacyRaw&&metaOk)localStorage.removeItem(STORAGE);
        localStorage.setItem(SAVE_KEY,raw);return true;
      }catch{
        if(legacyRaw)try{localStorage.setItem(STORAGE,legacyRaw);}catch{}
        const now=Date.now();
        if(now-lastSaveError>5000){lastSaveError=now;notify("No se pudo guardar el avance. La imagen puede ser demasiado grande; se conservó el último guardado.");}
        return false;
      }
    }
  }
  function clearSaved(){data.saved=null;try{localStorage.removeItem(SAVE_KEY);localStorage.removeItem(STORAGE);}catch{}}
  function fmt(sec){
    const n=Number(sec);
    if(!Number.isFinite(n))return "00:00";
    const total=Math.max(0,Math.floor(n));
    const pad=(x)=>String(x).padStart(2,"0");
    const MINUTE=60,HOUR=60*MINUTE,DAY=24*HOUR,MONTH=30*DAY;
    if(total<HOUR)return `${pad(Math.floor(total/MINUTE))}:${pad(total%MINUTE)}`;
    const hh=pad(Math.floor(total%DAY/HOUR)),mm=pad(Math.floor(total%HOUR/MINUTE)),ss=pad(total%MINUTE);
    if(total<DAY)return `${hh}:${mm}:${ss}`;
    if(total<MONTH)return `${Math.floor(total/DAY)}d ${hh}:${mm}:${ss}`;
    const months=Math.floor(total/MONTH),days=Math.floor(total%MONTH/DAY);
    return `${months.toLocaleString("es-MX")} ${months===1?"mes":"meses"}${days?` ${days}d`:""} ${hh}:${mm}:${ss}`;
  }
  function notify(msg){const el=$("toast");el.textContent=msg;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2600);}
  function cssColor(name,fallback){const value=getComputedStyle(document.documentElement).getPropertyValue(name).trim();return value||fallback;}
  function readPalette(){
    return {
      bg:cssColor("--canvas-bg","#0E1011"),
      board:cssColor("--canvas-board","#171A1B"),
      boardLine:cssColor("--canvas-board-line","rgba(255,176,0,.35)"),
      mold:cssColor("--canvas-mold","#0D0E10"),
      moldLine:cssColor("--canvas-mold-line","#33302A"),
      hint:cssColor("--canvas-hint","#FFC400"),
      focus:cssColor("--canvas-focus","#FFC400"),
      focusShadow:cssColor("--canvas-focus-shadow","rgba(255,176,0,.55)"),
      pieceShadow:cssColor("--canvas-piece-shadow","rgba(0,0,0,.55)"),
      pieceLine:cssColor("--canvas-piece-line","rgba(255,255,255,.5)"),
      pieceLineShadow:cssColor("--canvas-piece-line-shadow","rgba(0,0,0,.65)"),
      glowFill:cssColor("--canvas-glow-fill","#FFB000"),
      glowShadow:cssColor("--canvas-glow-shadow","#FFB000"),
      glowStroke:cssColor("--canvas-glow-stroke","#FFD264")
    };
  }
  function getPalette(){if(!palette)palette=readPalette();return palette;}
  function applyTheme(theme,persist=false){
    const next=theme==="light"?"light":"dark";
    document.documentElement.dataset.theme=next;
    if(persist)try{localStorage.setItem(THEME_KEY,next);}catch{}
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=next==="light"?"#F4EEE1":"#0B0D0E";
    const toggle=$("themeToggle");
    if(toggle){
      const light=next==="light";
      toggle.setAttribute("aria-pressed",String(light));
      toggle.setAttribute("aria-label",`Cambiar a modo ${light?"oscuro":"claro"}`);
      const label=toggle.querySelector(".theme-label");
      if(label)label.textContent=light?"Oscuro":"Claro";
    }
    palette=readPalette();
    if(canvas&&image){
      if(molds)buildMolds();
      draw();
    }
  }
  function initTheme(){
    themeQuery=matchMedia("(prefers-color-scheme: light)");
    let saved=null;
    try{saved=localStorage.getItem(THEME_KEY);}catch{}
    applyTheme(saved==="light"||saved==="dark"?saved:(themeQuery.matches?"light":"dark"),false);
    const toggle=$("themeToggle");
    if(toggle)toggle.addEventListener("click",()=>applyTheme(document.documentElement.dataset.theme==="light"?"dark":"light",true));
    const onSystemChange=(event)=>{
      let current=null;
      try{current=localStorage.getItem(THEME_KEY);}catch{}
      if(current!=="light"&&current!=="dark")applyTheme(event.matches?"light":"dark",false);
    };
    if(themeQuery.addEventListener)themeQuery.addEventListener("change",onSystemChange);
    else if(themeQuery.addListener)themeQuery.addListener(onSystemChange);
  }
  function modal(id,open=true){
    const el=$(id);
    el.classList.toggle("open",open);
    if(open){
      lastFocus=document.activeElement;
      const target=el.querySelector("input:not([type=hidden]),button:not([data-close])")||el.querySelector("button");
      if(target)setTimeout(()=>target.focus(),0);
    }else if(lastFocus){lastFocus.focus();lastFocus=null;}
  }
  function showScreen(id){document.querySelectorAll(".screen").forEach(x=>x.classList.remove("active"));$(id).classList.add("active");document.body.classList.toggle("in-game",id==="gameScreen");}
  function profileUI(){const p=data.profile;const wins=data.wins||data.records.length;$("profileName").textContent=p.name;$("profileNameSmall").textContent=p.name;$("avatarSmall").textContent=p.avatar;$("avatarLarge").textContent=p.avatar;$("statWins").textContent=wins;$("profileStats").textContent=`${wins} puzzles completados`;$("statTime").textContent=data.records.length?fmt(Math.min(...data.records.map(r=>r.time))):"—";renderRecords();}
  function renderRecords(){const sorted=[...data.records].sort((a,b)=>a.time-b.time);const make=(r)=>`<div class="record-row"><div><strong>${escapeHtml(r.title||"Rompecabezas")}</strong><small>${r.pieces} piezas · ${new Date(r.date).toLocaleDateString("es-MX")}</small></div><span class="record-time">${fmt(r.time)}</span></div>`;$("recentRecords").innerHTML=sorted.slice(0,3).map(make).join("")||'<div class="empty-state">Tus mejores partidas aparecerán aquí.</div>';$("allRecordsList").innerHTML=sorted.map(make).join("")||'<div class="empty-state">Aún no tienes récords.</div>';}
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function setDifficulty(){const v=$("difficulty").value;const sel=$("pieceCount");[...sel.options].forEach(o=>{const n=+o.value;o.hidden=v==="easy"?n>16:v==="medium"?(n<25||n>64):v==="hard"?n<100:false;});if(sel.selectedOptions[0]?.hidden)sel.value=v==="easy"?"16":v==="medium"?"25":"100";}
  function clearTimer(){clearInterval(timerInterval);timerInterval=null;}
  function stopTimer(){if(timerInterval)elapsed=currentTime();clearTimer();}
  function runTimer(){clearTimer();startedAt=Date.now();timerInterval=setInterval(()=>{$("timer").textContent=fmt(elapsed+Math.floor((Date.now()-startedAt)/1000));},500);}
  function currentTime(){return timerInterval?elapsed+Math.floor((Date.now()-startedAt)/1000):elapsed;}
  function prepareImage(src,done,fail){
    const img=new Image();
    img.onload=()=>{
      const scale=Math.min(1,MAX_IMAGE_EDGE/Math.max(img.width,img.height));
      if(scale===1&&src.length<MAX_DATA_URL){done(img,src,false);return;}
      const c=document.createElement("canvas");
      c.width=Math.max(1,Math.round(img.width*scale));
      c.height=Math.max(1,Math.round(img.height*scale));
      const cx=c.getContext("2d");
      cx.fillStyle="#ffffff";cx.fillRect(0,0,c.width,c.height);
      cx.drawImage(img,0,0,c.width,c.height);
      const out=c.toDataURL("image/jpeg",0.82);
      const small=new Image();
      small.onload=()=>done(small,out,true);
      small.onerror=()=>done(img,src,false);
      small.src=out;
    };
    img.onerror=()=>{notify(fail?"No se pudo restaurar la partida guardada. Los datos siguen guardados.":"No se pudo leer la imagen.");if(fail)fail();};
    img.src=src;
  }
  function imageLoaded(file){
    if(!file||!file.type.startsWith("image/"))return notify("Selecciona un archivo de imagen válido.");
    if(file.size>MAX_FILE_BYTES)return notify("La imagen supera los 12 MB. Elige una más ligera.");
    const reader=new FileReader();
    reader.onload=()=>prepareImage(reader.result,(img,dataUrl,optimized)=>{
      image=img;imageData=dataUrl;imageUrl=dataUrl;
      $("uploadThumb").src=imageUrl;$("uploadThumb").hidden=false;
      $("uploadTitle").textContent=file.name;
      $("uploadHint").textContent=`${img.width} × ${img.height} px${optimized?" · optimizada":""}`;
      $("startBtn").disabled=false;
    });
    reader.onerror=()=>notify("No se pudo leer la imagen.");
    reader.readAsDataURL(file);
  }
  function chooseGrid(n,aspect){let best=null;for(let r=1;r<=n;r++){if(n%r)continue;const c=n/r;const score=Math.abs((c/r)-aspect);if(!best||score<best.score)best={r,c,score};}return best||{r:Math.sqrt(n),c:Math.sqrt(n)};}
  function setupCanvas(){canvas=$("puzzleCanvas");ctx=canvas.getContext("2d");resizeCanvas();}
  function resizeCanvas(){if(!canvas)return;const rect=$("canvasWrap").getBoundingClientRect();const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(rect.width*dpr));canvas.height=Math.max(1,Math.round(rect.height*dpr));ctx.setTransform(dpr,0,0,dpr,0,0);layoutBoard();}
  function layoutBoard(){
    const w=$("canvasWrap").clientWidth,h=$("canvasWrap").clientHeight;
    const ar=image?image.width/image.height:1;
    const compact=w<720,gap=12,pad=8;
    const fit=(areaW,areaH)=>{
      areaW=Math.max(80,areaW);areaH=Math.max(80,areaH);
      let bw=Math.min(areaW,areaH*ar)*zoom,bh=bw/ar;
      if(bw>areaW){const f=areaW/bw;bw*=f;bh*=f;}
      if(bh>areaH){const f=areaH/bh;bw*=f;bh*=f;}
      return {w:bw,h:bh};
    };
    const trayW=Math.max(180,Math.min(260,w*.22));
    const trayH=Math.max(150,Math.min(220,h*.24));
    const rightArea={x:pad,y:pad,w:w-pad*2-gap-trayW,h:h-pad*2};
    const bottomArea={x:pad,y:pad,w:w-pad*2,h:h-pad*2-gap-trayH};
    const rightBoard=fit(rightArea.w,rightArea.h);
    const bottomBoard=fit(bottomArea.w,bottomArea.h);
    const useBottom=compact||bottomBoard.w>rightBoard.w*1.12;
    const area=useBottom?bottomArea:rightArea;
    const size=useBottom?bottomBoard:rightBoard;
    if(useBottom){
      trayMode="bottom";
      tray={x:pad,y:h-pad-trayH,w:w-pad*2,h:trayH};
    }else{
      trayMode="right";
      tray={x:w-pad-trayW,y:pad,w:trayW,h:h-pad*2};
    }
    board={x:area.x+(area.w-size.w)/2,y:area.y+(area.h-size.h)/2,w:size.w,h:size.h};
    const wrap=$("canvasWrap");
    wrap.dataset.tray=trayMode;
    wrap.style.setProperty("--tray-h",`${tray.h}px`);
  }
  function randEdge(){return Math.random()>.5?1:-1;}
  function shufflePieces(){
    for(let i=pieces.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [pieces[i],pieces[j]]=[pieces[j],pieces[i]];
    }
  }
  function ensureEdges(){
    const at=(r,c)=>pieces.find(p=>p.r===r&&p.c===c);
    if(pieces.every(p=>p.edgesReady&&p.edges))return;
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      const p=at(r,c),old=p.tab||p.edges||{};
      p.edges={
        top:r>0?(old.top||randEdge()):0,
        left:c>0?(old.left||randEdge()):0,
        right:c<cols-1?(old.right||randEdge()):0,
        bottom:r<rows-1?(old.bottom||randEdge()):0
      };
      p.edgesReady=true;
    }
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      const p=at(r,c);
      if(c<cols-1)at(r,c+1).edges.left=-p.edges.right;
      if(r<rows-1)at(r+1,c).edges.top=-p.edges.bottom;
    }
  }
  function edgeCurve(len,depth,value,canonical){
    if(!value)return canonical?[[0,0],[len,0]]:[[len,0],[0,0]];
    const u=[0,.17,.30,.38,.5,.62,.70,.83,1];
    const v=[0,0,.18,1,1.18,1,.18,0,0];
    const pts=u.map((f,i)=>[f*len,value*depth*v[i]]);
    return canonical?pts:pts.slice().reverse();
  }
  function smoothEdge(path,pts){
    if(pts.length<=2){for(const [x,y] of pts)path.lineTo(x,y);return;}
    for(let i=0;i<pts.length-1;i++){
      const p0=pts[Math.max(0,i-1)],p1=pts[i],p2=pts[i+1],p3=pts[Math.min(pts.length-1,i+2)];
      const c1=[p1[0]+(p2[0]-p0[0])/6,p1[1]+(p2[1]-p0[1])/6];
      const c2=[p2[0]-(p3[0]-p1[0])/6,p2[1]-(p3[1]-p1[1])/6];
      path.bezierCurveTo(c1[0],c1[1],c2[0],c2[1],p2[0],p2[1]);
    }
  }
  function buildPiecePath(p,w,h){
    const depth=TAB_DEPTH*Math.min(w,h),m=TAB_MARGIN*Math.min(w,h);
    const e=p.edges||{top:0,right:0,bottom:0,left:0};
    const edges=[
      edgeCurve(w,depth,e.top,true).map(([u,v])=>[m+u,m-v]),
      edgeCurve(h,depth,e.right,true).map(([u,v])=>[m+w+v,m+u]),
      edgeCurve(w,depth,e.bottom,false).map(([u,v])=>[m+u,m+h+v]),
      edgeCurve(h,depth,e.left,false).map(([u,v])=>[m-v,m+u])
    ];
    const path=new Path2D();
    path.moveTo(m,m);
    for(const pts of edges)smoothEdge(path,pts);
    path.closePath();
    return {path,margin:m,boxW:w+2*m,boxH:h+2*m};
  }
  function pieceOutline(p,w,h){
    if(p.outline&&p.outlineW===w&&p.outlineH===h)return p.outline;
    p.outline=buildPiecePath(p,w,h);p.outlineW=w;p.outlineH=h;
    return p.outline;
  }
  function buildBitmap(p){
    const srcW=p.srcW,srcH=p.srcH;
    const shape=buildPiecePath(p,srcW,srcH);
    const scale=Math.min(1,MAX_PIECE_BITMAP/Math.max(shape.boxW,shape.boxH));
    const c=document.createElement("canvas");
    c.width=Math.max(1,Math.round(shape.boxW*scale));
    c.height=Math.max(1,Math.round(shape.boxH*scale));
    const cx=c.getContext("2d");
    cx.scale(scale,scale);
    cx.save();
    cx.clip(shape.path);
    const m=shape.margin;
    cx.drawImage(image,p.srcX-m,p.srcY-m,shape.boxW,shape.boxH,0,0,shape.boxW,shape.boxH);
    cx.restore();
    p.bitmap=c;p.bitmapMargin=m;p.bitmapScale=scale;
  }
  function buildAllBitmaps(){for(const p of pieces)buildBitmap(p);}
  function createPieces(){
    const aspect=image.width/image.height;
    const g=chooseGrid(total,aspect);
    rows=g.r;cols=g.c;total=rows*cols;pieces=[];
    const sw=image.width/cols,sh=image.height/rows;
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      pieces.push({id:r*cols+c,r,c,srcX:c*sw,srcY:r*sh,srcW:sw,srcH:sh,correctX:c,correctY:r,x:0,y:0,rotation:0,placed:false,edges:{top:0,right:0,bottom:0,left:0}});
    }
    ensureEdges();buildAllBitmaps();shufflePieces();
  }
  function layoutPieces(){
    if(!canvas||!image)return;
    layoutBoard();
    const w=$("canvasWrap").clientWidth,h=$("canvasWrap").clientHeight;
    const cw=board.w/cols,ch=board.h/rows;
    for(const p of pieces){
      if(!p.placed)continue;
      p.x=board.x+p.correctX*cw;p.y=board.y+p.correctY*ch;p.w=cw;p.h=ch;p.margin=TAB_MARGIN*Math.min(cw,ch);
    }
    const remaining=pieces.filter(p=>!p.placed);
    if(!remaining.length){buildMolds();return;}
    const areaX=tray.x,areaY=tray.y,areaW=tray.w,areaH=tray.h;
    const aspect=remaining[0].srcH/remaining[0].srcW;
    let cellW=Math.max(24,Math.min(96,areaW/Math.max(1,Math.ceil(Math.sqrt(remaining.length)))));
    let cellH=cellW*aspect;
    let margin=TAB_MARGIN*Math.min(cellW,cellH);
    let colsTray=Math.max(1,Math.floor(areaW/(cellW+2*margin+4)));
    let rowsTray=Math.max(1,Math.floor(areaH/(cellH+2*margin+5)));
    while(Math.ceil(remaining.length/colsTray)>rowsTray&&cellW>8){
      cellW*=.9;cellH=cellW*aspect;margin=TAB_MARGIN*Math.min(cellW,cellH);
      colsTray=Math.max(1,Math.floor(areaW/(cellW+2*margin+4)));
      rowsTray=Math.max(1,Math.floor(areaH/(cellH+2*margin+5)));
    }
    const stepX=cellW+2*margin+4,stepY=cellH+2*margin+5;
    const blockW=Math.min(colsTray,remaining.length)*stepX;
    const blockH=Math.ceil(remaining.length/colsTray)*stepY;
    const originX=areaX+Math.max(0,(areaW-blockW)/2);
    const originY=areaY+Math.max(0,(areaH-blockH)/2);
    remaining.forEach((p,i)=>{
      p.w=cellW;p.h=cellH;p.margin=margin;
      if(p.preserveXY){
        p.x=Math.max(0,Math.min(w-p.w,p.x));
        p.y=Math.max(0,Math.min(h-p.h,p.y));
      }else{
        const row=Math.floor(i/colsTray);
        const inRow=Math.min(colsTray,remaining.length-row*colsTray);
        const rowOffset=(blockW-inRow*stepX)/2;
        p.x=originX+rowOffset+(i%colsTray)*stepX;
        p.y=originY+row*stepY;
      }
      const shape=buildPiecePath(p,cellW,cellH);
      p.hitPath=shape.path;p.hitMargin=shape.margin;
    });
    buildMolds();
  }
  function buildMolds(){
    if(!canvas)return;
    if(!molds){molds=document.createElement("canvas");moldCtx=molds.getContext("2d");}
    molds.width=canvas.width;molds.height=canvas.height;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    moldCtx.setTransform(dpr,0,0,dpr,0,0);
    moldCtx.clearRect(0,0,canvas.width/dpr,canvas.height/dpr);
    const cw=board.w/cols,ch=board.h/rows;
    const pal=getPalette();
    for(const p of pieces){
      if(p.placed)continue;
      const shape=buildPiecePath(p,cw,ch);
      moldCtx.save();
      moldCtx.translate(board.x+p.correctX*cw-shape.margin,board.y+p.correctY*ch-shape.margin);
      moldCtx.fillStyle=pal.mold;moldCtx.fill(shape.path);
      moldCtx.lineJoin="round";
      moldCtx.strokeStyle=pal.moldLine;moldCtx.lineWidth=MOLD_STROKE;moldCtx.stroke(shape.path);
      moldCtx.restore();
    }
  }
  function draw(){
    if(!ctx||!image)return;
    const w=$("canvasWrap").clientWidth,h=$("canvasWrap").clientHeight;
    const pal=getPalette();
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle=pal.bg;ctx.fillRect(0,0,w,h);
    ctx.fillStyle=pal.board;ctx.fillRect(board.x,board.y,board.w,board.h);
    ctx.strokeStyle=pal.boardLine;ctx.lineWidth=1.5;ctx.setLineDash([5,5]);ctx.strokeRect(board.x,board.y,board.w,board.h);ctx.setLineDash([]);
    if(molds)ctx.drawImage(molds,0,0,w,h);
    const animatingPieces=[];
    for(const p of pieces){if(!p.placed)continue;if(p.snapStart)animatingPieces.push(p);else drawPiece(p,false,true);}
    for(const p of pieces){if(!p.placed)drawPiece(p);}
    for(const p of pieces){if(p.placed)continue;if(p===selected||p===dragging)drawPiece(p,true);}
    for(const p of animatingPieces)drawPiece(p,false,true);
    if(hintPiece&&!hintPiece.placed){ctx.strokeStyle=pal.hint;ctx.lineWidth=HINT_STROKE;ctx.lineJoin="round";const shape=buildPiecePath(hintPiece,board.w/cols,board.h/rows);ctx.save();ctx.translate(board.x+hintPiece.correctX*board.w/cols-shape.margin,board.y+hintPiece.correctY*board.h/rows-shape.margin);ctx.stroke(shape.path);ctx.restore();}
  }
  function drawPiece(p,focus=false,placed=false){
    if(!p.bitmap)return;
    const pal=getPalette();
    const x=p.x,y=p.y,w=p.w||board.w/cols,h=p.h||board.h/rows;
    const outline=pieceOutline(p,w,h),m=outline.margin;
    let scale=1,glow=0;
    if(placed&&p.snapStart){
      const t=Math.min(1,(performance.now()-p.snapStart)/SNAP_MS);
      scale=1+.09*(1-t);glow=1-t;
    }
    ctx.save();
    ctx.translate(x+w/2,y+h/2);ctx.rotate(p.rotation*Math.PI/180);
    if(scale!==1)ctx.scale(scale,scale);
    ctx.translate(-w/2-m,-h/2-m);
    ctx.shadowColor=focus?pal.focusShadow:placed?"transparent":pal.pieceShadow;ctx.shadowBlur=focus?16:placed?0:7;ctx.shadowOffsetY=focus?4:2;
    ctx.drawImage(p.bitmap,0,0,w+2*m,h+2*m);
    ctx.shadowColor="transparent";
    ctx.lineJoin="round";ctx.lineCap="round";
    ctx.strokeStyle=pal.pieceLineShadow;ctx.lineWidth=placed?PLACED_STROKE:PIECE_STROKE;ctx.stroke(outline.path);
    ctx.strokeStyle=pal.pieceLine;ctx.lineWidth=placed?PLACED_STROKE_INNER:PIECE_STROKE_INNER;ctx.stroke(outline.path);
    if(glow>0){
      ctx.save();
      ctx.globalCompositeOperation=document.documentElement.dataset.theme==="light"?"source-over":"lighter";
      ctx.globalAlpha=glow;
      ctx.fillStyle=pal.glowFill;ctx.fill(outline.path);
      ctx.shadowColor=pal.glowShadow;ctx.shadowBlur=22*glow;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
      ctx.globalAlpha=glow*.85;
      ctx.strokeStyle=pal.glowStroke;ctx.lineWidth=2;ctx.stroke(outline.path);
      ctx.restore();
    }else if(focus){
      ctx.save();
      ctx.strokeStyle=pal.focus;ctx.lineWidth=FOCUS_STROKE;ctx.stroke(outline.path);
      ctx.restore();
    }
    ctx.restore();
  }
  function animateSnaps(){
    if(animating)return;
    animating=true;
    const step=()=>{
      const active=pieces.filter(p=>p.snapStart&&performance.now()-p.snapStart<SNAP_MS);
      if(!active.length){animating=false;for(const p of pieces)if(p.snapStart)p.snapStart=null;draw();return;}
      draw();requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function begin(resume=false){
    if(!imageData&&!resume)return notify("Primero sube una imagen.");
    gameActive=true;imageUrl=imageData;
    if(!resume)zoom=1;
    $("zoomLabel").textContent=`${Math.round(zoom*100)}%`;
    if(!resume){stopTimer();elapsed=0;completed=false;total=+$("pieceCount").value;createPieces();}
    showScreen("gameScreen");setupCanvas();layoutPieces();draw();
    $("gameTitle").textContent="Tu rompecabezas";
    $("gameSubtitle").textContent=`${total} piezas · ${difficultyLabel(total)}`;
    $("timer").textContent=fmt(elapsed);
    $("progressText").textContent=`${pieces.filter(p=>p.placed).length} / ${total} piezas`;
    $("trayCount").textContent=pieces.filter(p=>!p.placed).length;
    $("referenceImage").src=imageUrl;$("previewLarge").src=imageUrl;
    $("canvasHint").style.display=pieces.some(p=>p.placed)?"none":"block";
    runTimer();saveGame(true);
  }
  function difficultyLabel(n){return n<=16?"Fácil":n<=64?"Media":"Difícil";}
  function saveGame(force=false){
    if(!gameActive||!imageData||!pieces.length||completed)return;
    if(imageData.length>MAX_DATA_URL)return notify("La imagen es demasiado grande para guardarla. Usa una fotografía más ligera.");
    const now=Date.now();
    if(!force&&now-lastSaveAt<400)return;
    lastSaveAt=now;
    const savedPieces=pieces.map(p=>({id:p.id,r:p.r,c:p.c,srcX:p.srcX,srcY:p.srcY,srcW:p.srcW,srcH:p.srcH,correctX:p.correctX,correctY:p.correctY,x:p.x,y:p.y,rotation:p.rotation,placed:p.placed,edges:p.edges,edgesReady:p.edgesReady}));
    data.saved={schemaVersion:SCHEMA,savedAt:new Date().toISOString(),image:imageData,pieces:savedPieces,rows,cols,total,elapsed:currentTime(),zoom,title:$("uploadTitle").textContent,shuffled:true};
    return persistSave();
  }
  function restorePositions(savedPieces){
    const w=$("canvasWrap").clientWidth,h=$("canvasWrap").clientHeight;
    const byId=new Map(savedPieces.filter(p=>!p.placed).map(p=>[p.id,{x:p.x,y:p.y}]));
    let moved=false;
    for(const p of pieces){
      if(p.placed)continue;
      const pos=byId.get(p.id);if(!pos)continue;
      const nx=Math.max(0,Math.min(w-p.w,pos.x)),ny=Math.max(0,Math.min(h-p.h,pos.y));
      if(nx!==p.x||ny!==p.y){p.x=nx;p.y=ny;moved=true;}
      p.preserveXY=true;
    }
    if(moved)draw();
  }
  function resumeGame(auto=false){
    const s=data.saved;
    if(!s||resuming||(auto&&autoResumeDone))return;
    if(auto)autoResumeDone=true;
    if(!isValidSave(s)){notify("La partida guardada no se pudo restaurar. Se conservará hasta que inicies otra.");return;}
    resuming=true;
    const savedPositions=s.shuffled?s.pieces.map(p=>({id:p.id,x:p.x,y:p.y,placed:p.placed})):null;
    prepareImage(s.image,(img,dataUrl)=>{
      image=img;imageData=dataUrl;
      pieces=s.pieces;rows=s.rows;cols=s.cols;total=s.total;elapsed=s.elapsed||0;zoom=Number.isFinite(s.zoom)?Math.max(.7,Math.min(1.35,s.zoom)):1;
      for(const p of pieces)p.snapStart=null;
      ensureEdges();
      if(!s.shuffled)shufflePieces();
      buildAllBitmaps();
      selected=null;dragging=null;hintPiece=null;completed=false;
      $("uploadTitle").textContent=s.title||"Partida guardada";
      $("uploadThumb").src=dataUrl;$("uploadThumb").hidden=false;
      $("uploadHint").textContent=`${img.width} × ${img.height} px · partida guardada`;
      $("startBtn").disabled=false;
      begin(true);
      if(savedPositions)restorePositions(savedPositions);
      const savedOk=saveGame(true);
      resuming=false;
      if(auto)notify(savedOk?"Partida restaurada.":"Partida restaurada, pero no se pudo volver a guardar.");
    },()=>{resuming=false;});
  }
  function placePiece(p){
    const cw=board.w/cols,ch=board.h/rows;
    const targetX=board.x+p.correctX*cw,targetY=board.y+p.correctY*ch;
    const cx=p.x+(p.w||cw)/2,cy=p.y+(p.h||ch)/2;
    const expectedX=targetX+cw/2,expectedY=targetY+ch/2;
    const dist=Math.hypot(cx-expectedX,cy-expectedY);
    if(dist<Math.max(cw,ch)*.42&&p.rotation%360===0){
      p.placed=true;p.x=targetX;p.y=targetY;p.w=cw;p.h=ch;p.margin=TAB_MARGIN*Math.min(cw,ch);
      p.snapStart=performance.now();
      selected=null;hintPiece=null;
      sound("snap");
      const done=pieces.filter(x=>x.placed).length;
      $("progressText").textContent=`${done} / ${total} piezas`;
      $("trayCount").textContent=total-done;
      if(done>0)$("canvasHint").style.display="none";
      for(const x of pieces)if(!x.placed)x.preserveXY=false;
      layoutPieces();
      draw();animateSnaps();
      setTimeout(()=>{p.snapStart=null;draw();},SNAP_MS+40);
      saveGame(true);
      if(done===total)win();
    }else{
      draw();saveGame(true);
    }
  }
  function win(){completed=true;gameActive=false;stopTimer();elapsed=currentTime();const record={title:$("uploadTitle").textContent,pieces:total,time:elapsed,date:new Date().toISOString()};data.wins=(data.wins||data.records.length)+1;data.records.push(record);data.records=data.records.sort((a,b)=>a.time-b.time).slice(0,50);clearSaved();persistMeta();profileUI();$("winTime").textContent=fmt(elapsed);$("winMessage").textContent=`Completaste el rompecabezas de ${total} piezas.`;modal("winModal");sound("win");}
  function sound(type){
    if(!soundOn)return;
    try{
      audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==="suspended")audioCtx.resume();
      const now=audioCtx.currentTime;
      const play=(freq,start,dur,vol,wave="sine")=>{
        const o=audioCtx.createOscillator(),g=audioCtx.createGain();
        o.type=wave;o.frequency.setValueAtTime(freq,start);
        if(type==="snap")o.frequency.exponentialRampToValueAtTime(freq*.45,start+dur);
        o.connect(g);g.connect(audioCtx.destination);
        g.gain.setValueAtTime(.0001,start);
        g.gain.exponentialRampToValueAtTime(vol,start+.006);
        g.gain.exponentialRampToValueAtTime(.0001,start+dur);
        o.start(start);o.stop(start+dur+.01);
      };
      if(type==="snap"){
        play(1050,now,.045,.08,"triangle");
        play(520,now+.028,.07,.06,"sine");
      }else{
        const notes=type==="win"?[523,659,784]:[240];
        notes.forEach((n,i)=>play(n,now+i*.12,.18,.07));
      }
    }catch{}
  }
  function pointerPos(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  function hitTest(pt){
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    let found=null;
    for(let i=pieces.length-1;i>=0;i--){
      const p=pieces[i];
      if(p.placed||!p.hitPath)continue;
      const w=p.w,h=p.h,m=p.hitMargin,cx=p.x+w/2,cy=p.y+h/2;
      if(pt.x<p.x-m||pt.x>p.x+w+m||pt.y<p.y-m||pt.y>p.y+h+m)continue;
      const matrix=new DOMMatrix()
        .translate(cx,cy).rotate(p.rotation)
        .translate(-cx,-cy).translate(p.x-m,p.y-m);
      const path=new Path2D();path.addPath(p.hitPath,matrix);
      if(ctx.isPointInPath(path,pt.x,pt.y)){found=p;break;}
    }
    ctx.restore();
    return found;
  }
  function pointerDown(e){const pt=pointerPos(e);const p=hitTest(pt);if(!p)return;selected=p;dragging=p;p.offsetX=pt.x-p.x;p.offsetY=pt.y-p.y;canvas.setPointerCapture(e.pointerId);draw();}
  function pointerMove(e){if(!dragging)return;const pt=pointerPos(e);dragging.x=pt.x-dragging.offsetX;dragging.y=pt.y-dragging.offsetY;draw();}
  function pointerUp(e){if(!dragging)return;if(e&&canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);const p=dragging;dragging=null;placePiece(p);}
  function rotateSelected(){if(!selected||selected.placed)return;selected.rotation=(selected.rotation+90)%360;draw();sound("drop");saveGame(true);}
  function hint(){const candidates=pieces.filter(x=>!x.placed);if(!candidates.length)return;const p=candidates[Math.floor(Math.random()*candidates.length)];hintPiece=p;selected=p;draw();notify("La pista marca la posición de una pieza.");setTimeout(()=>{hintPiece=null;draw();},1800);}
  function resetGame(){if(!confirm("¿Reiniciar el rompecabezas? Se perderá el avance actual."))return;stopTimer();elapsed=0;completed=false;pieces.forEach(p=>{p.placed=false;p.rotation=0;p.snapStart=null;p.preserveXY=false;});shufflePieces();layoutPieces();selected=null;draw();runTimer();saveGame(true);$("progressText").textContent=`0 / ${total} piezas`;$("trayCount").textContent=total;$("canvasHint").style.display="block";}
  function openProfile(){ $("playerName").value=data.profile.name;$("playerAvatar").value=data.profile.avatar;modal("profileModal");}
  function goHome(){saveGame(true);gameActive=false;stopTimer();showScreen("homeScreen");profileUI();}
  function resetHome(){
    stopTimer();
    gameActive=false;image=null;imageData="";imageUrl="";pieces=[];elapsed=0;completed=false;
    selected=null;dragging=null;hintPiece=null;molds=null;animating=false;
    $("imageInput").value="";
    $("uploadThumb").removeAttribute("src");$("uploadThumb").hidden=true;
    $("uploadTitle").textContent="Sube una fotografía";
    $("uploadHint").textContent="JPG, PNG o WEBP · Máximo recomendado 5 MB";
    $("startBtn").disabled=true;
    $("resumeBtn").hidden=!data.saved;
    $("canvasHint").style.display="block";
    showScreen("homeScreen");profileUI();
  }
  function resetAll(){
    if(!confirm("¿Restablecer todo? Se borrarán partida, perfil, récords y tema guardado."))return;
    stopTimer();
    try{
      localStorage.removeItem(SAVE_KEY);localStorage.removeItem(META_KEY);
      localStorage.removeItem(STORAGE);localStorage.removeItem(THEME_KEY);
    }catch{}
    data={profile:{name:"Player",avatar:"P"},records:[],saved:null,wins:0};
    loadWarning="";lastSaveAt=0;lastSaveError=0;autoResumeDone=false;
    rows=4;cols=4;total=16;soundOn=true;zoom=1;
    $("difficulty").value="all";$("pieceCount").value="16";setDifficulty();
    $("soundBtn").textContent="Sonido: sí";$("soundBtn").setAttribute("aria-pressed","true");
    $("zoomLabel").textContent="100%";
    resetHome();
    const systemLight=themeQuery?themeQuery.matches:matchMedia("(prefers-color-scheme: light)").matches;
    applyTheme(systemLight?"light":"dark",false);
    notify("Todo restablecido.");
  }
  function handleKeys(e){
    const typing=/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName||"");
    const open=document.querySelector(".modal-backdrop.open");
    if(e.key==="Escape"&&open){e.preventDefault();modal(open.id,false);return;}
    if(e.key==="Tab"&&open){
      const focusables=[...open.querySelectorAll("button,input,select,[tabindex]:not([tabindex='-1'])")].filter(el=>!el.disabled);
      if(focusables.length){
        const first=focusables[0],last=focusables[focusables.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
      return;
    }
    if(typing||open||!$("gameScreen").classList.contains("active"))return;
    const k=e.key.toLowerCase();
    if(k==="r"){e.preventDefault();rotateSelected();return;}
    if(k==="h"){e.preventDefault();hint();return;}
    if(!["arrowleft","arrowright","arrowup","arrowdown","enter"," "].includes(k))return;
    if((k==="enter"||k===" ")&&/^(BUTTON|A)$/.test(e.target.tagName||""))return;
    e.preventDefault();
    if(!selected||selected.placed)selected=pieces.find(p=>!p.placed)||null;
    if(!selected)return;
    if(k==="enter"||k===" "){placePiece(selected);return;}
    const step=e.shiftKey?2:12;
    if(k==="arrowleft")selected.x-=step;
    if(k==="arrowright")selected.x+=step;
    if(k==="arrowup")selected.y-=step;
    if(k==="arrowdown")selected.y+=step;
    draw();saveGame();
  }
  function init(){
    initTheme();
    profileUI();
    $("difficulty").addEventListener("change",setDifficulty);
    $("pieceCount").addEventListener("change",e=>{const n=+e.target.value;$("difficulty").value=n<=16?"easy":n<=64?"medium":"hard";});
    $("imageInput").addEventListener("change",e=>imageLoaded(e.target.files[0]));
    $("startBtn").addEventListener("click",()=>begin(false));
    $("resumeBtn").addEventListener("click",()=>resumeGame(false));
    $("profileOpen").addEventListener("click",openProfile);
    $("editProfile").addEventListener("click",openProfile);
    $("saveProfile").addEventListener("click",()=>{data.profile.name=$("playerName").value.trim()||"Player";data.profile.avatar=$("playerAvatar").value.trim().slice(0,2)||data.profile.name[0].toUpperCase();persistMeta();profileUI();modal("profileModal",false);});
    $("allRecords").addEventListener("click",()=>modal("recordsModal"));
    $("clearRecords").addEventListener("click",()=>{if(confirm("¿Borrar todos los récords?")){data.records=[];persistMeta();profileUI();}});
    document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>modal(b.closest(".modal-backdrop").id,false)));
    document.querySelectorAll(".modal-backdrop").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)modal(m.id,false)}));
    $("previewBtn").addEventListener("click",()=>modal("previewModal"));
    $("miniPreview").addEventListener("click",()=>modal("previewModal"));
    $("hintBtn").addEventListener("click",hint);
    $("rotateBtn").addEventListener("click",rotateSelected);
    $("soundBtn").addEventListener("click",()=>{soundOn=!soundOn;$("soundBtn").textContent=`Sonido: ${soundOn?"sí":"no"}`;$("soundBtn").setAttribute("aria-pressed",String(soundOn));});
    $("zoomIn").addEventListener("click",()=>changeZoom(.1));
    $("zoomOut").addEventListener("click",()=>changeZoom(-.1));
    $("resetBtn").addEventListener("click",resetGame);
    $("resetAllBtn").addEventListener("click",resetAll);
    $("saveExitBtn").addEventListener("click",()=>{goHome();notify("Partida guardada.");});
    $("backHome").addEventListener("click",goHome);
    $("newPuzzleBtn").addEventListener("click",()=>{modal("winModal",false);resetHome();});
    canvas=$("puzzleCanvas");
    canvas.addEventListener("pointerdown",pointerDown);
    canvas.addEventListener("pointermove",pointerMove);
    canvas.addEventListener("pointerup",pointerUp);
    canvas.addEventListener("pointercancel",pointerUp);
    window.addEventListener("resize",()=>{if($("gameScreen").classList.contains("active")){resizeCanvas();layoutPieces();draw();}});
    window.addEventListener("beforeunload",()=>saveGame(true));
    window.addEventListener("pagehide",()=>saveGame(true));
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")saveGame(true);});
    document.addEventListener("keydown",handleKeys);
    if(loadWarning)notify(loadWarning);
    if(data.saved){
      $("resumeBtn").hidden=false;
      if(isValidSave(data.saved))resumeGame(true);
      else notify("La partida guardada no se pudo restaurar. Se conservará hasta que inicies otra.");
    }
    setDifficulty();
  }
  function changeZoom(delta){zoom=Math.max(.7,Math.min(1.35,zoom+delta));$("zoomLabel").textContent=`${Math.round(zoom*100)}%`;resizeCanvas();layoutPieces();draw();}
  document.addEventListener("DOMContentLoaded",init);
})();