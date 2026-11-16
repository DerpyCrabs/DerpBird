import favicons from './assets/workspaces/favicons.json';
export const favicon=(name:string)=>(favicons as Record<string,string>)[name]??favicons.globe;
