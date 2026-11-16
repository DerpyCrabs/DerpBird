export const layoutDemo = {
 id:'derpbird-browser-layouts',projectId:'derpbird',name:'Browser layout · tabs & address',
 description:'Production DerpBird layout settings, shell, tab interactions and address palette with a stateful native boundary fixture.',
 panes:[
  ['classic','Classic · tabs above address',{preset:'classic'}],
  ['side-left-top','Left tabs · top address',{preset:'sidebar'}],
  ['side-right-top','Right tabs · top address',{preset:'sidebar',side:'right'}],
  ['side-left-bottom','Left tabs · bottom address',{preset:'sidebar',address:'bottom'}],
  ['side-right-bottom','Right tabs · bottom address',{preset:'sidebar',side:'right',address:'bottom'}],
  ['bottom','Top tabs · bottom address',{preset:'bottom'}],
  ['compact-left','Compact · left',{preset:'compact'}],
  ['compact-right','Compact · right',{preset:'compact',side:'right'}],
  ['layout-settings','Appearance · layout settings',{preset:'sidebar',settings:true}],
  ['layout-palette','Compact · address palette',{preset:'compact',palette:true}],
 ].map(([id,name,conditions],i)=>({id,name,engine:'ladybird',viewport:{width:1000,height:760,deviceScaleFactor:'display'},position:{x:(i%3)*1040,y:Math.floor(i/3)*810},route:'/',conditions:{layoutDemo:true,...conditions as object}}))
};
