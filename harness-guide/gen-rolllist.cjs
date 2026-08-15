const { readFileSync, writeFileSync } = require('node:fs')
const g = JSON.parse(readFileSync(process.argv[2], 'utf8'))

const steps = []
let tapsBefore = 0, resultsBefore = 0
for (const r of g.rounds) {
  steps.push({ kind: 'round', set: r.set, round: r.round, target: r.target, tapsBefore, resultsBefore,
               taps: r.myRolls.length, pts: r.expectedRoundPoints, cut: r.cutShort })
  let running = 0
  r.myRolls.forEach((x, i) => {
    running += x.points
    steps.push({ kind: 'tap', set: r.set, round: r.round, target: r.target, tapsBefore, resultsBefore,
                 n: i + 1, of: r.myRolls.length, dice: x.dice, press: x.tap, points: x.points, type: x.type,
                 running, finalPts: r.expectedRoundPoints })
    tapsBefore++
  })
  steps.push({ kind: 'end', set: r.set, round: r.round, pts: r.expectedRoundPoints, tapsBefore, resultsBefore,
               result: r.expectedResult, endsOnBunco: r.endsOnBunco })
  resultsBefore++
  if (r.round === 6) steps.push({ kind: 'set', set: r.set, tapsBefore, resultsBefore })
}

const html = `<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Bunco roll list — seed ${g.seed}</title>
<style>
:root{--bg:#0f0f0f;--sur:#1c1c1c;--sur2:#252525;--ac:#f59e0b;--hi:#f5f5f5;--mid:#a3a3a3;--lo:#525252;--ok:#22c55e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--hi);font:16px/1.5 system-ui}
header{position:sticky;top:0;z-index:5;background:#141414;border-bottom:1px solid #2a2a2a;padding:.9rem 1.1rem}
.cur{display:flex;align-items:center;gap:1.1rem;flex-wrap:wrap}
.press{font:800 2.6rem/1 system-ui;color:var(--bg);background:var(--ac);padding:.55rem 1.1rem;border-radius:12px;min-width:4.2rem;text-align:center}
.press.sm{font-size:1.5rem;padding:.6rem .9rem}
.meta{color:var(--mid);font-size:.95rem}
.meta b{color:var(--hi)}
.bar{height:4px;background:#2a2a2a;margin-top:.7rem;border-radius:2px;overflow:hidden}
.bar>i{display:block;height:100%;background:var(--ac);width:0;transition:width .15s}
main{max-width:56rem;margin:0 auto;padding:1rem 1.1rem 6rem}
.row{display:grid;grid-template-columns:3.4rem 1fr auto;gap:.9rem;align-items:center;padding:.55rem .7rem;border-bottom:1px solid #202020;cursor:pointer;border-radius:8px}
.row:hover{background:#161616}
.row .idx{color:var(--lo);font:600 .8rem ui-monospace,monospace}
.row .dice{font:1.05rem ui-monospace,monospace;color:var(--mid)}
.row .btn{font:800 1.05rem system-ui;color:var(--ac);display:flex;align-items:baseline;gap:.7rem;justify-content:flex-end}
.row .run{font:600 .85rem ui-monospace,monospace;color:var(--mid);min-width:2.2rem;text-align:right}
.row.done .run{color:var(--ok)}
.row.done{opacity:.32}
.row.done .btn{color:var(--ok)}
.row.now{background:#2a1f05;box-shadow:inset 3px 0 0 var(--ac)}
.hdr{margin:1.6rem 0 .4rem;padding:.7rem .8rem;background:var(--sur);border-radius:10px;display:flex;justify-content:space-between;align-items:center;gap:1rem}
.hdr .t{font:800 1.15rem system-ui}
.hdr .t span{color:var(--ac);font-size:1.5rem}
.hdr .s{color:var(--mid);font-size:.85rem;text-align:right}
.fin{margin:.5rem 0 1.2rem;padding:.75rem .8rem;background:#132018;border:1px solid #24422f;border-radius:10px;font-size:.95rem}
.fin b{color:var(--ok)}
.setbrk{margin:2rem 0;padding:.9rem;text-align:center;background:#241a02;border:1px solid var(--ac);border-radius:10px;color:var(--ac);font-weight:700}
.tag{font:700 .62rem system-ui;letter-spacing:.08em;text-transform:uppercase;padding:.12rem .4rem;border-radius:4px;background:#3a2a00;color:var(--ac);margin-left:.5rem}
kbd{font:.75rem ui-monospace,monospace;border:1px solid #333;border-bottom-width:2px;border-radius:4px;padding:.05rem .3rem;color:var(--mid)}
.live{margin-top:.6rem;font-size:.85rem;display:flex;gap:1rem;flex-wrap:wrap;align-items:center}
.pill{padding:.15rem .55rem;border-radius:999px;font-weight:700;font-size:.78rem}
.pill.on{background:#0d2a17;color:var(--ok);border:1px solid #1f5c37}
.pill.off{background:#2a1010;color:#ef4444;border:1px solid #5c1f1f}
.pill.man{background:#2a2200;color:var(--ac);border:1px solid #5c4a1f}
.undobox{margin-top:.6rem;padding:.7rem .8rem;border-radius:8px;background:#3a1a00;border:1px solid var(--ac);color:#ffd591;font-size:.9rem}
.bad{background:#2a1010;border:1px solid #5c1f1f;color:#ffb4b4;padding:.5rem .7rem;border-radius:8px;margin-top:.5rem;font-size:.85rem}
</style></head><body>
<header>
  <div class="cur">
    <div class="press" id="press">–</div>
    <div>
      <div id="ctx" class="meta"></div>
      <div class="meta" id="dice"></div>
    </div>
    <div style="margin-left:auto;text-align:right" class="meta">
      <div id="prog"></div>
      <div style="margin-top:.25rem"><kbd>space</kbd> next &middot; <kbd>&larr;</kbd> back</div>
    </div>
  </div>
  <div class="bar"><i id="fill"></i></div>
  <div id="live" class="live"></div>
  <div id="undobox" class="undobox" style="display:none"></div>
</header>
<main id="list"></main>
<script>
const STEPS = ${JSON.stringify(steps)};
const KEY = 'bunco-rolllist-${g.seed}';
let pos = Number(localStorage.getItem(KEY) || 0);
const tapIdx = STEPS.map((s,i)=>s.kind==='tap'?i:-1).filter(i=>i>=0);

const list = document.getElementById('list');
let html = '';
STEPS.forEach((s,i)=>{
  if (s.kind==='round') html += '<div class="hdr"><div class="t">Set '+s.set+' &middot; Round '+s.round+' &mdash; target <span>'+s.target+'</span></div><div class="s">'+s.taps+' taps &rarr; '+s.pts+' pts'+(s.cut?' &middot; head table cuts it short':'')+'</div></div>';
  else if (s.kind==='tap') html += '<div class="row" data-i="'+i+'"><div class="idx">'+s.n+'/'+s.of+'</div><div class="dice">'+s.dice.join('  ')+'</div><div class="btn">'+s.press+(s.type==='bunco'?'<span class="tag">round ends</span>':'')+'<span class="run">'+s.running+'</span></div></div>';
  else if (s.kind==='end') html += '<div class="fin" data-i="'+i+'">'+(s.endsOnBunco?'Bunco already ended the round. ':'Tap <b>End Round</b>. ')+'Round total should read <b>'+s.pts+'</b>. Then pick <b>'+({W:'WIN',L:'LOSS',T:'TIE'})[s.result]+'</b>.</div>';
  else html += '<div class="setbrk" data-i="'+i+'">End of set '+s.set+' &mdash; tap through the set summary</div>';
});
list.innerHTML = html;

function render(){
  const done = tapIdx.filter(i=>i<pos).length;
  document.getElementById('prog').textContent = done+' / '+tapIdx.length+' taps';
  document.getElementById('fill').style.width = (100*pos/STEPS.length)+'%';
  document.querySelectorAll('[data-i]').forEach(el=>{
    const i=+el.dataset.i;
    el.classList.toggle('done', i<pos);
    el.classList.toggle('now', i===pos);
  });
  const s = STEPS[pos];
  const press=document.getElementById('press'), ctx=document.getElementById('ctx'), dice=document.getElementById('dice');
  if(!s){ press.textContent='✓'; press.className='press'; ctx.textContent='Game complete'; dice.textContent=''; }
  else if(s.kind==='tap'){ press.textContent=s.press; press.className='press'+(s.press.length>2?' sm':'');
    ctx.innerHTML='Set '+s.set+' &middot; Round '+s.round+' &middot; target <b>'+s.target+'</b> &middot; tap '+s.n+' of '+s.of;
    dice.innerHTML='dice '+s.dice.join('  ')+'  →  '+s.points+' pt  &middot;  round should read <b>'+s.running+'</b>'+(s.running===s.finalPts?' (final)':' of '+s.finalPts); }
  else if(s.kind==='end'){ press.textContent=({W:'WIN',L:'LOSS',T:'TIE'})[s.result]; press.className='press sm';
    ctx.innerHTML='Set '+s.set+' &middot; Round '+s.round+' &mdash; End Round, total <b>'+s.pts+'</b>'; dice.textContent=''; }
  else if(s.kind==='round'){ press.textContent=s.target; press.className='press';
    ctx.innerHTML='Set '+s.set+' &middot; Round '+s.round+' begins &mdash; rolling for <b>'+s.target+'</b>s'; dice.textContent=''; }
  else { press.textContent='→'; press.className='press'; ctx.textContent='End of set '+s.set; dice.textContent=''; }
  localStorage.setItem(KEY,pos);
  const cur=document.querySelector('.now'); if(cur) cur.scrollIntoView({block:'center',behavior:'smooth'});
}
// ---- live sync with the collector -------------------------------------
// The guide follows the app's own roll count instead of the player keeping two
// surfaces in step by hand. Manual keys still work and switch sync off.
var FEED = 'http://127.0.0.1:31403/feed';
var GUIDE = 'http://127.0.0.1:31403/guide';
var synced = true, lastSig = '', seenBad = 0;
// STRICT prompts the undo so a misclick does not cost the whole run; OBSERVE only
// flags it. Both keep the full history — the prompt itself is logged, so a
// prompted undo can be told from a spontaneous one when the numbers are read.
var strict = localStorage.getItem('bunco-guide-strict') !== '0';
var promptedFor = null;
function setStrict(v){
  strict = v; localStorage.setItem('bunco-guide-strict', v ? '1' : '0');
  fetch(GUIDE,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({kind:'mode', strict: v})}).catch(function(){});
}
function locate(taps, results){
  for (var i=0;i<STEPS.length;i++){
    var s0=STEPS[i];
    if (s0.tapsBefore===taps && s0.resultsBefore===results && (s0.kind==='tap'||s0.kind==='end')) return i;
  }
  return null;
}
async function poll(){
  try {
    var r = await fetch(FEED, {cache:'no-store'});
    var f = await r.json();
    var bad = (f.mismatches||[]).length;
    document.getElementById('live').innerHTML =
      '<span class="pill '+(synced?'on':'man')+'">'+(synced?'SYNCED to app':'manual')+'</span>'
      + '<span>'+f.matches+' / '+f.taps+' taps matched</span>'
      + (bad ? '<span class="pill off">'+bad+' wrong</span>' : '<span class="pill on">no wrong taps</span>')
      + '<span class="pill '+(strict?'man':'on')+'" id="modepill" title="click to switch">'+(strict?'STRICT — prompts undo':'OBSERVE — flags only')+'</span>'
      + (f.undos ? '<span>'+f.undos+' undo'+(f.undosPrompted?' ('+f.undosPrompted+' prompted)':'')+(f.undoVerified===f.undos?' ✓ verified':'')+'</span>' : '')
      + (f.deadTaps ? '<span class="pill off">'+f.deadTaps+' dead tap</span>' : '')
      + (bad ? '<div class="bad">Last wrong tap: '+ (f.mismatches[bad-1].detail||'') +'</div>' : '');
    if (bad > seenBad) { seenBad = bad; try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=').play() } catch(e){} }
    // Undo detection: if the most recent mismatch is the tap the app just took,
    // that tap is recoverable right now. Flag it; do not command it — a guide that
    // tells you to undo contaminates the undo-rate metric the session is measuring.
    var lastBad = bad ? f.mismatches[bad-1] : null;
    var undoable = lastBad && lastBad.index === f.totalRolls;
    var ub = document.getElementById('undobox');
    if (undoable) {
      ub.style.display = '';
      ub.innerHTML = (strict
          ? '<b style="font-size:1.15rem">↩︎ UNDO on the phone</b><br>'
          : '<b>That last tap did not match.</b><br>')
        + (lastBad.detail||'')
        + '<br><span style="color:#a3a3a3">'
        + (strict
            ? 'Undo, then re-tap it — the run stays aligned and nothing is lost. The wrong tap, this prompt and your undo are all kept in the log.'
            : 'Recorded either way. Undo if you want the rest of the run to stay aligned.')
        + '</span>';
      // Tell the collector we prompted, once per offending roll, so a prompted
      // undo is distinguishable from one the tester chose unaided.
      if (strict && promptedFor !== lastBad.index) {
        promptedFor = lastBad.index;
        fetch(GUIDE,{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({kind:'prompt', atRoll:lastBad.index, detail:lastBad.detail,
                               expected:lastBad.expected, got:lastBad.got})}).catch(function(){});
      }
    } else { ub.style.display = 'none'; promptedFor = null; }

    var sig = f.totalRolls + ':' + f.totalResults;
    if (synced && sig !== lastSig) {
      lastSig = sig;
      var i = locate(f.totalRolls, f.totalResults);
      if (i !== null && i !== pos) { pos = i; render(); }
    }
  } catch(e) {
    document.getElementById('live').innerHTML = '<span class="pill off">collector unreachable</span>';
  }
}
setInterval(poll, 700); poll();

document.addEventListener('keydown',e=>{
  if(['ArrowRight','ArrowLeft',' ','Enter'].indexOf(e.key)>=0 && synced){ synced=false; }
  if(e.key===' '||e.key==='ArrowRight'||e.key==='Enter'){e.preventDefault(); if(pos<STEPS.length){pos++;render();}}
  else if(e.key==='ArrowLeft'){e.preventDefault(); if(pos>0){pos--;render();}}
  else if(e.key==='r'&&e.shiftKey){pos=0;render();}
});
list.addEventListener('click',e=>{const el=e.target.closest('[data-i]'); if(el){synced=false; pos=+el.dataset.i; render();}});
document.getElementById('live').addEventListener('click',e=>{
  if(e.target.id==='modepill'){ setStrict(!strict); poll(); return; }
  if(e.target.classList.contains('man')){ synced=true; lastSig=''; }
});
// skip the pure-marker steps forward automatically on load
render();
</script></body></html>`
writeFileSync(process.argv[3], html)
console.log('roll list ->', process.argv[3], '|', steps.filter(s=>s.kind==='tap').length, 'taps,', steps.length, 'steps')
