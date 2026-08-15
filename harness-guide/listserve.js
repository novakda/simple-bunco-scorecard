const { createServer } = require('node:http'); const { readFileSync } = require('node:fs')
createServer((_q,s)=>{s.writeHead(200,{'content-type':'text/html','cache-control':'no-store'})
  .end(readFileSync('/home/xhiris/.claude/jobs/1feb7947/tmp/rolllist.html'))})
  .listen(31411,'0.0.0.0',()=>console.log('rolllist on :31411'))
