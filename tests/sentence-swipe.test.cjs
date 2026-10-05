const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { SentenceSwipe } = require('../utils/sentence-swipe');
const touch=(x,y=0)=>[{clientX:x,clientY:y}];
const paths={
 vertical:[[1,20],[4,80],[2,120]],
 rightDrift:[[4,15],[20,60],[40,100]],
 leftDrift:[[-5,20],[-25,70],[-45,110]],
 horizontalThenVertical:[[-15,1],[-40,90],[-55,120]],
 horizontalThenDiagonal:[[15,0],[40,35]],
 verticalThenHorizontal:[[1,25],[-70,28]],
 diagonal:[[-12,10],[-45,40]],
 reverseHorizontal:[[-20,0],[45,2]],
 closedRight:[[20,0],[60,2]],
};
for(const [name,points] of Object.entries(paths)) test(`gesture ${name} cannot reveal a closed row or become a tap`,()=>{
 const s=new SentenceSwipe();s.start(touch(100,100),false,0);let time=0;
 for(const [x,y] of points)s.move(touch(100+x,100+y),time+=40);
 assert.equal(s.end(time+20),null);assert.equal(s.blockTap,true);
});
test('clear horizontal gestures change state once, final drift invalidates, and successive gestures have no axis residue',()=>{
 const s=new SentenceSwipe();
 for(let i=0;i<20;i++) {
  s.start(touch(100),false,0);s.move(touch(50,2),50);assert.equal(s.end(100),true);
  s.start(touch(100),true,0);s.move(touch(50,2),50);assert.equal(s.end(100),null);
  s.start(touch(50),true,0);s.move(touch(100,2),50);assert.equal(s.end(100),false);
  s.start(touch(100),false,0);s.move(touch(85,0),30);s.move(touch(40,75),60);assert.equal(s.end(80),null);
 }
});
function component(){
 let definition;vm.runInNewContext(fs.readFileSync('components/sentence-row/sentence-row.js','utf8'),{require:()=>({SentenceSwipe}),Component:d=>definition=d});
 const events=[],c={...definition.methods,properties:{item:{id:'s',index:1,available:true,saved:true},opened:false},data:{scrolling:false},setData(v){Object.assign(this.data,v);},triggerEvent(name,detail){events.push({name,detail});}};
 definition.lifetimes.attached.call(c);return {c,events,scroll(){definition.observers.scrollEpoch.call(c);}};
}
test('scroll cancels a horizontal candidate before end; synthetic trailing tap cannot play, save or navigate',()=>{
 const {c,events,scroll}=component();c.start({touches:touch(100)});c.move({touches:touch(55)});scroll();c.end({changedTouches:touch(50)});c.play();c.favorite();c.source();
 assert.equal(events.length,0);assert.equal(c.data.scrolling,true);
 c.start({touches:touch(100)});c.end({changedTouches:touch(100)});c.play();assert.equal(events[0].name,'play');assert.equal(c.data.scrolling,false);
});
test('final touch coordinates cancel a candidate, multi-touch/cancel/long press suppress trailing actions',()=>{
 for(const kind of ['final-vertical','multi','cancel','hold']) {
  const {c,events}=component();c.start({touches:touch(100,100)});c.move({touches:touch(85,100)});
  if(kind==='multi')c.move({touches:[...touch(55,100),...touch(120,100)]});
  if(kind==='cancel')c.cancel();if(kind==='hold')c.hold();
  c.end({changedTouches:kind==='final-vertical'?touch(50,180):touch(50,100)});c.play();c.favorite();c.source();assert.equal(events.length,0,kind);
 }
});
test('same target does not emit reveal, new star tap still writes once without playing',()=>{
 const {c,events}=component();c.start({touches:touch(100)});c.move({touches:touch(40)});c.properties.opened=true;c.end();assert.equal(events.length,0);
 c.start({touches:touch(100)});c.end();c.favorite();assert.equal(events.length,1);assert.equal(events[0].name,'favorite');assert.equal(events[0].detail.saved,false);
});
