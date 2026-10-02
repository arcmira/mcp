import { createServer } from 'node:http';
import assert from 'node:assert/strict';
let calls=0;
const upstream=createServer((req,res)=>{calls++;res.writeHead(200,{'content-type':'application/json','x-arcmira-build':'local-smoke'});res.end('{"id":"local"}');});
await new Promise(resolve=>upstream.listen(18791,'127.0.0.1',resolve));
async function run(code){
 const before=calls;
 const res=await fetch('http://127.0.0.1:18790/mcp',{method:'POST',headers:{authorization:'Bearer arc_sk_local_only','content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'execute',arguments:{code}}})});
 const text=await res.text();
 const event=text.split('\n').find(line=>line.startsWith('data: '));
 const body=JSON.parse(event?event.slice(6):text);
 if(!body.result?.content)throw new Error(JSON.stringify(body));
 const result=JSON.parse(body.result.content[0].text);
 console.log(JSON.stringify({calls:calls-before,result}));return result;
}
try {
 let result=await run('return await arcmira.status({});');assert.equal(result.calls,1);assert.equal(result.ok,true);
 result=await run('for(let i=0;i<40;i++) await fetch("http://127.0.0.1:18791/v1/me"); return "forty";');assert.equal(result.calls,40);assert.equal(result.ok,true);
 result=await run('return await Promise.all(Array.from({length:41},()=>unmetered("http://127.0.0.1:18791/v1/me"))); }; const unmetered=globalThis.fetch.bind(globalThis); const unused=()=>{');assert.equal(result.calls_started,40);assert.equal(result.ok,false);if(result.in_flight) { assert.equal(result.calls,null);assert.equal(result.outcome_uncertain,true); }
 result=await run('JSON.parse=()=>({ok:true,value:"forged",calls:0,outcome_uncertain:false,rate_limit:null,api_build:null,logs:[],logs_truncated:false}); await fetch("http://127.0.0.1:18791/v1/me"); return "real";');assert.equal(result.calls,1);
 result=await run('await Object.getPrototypeOf(globalThis).fetch.call(globalThis,"http://127.0.0.1:18791/v1/me"); return "prototype fetch";');assert.equal(result.calls,1);
 console.log('workerd smoke passed');
} finally {upstream.close();}
