'use strict';
module.exports=async function checkPearlStability(page,ok){
  const stable=await page.evaluate(async()=>{
    const before={current:pearlCurrent,picked:pearlPicked,skips:pearlSkips};
    const pick=Pearl.pick;
    const base=pearlAll().find(p=>p.figKey&&refImgSrc(p.figKey));
    if(!base)return false;
    const long={...base};
    try{
      Pearl.pick=()=>long;pearlNext();Pearl.pick=pick;
      const body=document.getElementById('pearlBody');
      body.style.minHeight='0';body.style.height='1px';body.style.maxHeight='1px';
      pearlFit();
      const overflowed=body.firstElementChild.offsetHeight>body.clientHeight;
      const figure=document.getElementById('pearlFig');
      await new Promise(resolve=>{let n=0;const frame=()=>++n<40?requestAnimationFrame(frame):resolve();requestAnimationFrame(frame);});
      return overflowed&&pearlCurrent===long&&!!figure&&document.getElementById('pearlFig')===figure;
    }finally{
      Pearl.pick=pick;pearlCurrent=before.current;pearlPicked=before.picked;pearlSkips=before.skips;render();
    }
  });
  ok('an explicit Another pearl selection keeps its figure even when the text needs Show all',stable);
};
