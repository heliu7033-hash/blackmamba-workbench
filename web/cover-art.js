'use strict';
const coverIndex = fetch('/cover-index.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));

// A compact diagram remains available offline and while the thumbnail decodes.
function drawCover(canvas, title, topic) {
  const c = canvas.getContext('2d');
  if (!c) return;
  canvas.width = 480; canvas.height = 270;
  const seed = Array.from(title).reduce((v,x)=>(v*31+x.codePointAt(0))>>>0,17);
  const gradient = c.createLinearGradient(0,0,480,270);
  gradient.addColorStop(0,'#282421'); gradient.addColorStop(1,['#6a432a','#4a564b','#3b515e','#65513d'][seed%4]);
  c.fillStyle=gradient; c.fillRect(0,0,480,270);
  c.translate(240,135); c.strokeStyle='#f4c68a'; c.fillStyle='#e7a24d'; c.lineWidth=5; c.lineJoin='round'; c.lineCap='round';
  const line=(...points)=>{ c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke(); };
  const circle=(x,y,r)=>{c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.stroke();};
  const text=title+' '+topic;
  if (/矿泉|山泉|瓶装|瓶身|饮品/.test(text)) {
    line([-175,45],[-115,-40],[-55,45],[-5,-5],[38,45]);
    line([55,-78],[105,-78],[105,-48],[122,-24],[122,75],[38,75],[38,-24],[55,-48],[55,-78]);
    line([40,8],[120,8]);line([53,-60],[107,-60]);
  } else if (/书店|阅读|图书|书籍/.test(text)) {
    line([0,-45],[-30,-60],[-120,-60],[-120,62],[-30,62],[0,77],[30,62],[120,62],[120,-60],[30,-60],[0,-45],[0,77]);
    for(let i=0;i<4;i++){line([-98,-30+i*21],[-30,-30+i*21]);line([30,-30+i*21],[98,-30+i*21]);}
  } else if (/购买|选择|策略|洞察/.test(text)) {
    for(const y of [-58,0,58]) {line([-98,0],[-46,0],[14,y],[79,y]);circle(98,y,12);}
    circle(-115,0,12);
  } else if (/ABCD/.test(text)) {
    for(let i=0;i<4;i++){const x=-139+i*75;c.strokeRect(x,-43,55,86);c.fillRect(x+10,-22+i*6,35,9);}
  } else if (/篮网|篮球/.test(text)) {
    c.strokeRect(-90,-73,180,72);line([-60,1],[60,1],[36,68],[-36,68],[-60,1]);circle(-75,-24,25);
  } else if (/Nike|开始|运动/.test(text)) {
    for(let i=0;i<4;i++){c.beginPath();c.arc(-35,85,80+i*19,Math.PI,Math.PI*1.9);c.stroke();}
    line([51,-52],[105,-52],[89,-68]);
  } else if (/钩子|Shorts|短视频/.test(text)) {
    c.strokeRect(-45,-85,90,170);line([-14,-25],[22,0],[-14,25],[-14,-25]);line([-20,66],[20,66]);
  } else if (/iPhone|实拍|摄影|拍摄|水滴/.test(text)) {
    c.strokeRect(-98,-52,196,110);circle(0,3,36);circle(0,3,20);line([-58,-52],[-46,-74],[0,-74],[12,-52]);
  } else if (/文案|标题|语录|简报/.test(text)) {
    c.strokeRect(-85,-74,143,149);for(let i=0;i<4;i++)line([-65,-45+i*25],[i===2?0:29,-45+i*25]);line([14,61],[91,-18],[104,-6],[28,72],[14,74],[14,61]);
  } else {
    for(let i=0;i<3;i++){const x=-135+i*93,y=(i-1)*16;c.strokeRect(x,y-34,76,57);line([x+8,y+12],[x+31,y-5],[x+45,y+4],[x+64,y-16]);}
  }
}

function cardArt(key,title,topic,local) {
  const figure=el('figure','card-art'), canvas=el('canvas'), tag=el('span','art-label','二维示意');
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label',title+' · 内容示意图');
  drawCover(canvas,title,topic);figure.append(canvas,tag);
  (local ? Promise.resolve({src:local.src,alt:local.name,label:'本机素材'}) : coverIndex.then(index=>index[key])).then(entry=>{
    if (!entry) return;
    const img=el('img');img.alt=entry.alt;
    img.onload=()=>{canvas.replaceWith(img);tag.textContent=entry.label;};
    img.src=entry.src;
  });
  return figure;
}
function coverCredit(target,key,local) {
  const credit=el('small','cover-credit');target.append(credit);
  if (local) { credit.textContent = "封面来源 · 本机素材 · " + local.name; return; }
  coverIndex.then(index=>{
    const entry=index[key];if (!entry) return;
    credit.textContent=entry.credit || '封面来源 · '+entry.label;
    if (safeURL(entry.source)) {
      const link=el('a','','原始出处 ↗');link.href=safeURL(entry.source);link.target='_blank';link.rel='noopener noreferrer';credit.append(' ',link);
    }
  });
}
