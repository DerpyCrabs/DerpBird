import type {JSX} from 'effectweb';
import X from '@effectweb/lucide/icons/x';
import {ShellDialog} from './Overlay';
import './preferences-primitives.css';

/** Opt-in design primitives: styles are contained by .preferences-theme. */
export function PreferenceSection(props:{title:string;description?:string;children?:JSX.Element}){
 return <section class="pref-section"><header><h2>{props.title}</h2>{props.description?<p>{props.description}</p>:null}</header><div class="pref-section-body">{props.children}</div></section>;
}
export function PreferenceField(props:{id:string;label:string;description?:string;error?:string;children?:JSX.Element}){
 return <div class="pref-field"><label for={props.id}>{props.label}</label><div class="pref-field-control">{props.children}{props.error?<p id={`${props.id}-error`} class="pref-error" role="alert">{props.error}</p>:null}{props.description?<p id={`${props.id}-description`} class="pref-description">{props.description}</p>:null}</div></div>;
}
export function PreferenceCheckbox(props:{id:string;label:string;description?:string;checked:boolean;disabled?:boolean;onChange:(checked:boolean)=>void}){
 return <div class="pref-check-row"><input id={props.id} type="checkbox" checked={props.checked} disabled={props.disabled} aria-describedby={props.description?`${props.id}-description`:undefined} onChange={e=>props.onChange(e.currentTarget.checked)}/><div><label for={props.id}>{props.label}</label>{props.description?<p id={`${props.id}-description`}>{props.description}</p>:null}</div></div>;
}
export function PreferencesDialog(props:{id:string;title:string;description:string;theme?:'dark'|'light';children?:JSX.Element;trigger:()=>HTMLElement|null;initialFocus?:()=>HTMLElement|null;onDismiss:()=>void}){
 return <ShellDialog class={`preferences-theme pref-dialog${props.theme==='light'?' pref-light':''}`} aria-labelledby={`${props.id}-title`} aria-describedby={`${props.id}-description`} trigger={props.trigger} restoreFocus={true} initialFocus={props.initialFocus} onDismiss={props.onDismiss}>
  <header class="pref-dialog-heading"><h2 id={`${props.id}-title`}>{props.title}</h2><button class="pref-icon-button" type="button" aria-label="Close dialog" onClick={props.onDismiss}><X size={18}/></button></header>
  <p class="pref-dialog-description" id={`${props.id}-description`}>{props.description}</p>{props.children}
 </ShellDialog>;
}
