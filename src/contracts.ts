export type MediaKind = 'audio' | 'image' | 'video' | 'document';
export type Action = {id:string;type:'text';text:string} | {id:string;type:'pix';key:string;holder:string;bank?:string;text?:string} | {id:string;type:MediaKind;mediaId:string;name:string;caption?:string;mimetype?:string};
export interface Reply {id:string;title:string;categoryId:string;shortcut?:string;favorite:boolean;actions:Action[]}
export interface Attendant {id:string;name:string;active:boolean}
export interface Conversation {key:string;accountId:string;chatId:string;name?:string;labels:string[];stageId:string;attendantId?:string;updatedAt:number}
export type SessionStatus = 'offline' | 'connecting' | 'connected' | 'qr' | 'reconnecting' | 'logged_out' | 'error';
export interface Session {id:string;name:string;phone:string;status:SessionStatus;qrDataUrl?:string;updatedAt:number;error?:string;source:'web'|'bridge'}
export interface SendJob {id:string;accountId:string;chatId:string;replyId:string;status:'running'|'completed'|'failed';completed:number;at:number;error?:string}
export type MainCommand = {type:'status';payload:Record<string,never>} | {type:'signature';payload:{enabled:boolean;name:string;attendantId:string}} | {type:'send';payload:{operationId:string;accountId:string;chatId:string;action:Action&{data?:string};quotedMsg?:string}};
