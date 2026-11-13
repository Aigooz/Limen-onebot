import { BotError } from '../../errors.mjs';
import { kernelText } from './messages.mjs';
import { id } from '../../messages.mjs';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const hasImages = message => Array.isArray(message)&&message.some(segment=>segment.type==='image');
export const hasMedia = message => Array.isArray(message)&&message.some(segment=>['image','record','file'].includes(segment.type));
export function validateKernelMessage(message) {
  if(!Array.isArray(message)||!message.length||message.length>1000)throw new BotError('Invalid QQ message',1400);
  let chars=0,images=0,records=0,files=0,replies=0;
  for(const segment of message) {
    if(segment.type==='text'&&typeof segment.data?.text==='string'){chars+=segment.data.text.length;continue;}
    if(segment.type==='at'){if(segment.data?.qq!=='all')id(segment.data?.qq,'at.qq');continue;}
    if(segment.type==='reply'){id(segment.data?.id,'reply.id',{signed:true});if(++replies>1)throw new BotError('Only one reply segment is allowed',1400);continue;}
    if(segment.type==='record'&&typeof segment.data?.file==='string'&&segment.data.file){records++;continue;}
    if(segment.type==='file'&&typeof segment.data?.file==='string'&&segment.data.file){files++;continue;}
    if(segment.type==='image'&&typeof segment.data?.file==='string'&&segment.data.file){
      images++;
      if(segment.data.type==='flash')throw new BotError('Flash images are not supported',1404);
      if(segment.data.sub_type!==undefined&&![0,1,'0','1'].includes(segment.data.sub_type))throw new BotError('Only normal images and image stickers are supported',1404);
      continue;
    }
    throw new BotError('Official kernel sends text, image, record and file segments; this message segment is unsupported',1404);
  }
  if(records&&(records!==1||message.length!==1))throw new BotError('Send a voice record as a separate message',1400);
  if(files&&(files!==1||message.length!==1))throw new BotError('Send a file as a separate message',1400);
  if(chars>10000||images>20||(!chars&&!images&&!records&&!files))throw new BotError('QQ message exceeds text or image count limits',1400);
}
/** Local files only: the protocol side never fetches a URL on behalf of a client. */
export async function prepareFileElement(segment, maxBytes, signal) {
  const raw = String(segment.data.file || '');
  if (/^https?:/i.test(raw)) throw new BotError('HTTP file URLs are not supported; send a local path or file:// URL',1404);
  let path;
  try { path = raw.startsWith('file:') ? fileURLToPath(raw) : raw; } catch { throw new BotError('Invalid file URL',1400); }
  path = resolve(path);
  if (!isAbsolute(path)) throw new BotError('File path must be absolute',1400);
  signal?.throwIfAborted();
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size < 1) throw new BotError('File does not exist or is empty',1404);
  if (info.size > maxBytes) throw new BotError('File exceeds MEDIA_MAX_BYTES',1400);
  const bytes = await readFile(path);
  const name = String(segment.data.name || '').trim() || basename(path);
  return { filePath: path, fileName: name.slice(0,180), fileSize: String(bytes.length),
    fileMd5: createHash('md5').update(bytes).digest('hex') };
}
export async function prepareKernelElements(message,cache,signal,msgService,voiceCache,context={}) {
  validateKernelMessage(message);
  const elements=[],leases=[];let bytes=0;
  const release=()=>{for(const image of leases)image.release();};
  try {
    for(const segment of message) {
      signal?.throwIfAborted();
      if(segment.type==='text') { if(segment.data.text)elements.push(...kernelText([segment]));continue; }
      if(segment.type==='at') {
        if(context.kind!=='group')throw new BotError('Mentions are only supported in groups',1400);
        const all=segment.data.qq==='all',qq=String(segment.data.qq);
        const contact=all?null:await context.resolveMention(qq);
        elements.push({elementType:1,elementId:'',textElement:{content:all?'@全体成员':'@'+(contact.nickname||qq),
          atType:all?1:2,atUid:all?'0':qq,atNtUid:contact?.uid||'',atNtUin:all?'':qq,atTinyId:''}});
        continue;
      }
      if(segment.type==='reply') {
        const raw=context.reply;
        if(!raw?.msgId)throw new BotError('Reply source is unavailable',1404);
        elements.push({elementType:7,elementId:'',replyElement:{replayMsgId:String(raw.msgId),replayMsgSeq:String(raw.msgSeq||'0'),
          senderUin:String(raw.senderUin),senderUinStr:String(raw.senderUin),replyMsgClientSeq:String(raw.clientSeq||'0')}});
        continue;
      }
      if(segment.type==='record') {
        if(!voiceCache)throw new BotError('QQ voice cache is unavailable',1501);
        const voice=await voiceCache.acquire(segment.data.file,{signal});leases.push(voice);
        const filePath=await voiceCache.stage(voice,msgService,signal);
        elements.push({elementType:4,elementId:'',extBufForUI:'',pttElement:{
          fileName:voice.md5+'.silk',filePath,md5HexStr:voice.md5,fileSize:String(voice.bytes.length),
          duration:voice.duration,formatType:1,voiceType:1,voiceChangeType:0,canConvert2Text:true,
          waveAmplitudes:voice.waveAmplitudes,fileSubId:'',playState:1,autoConvertText:0,storeID:0,otherBusinessInfo:{aiVoiceType:0}
        }});
        continue;
      }
      if(segment.type==='file') {
        const file=await prepareFileElement(segment,context.maxFileBytes||30*1024*1024,signal);
        elements.push({elementType:3,elementId:'',fileElement:{fileName:file.fileName,filePath:file.filePath,
          fileSize:file.fileSize,fileMd5:file.fileMd5,fileUuid:'',fileSubId:'',fileBizType:0,fileId:''}});
        continue;
      }
      if(!cache)throw new BotError('QQ image cache is unavailable',1501);
      const image=await cache.acquire(segment.data.file,{signal});leases.push(image);bytes+=image.bytes.length;
      if(bytes>cache.maxBytes)throw new BotError('Total message image bytes exceed MEDIA_MAX_BYTES',1400);
      const sourcePath=await cache.stage(image,msgService,signal);
      const summary=typeof segment.data.summary==='string'?Array.from(segment.data.summary).slice(0,120).join(''):'';
      elements.push({elementType:2,elementId:'',extBufForUI:'',picElement:{
        sourcePath,md5HexStr:image.md5,fileName:image.md5+'.'+image.format,fileSize:String(image.bytes.length),
        picWidth:image.width,picHeight:image.height,original:segment.data.original!==false&&segment.data.original!=='false',
        picType:image.format==='gif'?2000:1000,picSubType:Number(segment.data.sub_type??(image.format==='gif'?1:0)),
        fileUuid:'',fileSubId:'',thumbFileSize:0,summary,isFlashPic:false
      }});
    }
    return {elements,release};
  }catch(error){release();throw error;}
}
