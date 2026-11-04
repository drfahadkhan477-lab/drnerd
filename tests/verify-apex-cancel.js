const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('app/systole.html','utf8');
const start=source.indexOf('async function streamReply('),end=source.indexOf('function pushToolExchange(',start);
let actions=0,saves=0;
const ctx={AbortController,CTX_BUDGET:5200,AI_CHAT:'test',CHATS:{},AI_GROUNDED:false,apexWire:()=>[],apexSetState:()=>{},saveJSON:()=>saves++,apexAway:()=>false,runTool:()=>{actions++;return {result:'done'}},pushToolExchange:()=>{},buildAI:()=>{},flushNav:()=>{},lastHits:[]};
ctx.oneTurn=async()=>{ctx.aiAbort.abort();return {text:'',calls:[{name:'save_note',input:{}}]}};
vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
(async()=>{await ctx.streamReply(null,[],'');assert.equal(actions,0,'a cancelled response must not execute tools');assert.equal(saves,0,'a cancelled response must not save a partial exchange');console.log('PASS cancelled response cannot run tools or save conversation');console.log('2 passed, 0 failed');})().catch(e=>{console.error(e.message);process.exitCode=1});
