'use strict';
module.exports=async function homeECG(page){
  return page.evaluate(async()=>{
    const frames=()=>new Promise(resolve=>{let n=0;const frame=()=>++n<20?requestAnimationFrame(frame):resolve();requestAnimationFrame(frame);});
    const context=document.getElementById('heroECG').getContext('2d'),stroke=context.stroke;
    let paints=0;
    context.stroke=function(...args){paints++;return stroke.apply(this,args);};
    try{
      if(atlas3D)toggleAtlas3D();
      const shown=getComputedStyle(document.getElementById('heroECG')).visibility;
      await frames();const flat=paints;
      toggleAtlas3D();paints=0;await frames();
      return {shown,flat,live:paints};
    }finally{context.stroke=stroke;}
  });
};
