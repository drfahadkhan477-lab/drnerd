'use strict';
/* The hero's trace on Home: shown, and drawn frame after frame. (It was also held hidden under the illustration, which a
   button offered; that button is gone with the Quiet Atlas hero, and the hero is always the live one.) */
module.exports=async function homeECG(page){
  return page.evaluate(async()=>{
    const frames=()=>new Promise(resolve=>{let n=0;const frame=()=>++n<20?requestAnimationFrame(frame):resolve();requestAnimationFrame(frame);});
    const canvas=document.getElementById('heroECG'),context=canvas.getContext('2d'),stroke=context.stroke;
    let paints=0;
    context.stroke=function(...args){paints++;return stroke.apply(this,args);};
    try{
      const shown=getComputedStyle(canvas).visibility,box=canvas.getBoundingClientRect();
      await frames();
      return {shown,width:Math.round(box.width),live:paints};
    }finally{context.stroke=stroke;}
  });
};
