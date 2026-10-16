import {createHash,timingSafeEqual} from 'node:crypto';
const digest=v=>createHash('sha256').update(v).digest();
export function authorized(header,user,password){
 if(!password)return false;
 try{if(!header?.startsWith('Basic '))return false;const decoded=Buffer.from(header.slice(6),'base64').toString('utf8');return timingSafeEqual(digest(decoded),digest(`${user}:${password}`));}catch{return false;}
}
export function validPublicUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname.includes('.')&&!/^[\d.]+$/.test(u.hostname)&&!u.hostname.includes(':')&&!/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(u.hostname);}catch{return false;}}
