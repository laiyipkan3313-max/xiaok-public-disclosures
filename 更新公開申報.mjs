import fs from'node:fs/promises';import{buildSnapshot}from'./建立披露快照.mjs';
let calls=0,last=0;
let annual=null;try{annual=JSON.parse(await fs.readFile('人物年度持倉.json','utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
const data=await buildSnapshot(async(_name,url)=>{
 if(++calls>49)throw Error('公開來源讀取超出本輪上限');
 const delay=Math.max(0,last+750-Date.now());if(delay)await new Promise(r=>setTimeout(r,delay));last=Date.now();
 const u=new URL(url);if(!['www.dataroma.com','quantellect.ai'].includes(u.hostname)||u.protocol!=='https:')throw Error('來源不在白名單');
 const r=await fetch(u,{headers:{Accept:'text/html','User-Agent':'XiaoK-DisclosureResearch/1.0'},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('原始來源讀取失敗 '+r.status);const text=await r.text();if(text.length>6000000)throw Error('原始來源超出大小上限');return text;
},null,annual);
await fs.writeFile('最新披露.json',JSON.stringify(data));
console.log(JSON.stringify({updated_at:data.updated_at,source_reads:calls,stocks:data.common.rows.length,people:data.people.rows.length,paid_ai_calls:0}));
