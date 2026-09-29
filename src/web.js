const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const PUBLIC = path.join(__dirname, '..', 'public');
function createServer() {
  return http.createServer((req, res) => {
    const host = (req.headers.host || '');
    if (!host.includes('127.0.0.1') && !host.includes('localhost')) { res.statusCode = 403; res.end('Forbidden'); return; }
    const url = req.url.split('?')[0];
    if (url === '/' || url === '/index.html') { res.writeHead(200, {'Content-Type':'text/html'}); fs.readFile(path.join(PUBLIC,'index.html'),(e,d)=>res.end(e?'Not found':d)); return; }
    if (url === '/style.css') { res.writeHead(200, {'Content-Type':'text/css'}); fs.readFile(path.join(PUBLIC,'style.css'),(e,d)=>res.end(e?'':d)); return; }
    if (url === '/app.js') { res.writeHead(200, {'Content-Type':'application/javascript'}); fs.readFile(path.join(PUBLIC,'app.js'),(e,d)=>res.end(e?'':d)); return; }
    if (url === '/api/settings' && req.method === 'GET') { res.writeHead(200, {'Content-Type':'application/json'}); try { const s = JSON.parse(fs.readFileSync(path.join(os.homedir(),'.petcam','settings.json'),'utf8')); const out = {...s, botToken: s.botToken ? '***hidden***' : undefined}; if (req.url.includes('reveal=1') && s.botToken) out.botToken = s.botToken; res.end(JSON.stringify(out)); } catch(e){ res.end(JSON.stringify({error:'no settings'})); } return; }
    if (url === '/api/settings' && req.method === 'POST') { let b=''; req.on('data',c=>b+=c); req.on('end',()=>{ try { const d=JSON.parse(b); fs.mkdirSync(path.join(os.homedir(),'.petcam'),{recursive:true}); fs.writeFileSync(path.join(os.homedir(),'.petcam','settings.json'),JSON.stringify(d,null,2)); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true})); } catch(e){ res.writeHead(400); res.end(JSON.stringify({error:'bad json'})); } }); return; }
    if (url === '/media') { res.writeHead(200, {'Content-Type':'application/json'}); const p = fs.existsSync(path.join(os.homedir(),'.petcam','photos')) ? fs.readdirSync(path.join(os.homedir(),'.petcam','photos')) : []; const v = fs.existsSync(path.join(os.homedir(),'.petcam','videos')) ? fs.readdirSync(path.join(os.homedir(),'.petcam','videos')) : []; res.end(JSON.stringify({photos:p, videos:v})); return; }
    res.statusCode=404; res.end('Not found');
  });
}
function start(port){ const s=createServer(); s.listen(port||8765,'127.0.0.1',()=>console.log('Petcam web 127.0.0.1:'+(port||8765))); return s; }
function stop(s){ if(s) s.close(); }
module.exports = { createServer, start, stop };
