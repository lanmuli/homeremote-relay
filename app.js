const $ = id => document.getElementById(id);
let ws, secretKey, seq = 0;
let clientNonce = '';
const enc = new TextEncoder();
const initial = new URLSearchParams(location.hash.slice(1));
if(initial.get('relay')) $('relay').value=initial.get('relay');
if(initial.get('room')) $('room').value=initial.get('room');
if(initial.get('secret')) $('secret').value=initial.get('secret');

async function hmac(body) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return [...new Uint8Array(sig)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes=24){const a=crypto.getRandomValues(new Uint8Array(bytes));return [...a].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function sendCommand(action, data = {}) {
  if (!ws || ws.readyState !== 1) return;
  const payload = { action, data, ts: Date.now(), seq: ++seq };
  const body = JSON.stringify(payload);
  ws.send(JSON.stringify({ type: 'command', body, mac: await hmac(body) }));
}
function coords(e) {
  const r = $('screen').getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (e.clientX-r.left)/r.width)), y: Math.max(0, Math.min(1, (e.clientY-r.top)/r.height)) };
}
$('connect').onclick = () => {
  secretKey = $('secret').value;
  if (!secretKey || secretKey.length < 8) return $('status').textContent = '访问密钥至少 8 个字符';
  try { ws = new WebSocket($('relay').value); } catch { return $('status').textContent = '中继地址无效'; }
  $('status').textContent = '正在连接…';
  ws.onopen = () => ws.send(JSON.stringify({ type:'join', role:'controller', room:$('room').value }));
  ws.onmessage = async e => { let m; try { m=JSON.parse(e.data) } catch{return}
    if(m.type==='joined'){ $('login').hidden=true;$('desk').hidden=false;$('live').textContent='正在验证身份';clientNonce=randomHex();ws.send(JSON.stringify({type:'authHello',clientNonce})); }
    if(m.type==='authChallenge' && m.clientNonce===clientNonce){const proof=await hmac(clientNonce+':'+m.hostNonce);ws.send(JSON.stringify({type:'authProof',clientNonce,hostNonce:m.hostNonce,proof}))}
    if(m.type==='authOk'){$('live').textContent='身份已验证，等待画面'}
    if(m.type==='frame'){ $('screen').src='data:image/jpeg;base64,'+m.data;$('live').textContent='在线'; }
  };
  ws.onclose = () => { $('live').textContent='已断开'; $('status').textContent='连接已断开'; };
};
$('disconnect').onclick=()=>{if(ws)ws.close();$('desk').hidden=true;$('login').hidden=false};
let lastMove=0;
$('screen').onmousemove=e=>{if(Date.now()-lastMove>45){lastMove=Date.now();sendCommand('move',coords(e))}};
$('screen').onmousedown=e=>{e.preventDefault();sendCommand('mouseDown',{...coords(e),button:e.button})};
$('screen').onmouseup=e=>{e.preventDefault();sendCommand('mouseUp',{...coords(e),button:e.button})};
$('screen').onwheel=e=>{e.preventDefault();sendCommand('wheel',{delta:Math.sign(e.deltaY)*-120})};
$('screen').oncontextmenu=e=>e.preventDefault();
window.onkeydown=e=>{if(!$('desk').hidden){e.preventDefault();sendCommand('keyDown',{key:e.key,code:e.code})}};
window.onkeyup=e=>{if(!$('desk').hidden){e.preventDefault();sendCommand('keyUp',{key:e.key,code:e.code})}};
if(initial.get('connect')==='1') setTimeout(()=>$('connect').click(),150);
