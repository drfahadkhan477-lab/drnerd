'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(process.argv[2]||'app/systole.html','utf8');
const start=source.indexOf('async function streamReply('),end=source.indexOf('function pushToolExchange(',start);
async function check(incomplete){
 const hist=[],saved=[];
 const ctx={AbortController,CTX_BUDGET:5200,AI_CHAT:'fixture',CHATS:{fixture:hist},AI_GROUNDED:false,apexWire:()=>[],apexSetState:()=>{},saveJSON:()=>saved.push(JSON.parse(JSON.stringify(hist))),apexAway:()=>false,buildAI:()=>{},flushNav:()=>{}};
 ctx.oneTurn=async()=>({text:'Synthetic partial explanation',calls:[],incomplete});
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);await ctx.streamReply(null,hist,'');
 assert.equal(hist[0].content,'Synthetic partial explanation');
 assert.equal(hist[0].incomplete===true,incomplete);
 assert.equal(saved[0][0].incomplete===true,incomplete);
}
(async()=>{await check(true);await check(false);console.log('6 passed, 0 failed');})().catch(e=>{console.error(e);process.exitCode=1});
