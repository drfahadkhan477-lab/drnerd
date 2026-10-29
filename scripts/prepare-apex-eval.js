#!/usr/bin/env node
'use strict';
// Capture actual outgoing app requests using invented notes. No model is called,
// no answer is graded, and no credentials are needed or read.
const fs=require('fs');
const path=require('path');
const {pathToFileURL}=require('url');
const {launch}=require('../tests/_engine');
const {booted}=require('../tests/_render');
const {isSyntheticBuild}=require('./synthetic-export');
const cases=require('../tests/fixtures/apex-grounding/cases.json');
async function main(){
  const [input,output]=process.argv.slice(2);
  if(input==='--help'){console.log('Usage: node scripts/prepare-apex-eval.js <synthetic-build.html> <new-report.json>\nCaptures evaluation requests offline. All answer verdicts remain unmeasured.');return;}
  if(!input||!output)throw Error('Provide a synthetic build and a new output path; use --help.');
  if(!isSyntheticBuild(input))throw Error('Refusing an unmarked build: evaluations require synthetic content.');
  if(fs.existsSync(output))throw Error('Refusing to overwrite an existing report.');
  const browser=await launch();
  const report={version:1,mode:'offline-request-capture',liveModelCalled:false,answerQuality:'unmeasured',cases:[]};
  try{
    for(const fixture of cases.cases){
      const context=await browser.newContext();
      const captured=[];
      try{
        await context.route('**/*',route=>{
          const url=new URL(route.request().url());
          if(url.hostname==='generativelanguage.googleapis.com'){
            captured.push(JSON.parse(route.request().postData()||'{}'));
            return route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({candidates:[{content:{role:'model',parts:[{text:'Evaluation request captured; no model was called.'}]}}]})+'\n\n'});
          }
          if(url.protocol==='http:'||url.protocol==='https:')return route.abort();
          return route.continue();
        });
        const page=await context.newPage();
        await page.goto(pathToFileURL(path.resolve(input)).href);
        await booted(page);
        await page.evaluate(f=>{
          REF.length=0;REF.push(...f.notes);invalidateIndex();
          AI_GROUNDED=true;AI.provider='gemini';AI.gemini={key:'offline-evaluation-placeholder',model:'evaluation-model'};
          CHATS={};S.screen='home';fire(f.question);
        },fixture);
        await page.waitForFunction(()=>!aiBusy,null,{timeout:30000});
        if(captured.length!==1)throw Error('Expected one intercepted request for '+fixture.id);
        report.cases.push({...fixture,request:captured[0],answer:null,verdict:'unmeasured',reviewerNotes:null});
      }finally{await context.close();}
    }
  }finally{await browser.close();}
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(`Prepared ${report.cases.length} offline cases. Live answers graded: 0.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
