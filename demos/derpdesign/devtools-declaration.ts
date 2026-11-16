export const devtoolsDemo = {
 id:'derpbird-devtools',projectId:'derpbird',name:'Developer tools',
 description:'Shipping EffectWeb developer tools and native protocol adapter, with a deterministic external transport fixture. Elements, Console, Sources, searchable Network; browser-menu integration.',
 panes:[
  {id:'devtools-browser',name:'Browser · Inspect menu',engine:'ladybird',viewport:{width:1280,height:800,deviceScaleFactor:'display'},position:{x:3440,y:0},route:'/',conditions:{devtoolsShell:true,layout:'horizontal'}},
  {id:'devtools-wide',name:'Network · 1280',engine:'ladybird',viewport:{width:1280,height:800,deviceScaleFactor:'display'},position:{x:0,y:0},route:'/',conditions:{devtools:true}},
  {id:'devtools-compact',name:'Network · 760',engine:'ladybird',viewport:{width:760,height:800,deviceScaleFactor:'display'},position:{x:1320,y:0},route:'/',conditions:{devtools:true}},
  {id:'devtools-large',name:'10,000 requests · 12,000 objects',engine:'ladybird',viewport:{width:1280,height:800,deviceScaleFactor:'display'},position:{x:2120,y:0},route:'/',conditions:{devtools:true,large:true}}
 ]
};
