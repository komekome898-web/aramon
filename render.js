function project(wx, wy, wz){
  const tx = wx-camPos.x, ty = wy-camPos.y, tz=(wz||0)-camPos.z;
  const depthFlat = tx*Math.cos(camState.yaw) + ty*Math.sin(camState.yaw);
  const lateral   = -tx*Math.sin(camState.yaw) + ty*Math.cos(camState.yaw);
  const camDepth = depthFlat*Math.cos(camState.pitch) - tz*Math.sin(camState.pitch);
  if(camDepth < 1) return null;
  const camVert = depthFlat*Math.sin(camState.pitch) + tz*Math.cos(camState.pitch);
  const scale = clamp(FOCAL/camDepth, 0, 6);
  return { x: viewW/2 + lateral*scale, y: viewH/2 - camVert*scale, scale, depth: camDepth };
}

/* =====================================================================
   RENDER - shapes
===================================================================== */
function drawMonsterPortrait(e, img, flash){
  const r = e.radius;
  ctx.save();
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.clip();
  const iw = img.naturalWidth||1, ih = img.naturalHeight||1;
  const scale = Math.max((r*2)/iw, (r*2)/ih);
  const dw = iw*scale, dh = ih*scale;
  ctx.drawImage(img, -dw/2, -dh/2, dw, dh);
  if(flash){
    ctx.fillStyle='rgba(255,255,255,0.55)';
    ctx.fillRect(-r,-r,r*2,r*2);
  }
  ctx.restore();
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2);
  ctx.strokeStyle = ELEMENTS[e.element].dark; ctx.lineWidth=2.5; ctx.stroke();
}
function drawMonsterShape(e, color, dark){
  const r = e.radius;
  ctx.fillStyle = color; ctx.strokeStyle = dark; ctx.lineWidth = 2.5;
  switch(e.element){
    case 'fire': {
      ctx.fillStyle='#a8431d';
      [-1,1].forEach(side=>{
        ctx.beginPath();
        ctx.ellipse(side*r*0.95, r*0.55, r*0.32, r*0.5, side*0.3, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle=dark; ctx.lineWidth=2; ctx.stroke();
      });
      ctx.fillStyle=color;
      ctx.beginPath(); ctx.arc(0,r*0.08,r*1.02,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=dark; ctx.lineWidth=2.5; ctx.stroke();
      ctx.fillStyle='#ffb347';
      ctx.beginPath(); ctx.ellipse(0,r*0.32,r*0.62,r*0.5,0,0,Math.PI*2); ctx.fill();
      [-1,1].forEach(side=>{
        ctx.strokeStyle='rgba(160,60,20,0.45)'; ctx.lineWidth=2.5;
        ctx.beginPath();
        ctx.moveTo(side*r*0.18, r*0.0); ctx.lineTo(side*r*0.5, r*0.7);
        ctx.stroke();
      });
      ctx.fillStyle='#7a4a2e';
      ctx.beginPath();
      ctx.moveTo(-r*0.58,-r*0.55);
      ctx.lineTo(-r*0.3,-r*1.15);
      ctx.lineTo(0,-r*0.68);
      ctx.lineTo(r*0.3,-r*1.15);
      ctx.lineTo(r*0.58,-r*0.55);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle=dark; ctx.lineWidth=2; ctx.stroke();
      break;
    }
    case 'aqua': {
      ctx.beginPath();
      ctx.moveTo(0,-r*1.35);
      ctx.quadraticCurveTo(r*1.05,-r*0.2, r*0.85, r*0.35);
      ctx.arc(0, r*0.35, r*0.85, 0.0, Math.PI, false);
      ctx.quadraticCurveTo(-r*1.05,-r*0.2, 0,-r*1.35);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'leaf': {
      ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle=color;
      [[-1,-0.15],[1,-0.15]].forEach(([dx,dy])=>{
        ctx.beginPath();
        ctx.ellipse(dx*r*1.15, dy*r, r*0.55, r*0.28, dx*0.5, 0, Math.PI*2);
        ctx.fill(); ctx.stroke();
      });
      break;
    }
    case 'spark': {
      ctx.beginPath();
      for(let i=0;i<8;i++){
        const a = (i/8)*Math.PI*2;
        const rr = i%2===0 ? r*1.05 : r*0.72;
        const px=Math.cos(a)*rr, py=Math.sin(a)*rr;
        if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'rock': {
      ctx.beginPath();
      for(let i=0;i<6;i++){
        const a = -Math.PI/2 + i*(Math.PI/3);
        const px=Math.cos(a)*r*1.08, py=Math.sin(a)*r*1.08;
        if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'phoenix': {
      const accent = ELEMENTS.phoenix.accent;
      ctx.save();
      ctx.shadowBlur = 16; ctx.shadowColor = color;

      for(let i=-1;i<=1;i++){
        const a = Math.PI/2 + i*0.46;
        const baseA1 = a-0.14, baseA2 = a+0.14;
        ctx.beginPath();
        ctx.moveTo(Math.cos(baseA1)*r*0.7, Math.sin(baseA1)*r*0.7);
        ctx.lineTo(Math.cos(a)*r*1.9, Math.sin(a)*r*1.9);
        ctx.lineTo(Math.cos(baseA2)*r*0.7, Math.sin(baseA2)*r*0.7);
        ctx.closePath();
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = accent; ctx.lineWidth=1.6; ctx.stroke();
      }
      [-1,1].forEach(side=>{
        for(let i=0;i<2;i++){
          const baseAng = side*Math.PI/2 + side*(0.25+i*0.5);
          const b1 = baseAng-0.16, b2 = baseAng+0.16;
          ctx.beginPath();
          ctx.moveTo(Math.cos(b1)*r*0.55, Math.sin(b1)*r*0.55);
          ctx.lineTo(Math.cos(baseAng)*r*(1.55-i*0.35), Math.sin(baseAng)*r*(1.55-i*0.35));
          ctx.lineTo(Math.cos(b2)*r*0.55, Math.sin(b2)*r*0.55);
          ctx.closePath();
          ctx.fillStyle = color; ctx.fill();
          ctx.strokeStyle = accent; ctx.lineWidth=1.6; ctx.stroke();
        }
      });

      ctx.beginPath();
      ctx.ellipse(0, r*0.08, r*0.78, r*0.95, 0, 0, Math.PI*2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth=2.5; ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(0, r*0.18, r*0.42, r*0.5, 0, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,244,200,0.55)'; ctx.fill();

      const spikeCount = 5;
      for(let i=0;i<spikeCount;i++){
        const t = (i/(spikeCount-1))-0.5;
        const baseAng = -Math.PI/2 + t*0.95;
        const spikeLen = r*(1.25 + (1-Math.abs(t)*2)*0.55);
        const bx1 = Math.cos(baseAng-0.09)*r*0.78, by1 = Math.sin(baseAng-0.09)*r*0.78;
        const bx2 = Math.cos(baseAng+0.09)*r*0.78, by2 = Math.sin(baseAng+0.09)*r*0.78;
        const tx = Math.cos(baseAng)*spikeLen, ty = Math.sin(baseAng)*spikeLen;
        ctx.beginPath();
        ctx.moveTo(bx1,by1); ctx.lineTo(tx,ty); ctx.lineTo(bx2,by2); ctx.closePath();
        ctx.fillStyle = accent; ctx.fill();
        ctx.strokeStyle = dark; ctx.lineWidth=1.4; ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(-r*0.16,-r*0.78); ctx.lineTo(0,-r*1.0); ctx.lineTo(r*0.16,-r*0.78);
      ctx.closePath();
      ctx.fillStyle = dark; ctx.fill();

      for(let i=-1;i<=1;i++){
        const wx = i*r*0.32;
        const wobble = Math.sin(matchTime*4+i*2)*r*0.08;
        ctx.beginPath();
        ctx.moveTo(wx-r*0.12, r*0.88);
        ctx.lineTo(wx+wobble, r*1.35);
        ctx.lineTo(wx+r*0.12, r*0.88);
        ctx.closePath();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = accent;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      for(let i=0;i<4;i++){
        const a2 = matchTime*1.3 + i*(Math.PI/2);
        const ex = Math.cos(a2)*r*1.7, ey = Math.sin(a2*1.3)*r*1.0 - r*0.3;
        const emberAlpha = 0.45+0.45*Math.sin(matchTime*3+i*2);
        ctx.beginPath();
        ctx.arc(ex,ey, r*0.07, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255,214,106,${emberAlpha})`;
        ctx.fill();
      }
      break;
    }
    case 'ark': {
      const accent = ELEMENTS.ark.accent;
      ctx.save();
      ctx.shadowBlur = 14; ctx.shadowColor = accent;

      // 光輪
      ctx.beginPath();
      ctx.arc(0,-r*1.05,r*0.62,0,Math.PI*2);
      ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.stroke();

      // 翼
      [-1,1].forEach(side=>{
        ctx.beginPath();
        ctx.moveTo(side*r*0.25, -r*0.1);
        ctx.quadraticCurveTo(side*r*1.5, -r*0.6, side*r*1.7, r*0.15);
        ctx.quadraticCurveTo(side*r*1.1, r*0.05, side*r*0.35, r*0.4);
        ctx.closePath();
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = dark; ctx.lineWidth = 1.6; ctx.stroke();
      });

      // 本体
      ctx.beginPath(); ctx.arc(0,0,r*0.85,0,Math.PI*2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 2.5; ctx.stroke();

      ctx.restore();
      break;
    }
    case 'warm': {
      ctx.save();
      // 体節(丸を連ねた胴体)
      for(let i=2;i>=0;i--){
        const rr = r*(0.62+i*0.18);
        const oy = i*r*0.18;
        ctx.beginPath(); ctx.arc(0, oy, rr, 0, Math.PI*2);
        ctx.fillStyle = i===0 ? color : dark; ctx.fill();
        ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.stroke();
      }
      // 目
      [-1,1].forEach(side=>{
        ctx.beginPath(); ctx.arc(side*r*0.32,-r*0.15,r*0.13,0,Math.PI*2);
        ctx.fillStyle='#1a1020'; ctx.fill();
      });
      // 毒のしずく
      ctx.globalAlpha = 0.6+0.2*Math.sin(matchTime*4);
      ctx.beginPath(); ctx.arc(0, r*0.85, r*0.16, 0, Math.PI*2);
      ctx.fillStyle = '#c07bf0'; ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
      break;
    }
  }
}
function drawElementBadge(e){
  const r=e.radius;
  ctx.save(); ctx.translate(0,-r*1.05);
  ctx.beginPath(); ctx.arc(0,0,r*0.32,0,Math.PI*2);
  ctx.fillStyle='#0c1118'; ctx.fill();
  ctx.strokeStyle=ELEMENTS[e.element].color; ctx.lineWidth=1.6; ctx.stroke();
  ctx.fillStyle=ELEMENTS[e.element].color;
  const s=r*0.16;
  switch(e.element){
    case 'fire': ctx.beginPath(); ctx.moveTo(0,-s); ctx.lineTo(s*0.8,s*0.7); ctx.lineTo(-s*0.8,s*0.7); ctx.closePath(); ctx.fill(); break;
    case 'aqua': ctx.beginPath(); ctx.moveTo(0,-s); ctx.quadraticCurveTo(s*0.9,s*0.5,0,s); ctx.quadraticCurveTo(-s*0.9,s*0.5,0,-s); ctx.fill(); break;
    case 'leaf': ctx.beginPath(); ctx.ellipse(0,0,s*0.95,s*0.45,0.6,0,Math.PI*2); ctx.fill(); break;
    case 'spark': ctx.beginPath(); ctx.moveTo(-s*0.3,-s); ctx.lineTo(s*0.5,-s*0.1); ctx.lineTo(0,0); ctx.lineTo(s*0.4,s); ctx.lineTo(-s*0.5,s*0.1); ctx.lineTo(0,0); ctx.closePath(); ctx.fill(); break;
    case 'rock': ctx.beginPath(); ctx.moveTo(0,-s); ctx.lineTo(s*0.8,0); ctx.lineTo(0,s); ctx.lineTo(-s*0.8,0); ctx.closePath(); ctx.fill(); break;
    case 'phoenix':
      ctx.beginPath(); ctx.moveTo(0,-s*1.1); ctx.lineTo(s*0.85,s*0.35); ctx.lineTo(s*0.15,s*0.15); ctx.lineTo(0,s*0.9); ctx.lineTo(-s*0.15,s*0.15); ctx.lineTo(-s*0.85,s*0.35); ctx.closePath(); ctx.fill();
      break;
  }
  ctx.restore();
}
function drawMonster(e,p){
  const el = ELEMENTS[e.element];
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.scale(p.scale,p.scale);
  ctx.translate(0,-e.radius*0.85);

  ctx.beginPath(); ctx.ellipse(0, e.radius*0.7, e.radius*0.9, e.radius*0.4, 0,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fill();

  if(e.dashTimer>0){
    ctx.save(); ctx.globalAlpha=0.35;
    ctx.translate(-e.dashDirX*16,-e.dashDirY*16);
    const dashImg = getDisplayImage(e);
    if(dashImg){
      drawMonsterPortrait(e, dashImg);
    } else {
      drawMonsterShape(e, el.color, el.dark);
    }
    ctx.restore();
  }

  const displayImg = getDisplayImage(e);
  if(displayImg){
    drawMonsterPortrait(e, displayImg, e.hitFlash>0);
    drawElementBadge(e);
  } else {
    drawMonsterShape(e, e.hitFlash>0?'#ffffff':el.color, el.dark);
    drawElementBadge(e);

    if(e.element==='fire'){
      const eo = e.radius*0.36;
      ctx.save();
      ctx.shadowBlur=8; ctx.shadowColor='#ffd76a';
      ctx.strokeStyle = e.hitFlash>0 ? '#10131a' : '#ffd76a';
      ctx.lineWidth = e.radius*0.13; ctx.lineCap='round';
      [-1,1].forEach(s=>{
        ctx.beginPath();
        ctx.arc(s*eo, -e.radius*0.05, e.radius*0.22, Math.PI*0.15, Math.PI*0.85);
        ctx.stroke();
      });
      ctx.restore();
      ctx.strokeStyle='#10131a'; ctx.lineWidth=e.radius*0.1; ctx.lineCap='round';
      ctx.beginPath();
      ctx.arc(0, e.radius*0.32, e.radius*0.42, 0.15*Math.PI, 0.85*Math.PI);
      ctx.stroke();
    } else {
      ctx.fillStyle='#fff';
      const eyeOff = e.radius*0.32;
      [-1,1].forEach(s=>{ ctx.beginPath(); ctx.arc(s*eyeOff,-e.radius*0.05,e.radius*0.16,0,Math.PI*2); ctx.fill(); });
      ctx.fillStyle='#10131a';
      [-1,1].forEach(s=>{ ctx.beginPath(); ctx.arc(s*eyeOff+Math.cos(e.facingAngle)*2,-e.radius*0.05+Math.sin(e.facingAngle)*2,e.radius*0.07,0,Math.PI*2); ctx.fill(); });
    }
  }

  const mv = activeMove(e);
  ctx.beginPath(); ctx.arc(e.radius*0.7,e.radius*0.7,5,0,Math.PI*2);
  ctx.fillStyle=mv.color; ctx.fill(); ctx.strokeStyle='#10131a'; ctx.lineWidth=1.4; ctx.stroke();

  if(e.burnUntil > matchTime){
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.3*Math.sin(matchTime*8);
    ctx.strokeStyle = '#ff6b35'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0,0, e.radius*1.15, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }
  if(e.slowUntil > matchTime){
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#7fa0ff'; ctx.lineWidth = 2; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.arc(0,0, e.radius*1.3, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }
  if(e.freezeUntil > matchTime){
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#bfe9ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0,0, e.radius*1.2, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }
  if(e.poisonUntil > matchTime){
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.25*Math.sin(matchTime*5);
    ctx.strokeStyle = '#9b5fd1'; ctx.lineWidth = 2.5; ctx.setLineDash([2,5]);
    ctx.beginPath(); ctx.arc(0,0, e.radius*1.42, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  const barW = e.radius*2.1;
  const hpPct = clamp(e.hp/e.maxHp,0,1);
  ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(-barW/2, -e.radius*1.55-9, barW, 6);
  ctx.fillStyle = hpPct>0.5?'#5fe07c':(hpPct>0.22?'#f4c430':'#ff5d5d');
  ctx.fillRect(-barW/2, -e.radius*1.55-9, barW*hpPct, 6);

  if(!e.isPlayer && dist(e,player)<700){
    ctx.font="11px 'Rajdhani', sans-serif"; ctx.fillStyle='rgba(230,230,220,0.85)'; ctx.textAlign='center';
    ctx.fillText(displayNameFor(e), 0, -e.radius*1.55-13);
  }
  ctx.restore();
}
function drawLootItem(it,p){
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.scale(p.scale,p.scale);
  if(it.kind==='heal'){
    const hi = HEAL_ITEMS[it.type];
    const sz = hi.size;
    const bob = Math.sin(matchTime*2.4+it.bob)*2.5;
    ctx.translate(0,-9*sz+bob);
    ctx.shadowBlur=10; ctx.shadowColor=hi.accent;
    ctx.fillStyle=hi.color; ctx.strokeStyle='rgba(0,0,0,0.45)'; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.ellipse(0, 2*sz, 5*sz, 7*sz, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillRect(-1.6*sz, -7*sz, 3.2*sz, 5*sz); ctx.strokeRect(-1.6*sz, -7*sz, 3.2*sz, 5*sz);
    ctx.fillStyle=hi.accent;
    ctx.fillRect(-2.2*sz, -9*sz, 4.4*sz, 2.4*sz); ctx.strokeRect(-2.2*sz, -9*sz, 4.4*sz, 2.4*sz);
    ctx.fillStyle='rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.ellipse(-2*sz, 1*sz, 1.2*sz, 4*sz, 0,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur=0;
    if(dist(it,player)<160){
      ctx.font="10px 'Rajdhani', sans-serif"; ctx.fillStyle='rgba(230,230,220,0.9)'; ctx.textAlign='center';
      ctx.fillText(`${hi.name} (+${hi.heal})`, 0, -13*sz);
    }
  } else if(it.kind==='ticket'){
    const bob = Math.sin(matchTime*2.4+it.bob)*2.5;
    ctx.translate(0,-8+bob);
    ctx.shadowBlur=10; ctx.shadowColor=TICKET_ITEM.accent;
    ctx.fillStyle = TICKET_ITEM.color;
    ctx.fillRect(-8,-5,16,10);
    ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.lineWidth=1.2;
    ctx.strokeRect(-8,-5,16,10);
    ctx.setLineDash([2,2]);
    ctx.beginPath(); ctx.moveTo(0,-5); ctx.lineTo(0,5);
    ctx.strokeStyle='rgba(60,60,60,0.5)'; ctx.lineWidth=1; ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle='#2a5d80'; ctx.font="bold 7px 'Rajdhani', sans-serif"; ctx.textAlign='center';
    ctx.fillText('特訓', -4, 1.5);
    ctx.shadowBlur=0;
    if(dist(it,player)<160){
      ctx.font="10px 'Rajdhani', sans-serif"; ctx.fillStyle='rgba(230,230,220,0.9)'; ctx.textAlign='center';
      ctx.fillText(TICKET_ITEM.name, 0, -14);
    }
  } else if(it.kind==='guts'){
    const bob = Math.sin(matchTime*2.4+it.bob)*2.5;
    ctx.translate(0,-8+bob);
    ctx.shadowBlur=10; ctx.shadowColor=GUTS_ITEM.accent;
    ctx.fillStyle = GUTS_ITEM.color;
    ctx.beginPath(); ctx.ellipse(0,0,7,4.5,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.lineWidth=1.2; ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(-9,-3); ctx.lineTo(-6,0); ctx.lineTo(-9,3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(9,-3); ctx.lineTo(6,0); ctx.lineTo(9,3); ctx.stroke();
    ctx.shadowBlur=0;
    if(dist(it,player)<160){
      ctx.font="10px 'Rajdhani', sans-serif"; ctx.fillStyle='rgba(230,230,220,0.9)'; ctx.textAlign='center';
      ctx.fillText(GUTS_ITEM.name, 0, -14);
    }
  } else if(it.kind==='training'){
    const ti = TRAINING_ITEMS[it.type];
    const bob = Math.sin(matchTime*2.4+it.bob)*2.5;
    ctx.translate(0,-10+bob);
    const spin = 0.7+0.3*Math.sin(matchTime*3+it.bob);
    ctx.shadowBlur = 16*spin; ctx.shadowColor = ti.accent;
    ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
    ctx.strokeStyle = ti.accent; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.font="14px sans-serif"; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(ti.emoji, 0, 1);
    ctx.shadowBlur=0;
    if(dist(it,player)<160){
      ctx.font="10px 'Rajdhani', sans-serif"; ctx.fillStyle=ti.accent; ctx.textAlign='center'; ctx.textBaseline='alphabetic';
      ctx.fillText(`${ti.name}（${ti.desc}）`, 0, -16);
    }
  }
  ctx.restore();
}
function drawProjectile(pr,p){
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.scale(p.scale,p.scale);
  ctx.shadowBlur=10; ctx.shadowColor=pr.color;
  ctx.fillStyle=pr.color;
  ctx.beginPath();
  if(pr.hitW>pr.hitR){
    ctx.rotate(-camState.yaw);
    ctx.ellipse(0,0,pr.hitW*0.8,pr.hitR*0.8,0,0,Math.PI*2);
  } else {
    ctx.arc(0,0,pr.hitR,0,Math.PI*2);
  }
  ctx.fill();
  ctx.restore();
}
function drawParticle(pt,p){
  const a = clamp(pt.life/pt.maxLife,0,1);
  ctx.save();
  ctx.translate(p.x,p.y);
  if(pt.type==='text'){
    ctx.scale(p.scale,p.scale);
    ctx.font="bold 13px 'Share Tech Mono', monospace";
    ctx.fillStyle = pt.color; ctx.globalAlpha=a; ctx.textAlign='center';
    ctx.fillText(pt.text, 0,0);
  } else {
    ctx.beginPath(); ctx.arc(0,0,Math.max(0.5,pt.size*a*p.scale),0,Math.PI*2);
    ctx.fillStyle=pt.color; ctx.globalAlpha=a; ctx.fill();
  }
  ctx.restore();
}
function drawRock(rock,p){
  const r = rock.radius;
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.scale(p.scale,p.scale);
  ctx.translate(0,-r*0.55);
  ctx.beginPath(); ctx.ellipse(0, r*0.6, r*1.1, r*0.32, 0,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.fill();
  ctx.fillStyle='#5a6470'; ctx.strokeStyle='#33394a'; ctx.lineWidth=2.5;
  ctx.beginPath();
  const pts=8;
  for(let i=0;i<pts;i++){
    const a=(i/pts)*Math.PI*2;
    const rr = r*(0.78+0.22*Math.sin(a*2.3+rock.seed));
    const px=Math.cos(a)*rr, py=Math.sin(a)*rr*0.85;
    if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(-r*0.22,-r*0.28,r*0.32,r*0.2,0.3,0,Math.PI*2);
  ctx.fillStyle='rgba(255,255,255,0.1)'; ctx.fill();
  ctx.restore();
}
function rampCorners(b){
  const rw = (b.rampSide===0||b.rampSide===1) ? b.hw*0.9 : b.hd*0.9;
  if(b.rampSide===0){
    const nearY=b.cy+b.hd, farY=nearY+b.rampLen;
    return { nearA:{x:b.cx-rw,y:nearY,z:b.wallH}, nearB:{x:b.cx+rw,y:nearY,z:b.wallH}, farA:{x:b.cx-rw,y:farY,z:0}, farB:{x:b.cx+rw,y:farY,z:0} };
  }
  if(b.rampSide===1){
    const nearY=b.cy-b.hd, farY=nearY-b.rampLen;
    return { nearA:{x:b.cx-rw,y:nearY,z:b.wallH}, nearB:{x:b.cx+rw,y:nearY,z:b.wallH}, farA:{x:b.cx-rw,y:farY,z:0}, farB:{x:b.cx+rw,y:farY,z:0} };
  }
  if(b.rampSide===2){
    const nearX=b.cx+b.hw, farX=nearX+b.rampLen;
    return { nearA:{x:nearX,y:b.cy-rw,z:b.wallH}, nearB:{x:nearX,y:b.cy+rw,z:b.wallH}, farA:{x:farX,y:b.cy-rw,z:0}, farB:{x:farX,y:b.cy+rw,z:0} };
  }
  const nearX=b.cx-b.hw, farX=nearX-b.rampLen;
  return { nearA:{x:nearX,y:b.cy-rw,z:b.wallH}, nearB:{x:nearX,y:b.cy+rw,z:b.wallH}, farA:{x:farX,y:b.cy-rw,z:0}, farB:{x:farX,y:b.cy+rw,z:0} };
}
function drawRamp(b){
  const c = rampCorners(b);
  const pNA=project(c.nearA.x,c.nearA.y,c.nearA.z), pNB=project(c.nearB.x,c.nearB.y,c.nearB.z);
  const pFA=project(c.farA.x,c.farA.y,c.farA.z), pFB=project(c.farB.x,c.farB.y,c.farB.z);
  if(!pNA||!pNB||!pFA||!pFB) return;
  ctx.beginPath();
  ctx.moveTo(pFA.x,pFA.y); ctx.lineTo(pFB.x,pFB.y); ctx.lineTo(pNB.x,pNB.y); ctx.lineTo(pNA.x,pNA.y); ctx.closePath();
  ctx.fillStyle='#7d8aa0'; ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.lineWidth=1.5; ctx.stroke();
  ctx.strokeStyle='rgba(0,0,0,0.18)'; ctx.lineWidth=1;
  for(let i=1;i<5;i++){
    const t=i/5;
    const a={x:lerp(c.nearA.x,c.farA.x,t), y:lerp(c.nearA.y,c.farA.y,t), z:lerp(c.nearA.z,c.farA.z,t)};
    const bb={x:lerp(c.nearB.x,c.farB.x,t), y:lerp(c.nearB.y,c.farB.y,t), z:lerp(c.nearB.z,c.farB.z,t)};
    const pa=project(a.x,a.y,a.z), pb=project(bb.x,bb.y,bb.z);
    if(pa&&pb){ ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke(); }
  }
}
function drawBuilding(b){
  const showEast = camPos.x > b.cx + b.hw*0.2;
  const showWest = camPos.x < b.cx - b.hw*0.2;
  const showSouth = camPos.y > b.cy + b.hd*0.2;
  const showNorth = camPos.y < b.cy - b.hd*0.2;
  const c = {
    nw:{x:b.cx-b.hw,y:b.cy-b.hd}, ne:{x:b.cx+b.hw,y:b.cy-b.hd},
    se:{x:b.cx+b.hw,y:b.cy+b.hd}, sw:{x:b.cx-b.hw,y:b.cy+b.hd},
  };
  function wallPoly(c1,c2,shade){
    const p1t=project(c1.x,c1.y,b.wallH), p2t=project(c2.x,c2.y,b.wallH);
    const p1b=project(c1.x,c1.y,0), p2b=project(c2.x,c2.y,0);
    if(!p1t||!p2t||!p1b||!p2b) return;
    ctx.beginPath();
    ctx.moveTo(p1b.x,p1b.y); ctx.lineTo(p2b.x,p2b.y); ctx.lineTo(p2t.x,p2t.y); ctx.lineTo(p1t.x,p1t.y); ctx.closePath();
    ctx.fillStyle=shade; ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.35)'; ctx.lineWidth=1.5; ctx.stroke();
  }
  if(showSouth) wallPoly(c.sw, c.se, '#4a5566');
  if(showNorth) wallPoly(c.nw, c.ne, '#4a5566');
  if(showEast)  wallPoly(c.ne, c.se, '#546073');
  if(showWest)  wallPoly(c.nw, c.sw, '#546073');

  const rp = [c.nw,c.ne,c.se,c.sw].map(pt=>project(pt.x,pt.y,b.wallH));
  if(rp.every(pt=>pt)){
    ctx.beginPath();
    ctx.moveTo(rp[0].x,rp[0].y);
    for(let i=1;i<rp.length;i++) ctx.lineTo(rp[i].x,rp[i].y);
    ctx.closePath();
    ctx.fillStyle='#6b7790'; ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.lineWidth=1.5; ctx.stroke();
  }
  drawRamp(b);
}
function projectCircleRing(center, radius, segments){
  const pts = [];
  for(let i=0;i<=segments;i++){
    const a = (i/segments)*Math.PI*2;
    const p = project(center.x+Math.cos(a)*radius, center.y+Math.sin(a)*radius, 0);
    if(p) pts.push(p);
  }
  return pts;
}
function strokeProjectedRing(pts, strokeStyle, lineWidth, dash, glow){
  if(pts.length<3) return;
  ctx.save();
  ctx.setLineDash(dash||[]);
  ctx.lineWidth=lineWidth;
  if(glow){ ctx.shadowBlur=glow.blur; ctx.shadowColor=glow.color; }
  ctx.strokeStyle=strokeStyle;
  ctx.beginPath();
  ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
  ctx.stroke();
  ctx.restore();
}
const ZONE_HUGE_RADIUS_THRESHOLD = 3200; // これより大きい半径の円は、局所的な直線(接線)として近似する
// 巨大な安全圏の円をそのまま360度分投影すると、プレイヤー付近以外の遠い点まで巻き込んで
// 多角形が破綻する(境界に近づくと地面が全面オレンジになる等)。半径が大きい場合は
// プレイヤー最寄りの境界点における接線(直線)で近似することで、この破綻を防ぐ。
function nearestEdgeTangent(center, radius, span){
  const dx = player.x-center.x, dy = player.y-center.y;
  const d = Math.max(1, Math.hypot(dx,dy));
  const nx = dx/d, ny = dy/d; // 中心→プレイヤー方向(=外向き法線)
  const ex = center.x+nx*radius, ey = center.y+ny*radius; // 最寄りの境界点
  const tx = -ny, ty = nx; // 接線方向
  return { ex, ey, nx, ny, tx, ty, span };
}
function drawZoneRings(){
  const ZONE_RENDER_THRESHOLD = 4000; // これより境界から離れていれば描画不要
  drawOneZoneRing(zoneState.center, zoneState.radius, 'rgba(244,196,48,0.85)', 4, [20,16], {blur:16,color:'rgba(244,196,48,0.6)'}, ZONE_RENDER_THRESHOLD);
  if(zoneState.shrinking){
    drawOneZoneRing(zoneState.toCenter, zoneState.toRadius, 'rgba(255,255,255,0.32)', 2, [6,9], null, ZONE_RENDER_THRESHOLD);
  }
}
function drawOneZoneRing(center, radius, strokeStyle, lineWidth, dash, glow, threshold){
  const distToEdge = Math.abs(dist(player, center) - radius);
  if(distToEdge >= threshold) return;
  if(radius > ZONE_HUGE_RADIUS_THRESHOLD){
    const { ex, ey, tx, ty } = nearestEdgeTangent(center, radius, 6000);
    const p1 = project(ex+tx*6000, ey+ty*6000, 0);
    const p2 = project(ex-tx*6000, ey-ty*6000, 0);
    if(!p1 || !p2) return;
    strokeProjectedRing([p1,p2], strokeStyle, lineWidth, dash, glow);
  } else {
    const ring = projectCircleRing(center, radius, 90);
    strokeProjectedRing(ring, strokeStyle, lineWidth, dash, glow);
  }
}
function drawSkyAndGround(){
  const horizonY = clamp(viewH/2 - FOCAL*Math.tan(camState.pitch), -40, viewH+40);
  const sky = ctx.createLinearGradient(0,0,0,Math.max(horizonY,1));
  sky.addColorStop(0,'#05070d'); sky.addColorStop(1,'#0d1726');
  ctx.fillStyle = sky;
  ctx.fillRect(0,0,viewW, Math.max(horizonY,0));
  ctx.fillStyle = currentMap.groundColor || '#142433';
  ctx.fillRect(0, Math.max(horizonY,0), viewW, viewH-Math.max(horizonY,0));
}
function drawTerrainDecor(){
  for(const d of terrainDecor){
    if(Math.abs(d.x-player.x)>1000 || Math.abs(d.y-player.y)>1000) continue;
    const p = project(d.x,d.y,0);
    if(!p || p.x<-40||p.x>viewW+40||p.y<-40||p.y>viewH+40) continue;
    ctx.beginPath(); ctx.ellipse(p.x,p.y, d.r*p.scale, d.r*p.scale*0.4, 0,0,Math.PI*2);
    ctx.fillStyle = d.shade==='dark' ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.06)';
    ctx.fill();
  }
}
function drawDangerVignette(){
  const d = dist(player, zoneState.center);
  if(d <= zoneState.radius) return;
  const t = clamp((d-zoneState.radius)/150, 0, 1);
  const pulse = 0.5+0.5*Math.sin(matchTime*4);
  const alpha = clamp(0.08 + 0.10*t + 0.06*pulse*t, 0, 0.4);
  ctx.save();
  const grad = ctx.createRadialGradient(viewW/2,viewH/2, Math.min(viewW,viewH)*0.2, viewW/2,viewH/2, Math.max(viewW,viewH)*0.75);
  grad.addColorStop(0,'rgba(200,80,0,0)');
  grad.addColorStop(1, `rgba(255,140,20,${alpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,viewW,viewH);
  ctx.restore();
}
function drawDangerGround(){
  const isOutside = dist(player, zoneState.center) > zoneState.radius;
  const distToEdge = Math.abs(dist(player, zoneState.center) - zoneState.radius);
  if(!isOutside && distToEdge > 4000) return; // 内側で境界から遠く離れていれば描画不要(チラつき防止)

  const horizonY = clamp(viewH/2 - FOCAL*Math.tan(camState.pitch), -40, viewH+40);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, Math.max(horizonY,0), viewW, viewH-Math.max(horizonY,0));
  ctx.clip();

  const pulse = 0.5+0.5*Math.sin(matchTime*4);

  if(isOutside){
    // 安置の外にいる間は、カメラがどちらを向いていても(境界そのものが視界に入っていなくても)
    // 見えている地面全体を危険地帯として塗る。境界の位置計算に依存させると、境界が
    // カメラの後ろ側に来た時に描画が抜け落ちてしまう(地面が安置内と同じ色に見える不具合)ため。
    ctx.fillStyle = `rgba(255,140,20,${0.32+0.10*pulse})`;
    ctx.fillRect(0, Math.max(horizonY,0), viewW, viewH-Math.max(horizonY,0));
  }

  // 境界そのものが視界に入っている場合は、その位置により正確な縁取り・グラデーションを重ねる(失敗しても無視してよい)
  if(zoneState.radius > ZONE_HUGE_RADIUS_THRESHOLD){
    const span = 9000;
    const { ex, ey, nx, ny, tx, ty } = nearestEdgeTangent(zoneState.center, zoneState.radius, span);
    const p1 = project(ex+tx*span, ey+ty*span, 0);
    const p2 = project(ex-tx*span, ey-ty*span, 0);
    const p1Far = project(ex+tx*span+nx*span, ey+ty*span+ny*span, 0);
    const p2Far = project(ex-tx*span+nx*span, ey-ty*span+ny*span, 0);
    if(p1 && p2 && p1Far && p2Far){
      if(!isOutside){
        ctx.beginPath();
        ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y);
        ctx.lineTo(p2Far.x,p2Far.y); ctx.lineTo(p1Far.x,p1Far.y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,140,20,0.4)';
        ctx.fill();
      }
      strokeProjectedRing([p1,p2], `rgba(255,170,60,${0.5+0.3*pulse})`, 3, [14,10], {blur:14,color:'rgba(255,140,20,0.7)'});
    }
  } else {
    const ring = projectCircleRing(zoneState.center, zoneState.radius, 110);
    if(!isOutside && ring.length>=3){
      ctx.beginPath();
      ctx.rect(0,0,viewW,viewH);
      ctx.moveTo(ring[0].x,ring[0].y);
      for(let i=1;i<ring.length;i++) ctx.lineTo(ring[i].x,ring[i].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,140,20,0.4)';
      ctx.fill('evenodd');
    }
    if(ring.length>=2){
      strokeProjectedRing(ring, `rgba(255,170,60,${0.5+0.3*pulse})`, 3, [14,10], {blur:14,color:'rgba(255,140,20,0.7)'});
    }
  }
  ctx.restore();
}
function drawLandingMarkers(){
  for(const p of projectiles){
    if(!p.lobbed) continue;
    const t = clamp(p.flightT / p.flightTime, 0, 1);
    const proj = project(p.landX, p.landY, 0);
    if(!proj) continue;
    const fade = 0.25 + 0.35*t;
    ctx.save();
    ctx.translate(proj.x, proj.y);
    ctx.scale(proj.scale, proj.scale);
    ctx.beginPath();
    ctx.ellipse(0,0, p.splash*0.9, p.splash*0.4, 0, 0, Math.PI*2);
    ctx.strokeStyle = p.color; ctx.globalAlpha = fade; ctx.lineWidth=3; ctx.setLineDash([8,6]);
    ctx.stroke();
    ctx.restore();
  }
}
function drawLavaZones(){
  if(lavaZones.length===0) return;
  for(const lz of lavaZones){
    const pts = projectCircleRing(lz, lz.radius, 40);
    if(pts.length<3) continue;
    ctx.save();
    const pulse = 0.75 + 0.25*Math.sin(matchTime*2.4 + lz.x*0.01);
    ctx.shadowBlur = 22; ctx.shadowColor = 'rgba(255,90,20,0.8)';
    ctx.beginPath();
    ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,${Math.round(70+30*pulse)},20,0.85)`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,220,120,${0.5+0.3*pulse})`; ctx.lineWidth=2.5;
    ctx.stroke();
    ctx.restore();
  }
}
// 火山1つ分(主峰+複数の裾野の隆起)をまとめて1つの立体として描画する。
// 個別に奥行きソートすると隙間から背景が見えてしまう(透けて見える)ため、
// 必ずこの関数の中で複合体としてまとめて描画する。
function drawVolcanoComplex(group,p){
  ctx.save();
  ctx.globalAlpha = 1;

  const main = group.find(v=>v.isMain) || group[0];
  const mainP = project(main.x, main.y, 0);
  if(!mainP){ ctx.restore(); return; }
  const mainR = mainP.scale * main.radius;

  // 複合体全体で「地面に接する影」は1つだけにする(裾野の輪郭として自然に見せる)
  ctx.beginPath();
  ctx.ellipse(mainP.x, mainP.y + mainR*0.08, mainR*1.3, mainR*0.5, 0, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fill();

  // 各隆起(主峰含む)を、奥から手前の順で描く(主峰は最後=一番手前)
  const sorted = [...group].sort((a,b)=> (a.isMain?1:0) - (b.isMain?1:0));

  for(const v of sorted){
    const pp = project(v.x, v.y, 0);
    if(!pp) continue;
    const r = pp.scale * v.radius;
    const riseH = r * (v.isMain ? 1.15 : 0.9); // 地面からの盛り上がりの高さ(疑似的な3D隆起)

    ctx.save();
    ctx.translate(pp.x, pp.y);

    // 山肌を裾野から山頂へ向けて何段かのテラスとして描き、隆起している質感を出す。
    // 楕円の下半分を描くと接地点より下に膨らんで見えてしまうため、上半分(ドーム状)だけ描く
    const terraces = v.isMain ? 5 : 3;
    for(let t=terraces; t>=0; t--){
      const tt = t/terraces; // 1=裾野, 0=山頂
      const rr = r*(0.28+0.72*tt);
      const ry = rr*0.60;
      const yOff = -riseH*(1-tt);
      const shade = 0.16 + tt*0.30; // 山頂ほど明るく
      ctx.beginPath(); ctx.ellipse(0, yOff, rr, ry, 0, Math.PI, Math.PI*2);
      ctx.fillStyle = `rgb(${Math.round(70+90*shade)},${Math.round(46+58*shade)},${Math.round(30+38*shade)})`;
      ctx.fill();
    }

    if(v.isMain){
      const glow = 0.6+0.3*Math.sin(matchTime*1.6);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, -riseH, r*0.30, r*0.19, 0, 0, Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0,-riseH, r*0.26, r*0.16, 0, 0, Math.PI*2);
      ctx.fillStyle = `rgb(${Math.round(200+30*glow)},${Math.round(70+30*glow)},20)`;
      ctx.shadowBlur=22; ctx.shadowColor='rgba(255,110,30,0.95)';
      ctx.fill();
      ctx.shadowBlur=0;
    }
    ctx.restore();
  }
  ctx.restore();
}
function render(){
  ctx.clearRect(0,0,viewW,viewH);
  drawSkyAndGround();
  drawDangerGround();
  drawLavaZones();
  drawTerrainDecor();
  drawZoneRings();
  drawLandingMarkers();

  const drawables = [];
  for(const b of buildings){ const p = project(b.cx,b.cy,b.wallH*0.5); if(p) drawables.push({kind:'building', obj:b, p}); }
  for(const r of rocks){ const p = project(r.x,r.y,0); if(p) drawables.push({kind:'rock', obj:r, p}); }
  const volcanoGroups = new Map();
  for(const v of volcanoObstacles){
    const gid = v.complexId||0;
    if(!volcanoGroups.has(gid)) volcanoGroups.set(gid, []);
    volcanoGroups.get(gid).push(v);
  }
  for(const group of volcanoGroups.values()){
    const main = group.find(v=>v.isMain) || group[0];
    const p = project(main.x, main.y, 0);
    if(p) drawables.push({kind:'volcano', obj:group, p});
  }
  for(const it of lootItems){ const p = project(it.x,it.y,0); if(p) drawables.push({kind:'loot', obj:it, p}); }
  for(const pr of projectiles){ const p = project(pr.x,pr.y,pr.z+20); if(p) drawables.push({kind:'proj', obj:pr, p}); }
  for(const e of entities){ if(!e.alive) continue; const p = project(e.x,e.y,e.z); if(p){ drawables.push({kind:'mon', obj:e, p}); if(!e.isPlayer) monsterScreenPos.set(e.id, {x:p.x,y:p.y,scale:p.scale}); } }
  for(const pt of particles){ const p = project(pt.x,pt.y, (pt.z||0)+(pt.type==='text'?42:16)); if(p) drawables.push({kind:'fx', obj:pt, p}); }

  drawables.sort((a,b)=>b.p.depth-a.p.depth);
  for(const d of drawables){
    if(d.p.x<-150||d.p.x>viewW+150||d.p.y<-150||d.p.y>viewH+150) continue;
    if(d.kind==='loot') drawLootItem(d.obj,d.p);
    else if(d.kind==='proj') drawProjectile(d.obj,d.p);
    else if(d.kind==='volcano') drawVolcanoComplex(d.obj,d.p);
    else if(d.kind==='mon') drawMonster(d.obj,d.p);
    else if(d.kind==='rock') drawRock(d.obj,d.p);
    else if(d.kind==='building') drawBuilding(d.obj);
    else drawParticle(d.obj,d.p);
  }
  drawDangerVignette();
  renderMinimap();
}
function renderMinimap(){
  const w = miniCanvas.width, h = miniCanvas.height;
  miniCtx.clearRect(0,0,w,h);
  miniCtx.fillStyle='#0b1320'; miniCtx.fillRect(0,0,w,h);
  const scale = w/WORLD.w;
  miniCtx.save();
  miniCtx.beginPath(); miniCtx.arc(w/2,h/2,w/2-2,0,Math.PI*2); miniCtx.clip();
  miniCtx.beginPath();
  miniCtx.arc(zoneState.center.x*scale, zoneState.center.y*scale, zoneState.radius*scale, 0, Math.PI*2);
  miniCtx.strokeStyle='rgba(244,196,48,0.85)'; miniCtx.lineWidth=2; miniCtx.stroke();
  for(const v of volcanoObstacles){
    miniCtx.beginPath();
    miniCtx.arc(v.x*scale, v.y*scale, Math.max(2, v.radius*scale), 0, Math.PI*2);
    miniCtx.fillStyle = 'rgba(90,58,42,0.9)'; miniCtx.fill();
  }
  for(const lz of lavaZones){
    miniCtx.beginPath();
    miniCtx.arc(lz.x*scale, lz.y*scale, Math.max(1.5, lz.radius*scale), 0, Math.PI*2);
    miniCtx.fillStyle = 'rgba(255,90,20,0.85)'; miniCtx.fill();
  }
  for(const e of entities){
    if(!e.alive) continue;
    miniCtx.beginPath();
    miniCtx.arc(e.x*scale, e.y*scale, e.isPlayer?3.4:2.2, 0, Math.PI*2);
    miniCtx.fillStyle = e.isPlayer ? '#ffffff' : ELEMENTS[e.element].color;
    miniCtx.fill();
  }
  const px=player.x*scale, py=player.y*scale, yaw=camState.yaw;
  miniCtx.beginPath();
  miniCtx.moveTo(px,py);
  miniCtx.lineTo(px+Math.cos(yaw)*12, py+Math.sin(yaw)*12);
  miniCtx.strokeStyle='rgba(255,255,255,0.9)'; miniCtx.lineWidth=2; miniCtx.stroke();
  miniCtx.restore();
}

/* =====================================================================
   HUD
===================================================================== */
const CD_RING_CIRC = 2*Math.PI*46; // SVG上の半径46に合わせた円周
function setCooldownRing(el, progress){
  if(!el) return;
  const p = clamp(progress, 0, 1);
  el.style.strokeDasharray = `${CD_RING_CIRC}`;
  el.style.strokeDashoffset = `${CD_RING_CIRC * (1-p)}`;
}
function updateHUD(){
  if(!player) return;
  const el = ELEMENTS[player.element];
  document.getElementById('hudName').textContent = 'プレイヤー';
  document.getElementById('hudElTag').textContent = el.label;
  document.documentElement.style.setProperty('--accent', el.color);
  const hpPct = clamp(player.hp/player.maxHp,0,1)*100;
  document.getElementById('hpFill').style.width = hpPct+'%';
  document.getElementById('hpFill').style.background = hpPct>50?'linear-gradient(90deg,#6bff8e,#2fd35a)':(hpPct>22?'linear-gradient(90deg,#ffe06b,#f4c430)':'linear-gradient(90deg,#ff8a8a,#ff5d5d)');
  document.getElementById('hpNum').textContent = `${Math.max(0,Math.round(player.hp))} / ${player.maxHp}`;

  const gutsPct = clamp(player.guts/player.maxGuts,0,1)*100;
  document.getElementById('gutsFill').style.width = gutsPct+'%';
  document.getElementById('gutsNum').textContent = `${Math.max(0,Math.round(player.guts))} / ${player.maxGuts}`;

  const statusEl = document.getElementById('statusIcons');
  let statusHtml = '';
  if(player.burnUntil > matchTime) statusHtml += `<span class="status-pill burn">やけど</span>`;
  if(player.slowUntil > matchTime) statusHtml += `<span class="status-pill slow">鈍足</span>`;
  if(player.freezeUntil > matchTime) statusHtml += `<span class="status-pill freeze">こおり</span>`;
  if(player.poisonUntil > matchTime) statusHtml += `<span class="status-pill poison">どく</span>`;
  statusEl.innerHTML = statusHtml;

  const aliveCount = entities.filter(e=>e.alive).length;
  document.getElementById('aliveNum').textContent = aliveCount;
  document.getElementById('zoneStatus').textContent = zoneLabel();
  const countdown = zoneCountdownSeconds();
  document.getElementById('zoneCountdown').textContent = countdown===null ? '--:--' : fmtTime(countdown);
  document.getElementById('killCountNum').textContent = player.kills;
  document.getElementById('damageDealtNum').textContent = Math.round(player.damageDealt);
  document.getElementById('matchClock').textContent = fmtTime(matchTime);

  const mv = activeMove(player);
  document.getElementById('moveName').textContent = mv.name;
  document.documentElement.style.setProperty('--moveColor', mv.color);
  document.getElementById('gutsCostLabel').textContent = `ガッツ消費 ${effectiveGutsCost(player, mv)}`;
  for(let t=1;t<=3;t++){
    const dot = document.querySelector(`.tier-dot[data-tier="${t}"]`);
    dot.classList.toggle('unlocked', t<=player.moveTierUnlocked);
    dot.classList.toggle('selected', t===player.moveTierSelected);
  }
  document.getElementById('moveIcon').innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="${mv.color}"/></svg>`;

  document.getElementById('tipBox').style.opacity = game.tipTimer>0 ? '1':'0';

  const fireMax = effectiveCooldown(player, mv);
  const fireProgress = fireMax>0 ? clamp(1 - player.fireCooldown/fireMax, 0, 1) : 1;
  setCooldownRing(document.getElementById('fireCdRing'), fireProgress);

  const dashProgress = clamp(1 - player.dashCooldown/DASH_COOLDOWN_MAX, 0, 1);
  setCooldownRing(document.getElementById('dashCdRing'), dashProgress);

  let lockOn=false;
  if(player.alive){
    const fx=Math.cos(player.facingAngle), fy=Math.sin(player.facingAngle);
    for(const e of entities){
      if(e===player||!e.alive) continue;
      if(e.z - player.z > UPWARD_BLOCK_THRESHOLD) continue;
      const d=dist(player,e); if(d>mv.range) continue;
      const dirx=(e.x-player.x)/Math.max(d,0.001), diry=(e.y-player.y)/Math.max(d,0.001);
      if(dirx*fx+diry*fy>0.9){ lockOn=true; break; }
    }
  }
  document.getElementById('crosshair').classList.toggle('lock', lockOn);
}

/* =====================================================================
   INPUT
===================================================================== */
document.addEventListener('touchmove', (e)=>{
  if(e.target.closest('#startScreen') || e.target.closest('#rankingList') || e.target.closest('#myStatsScreen')) return;
  e.preventDefault();
}, {passive:false});
document.addEventListener('gesturestart', (e)=>{ e.preventDefault(); });
document.addEventListener('gesturechange', (e)=>{ e.preventDefault(); });
document.addEventListener('gestureend', (e)=>{ e.preventDefault(); });

