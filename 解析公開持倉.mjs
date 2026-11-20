// 僅擷取少量公開申報事實。未知值保留 null，絕不由買賣紀錄推算完整現倉。
export const URLS=Object.freeze({
 home:'https://www.dataroma.com/m/home.php',
 common:'https://www.dataroma.com/m/g/portfolio.php?o=c&pct=0',
 buys:'https://www.dataroma.com/m/g/portfolio_b.php?q=q&o=c',
 directory:'https://quantellect.ai/us/congress/politicians',
 pelosi:'https://quantellect.ai/us/congress/politicians/nancy-pelosi/P000197',
 trump:'https://quantellect.ai/us/trump-stock-tracker'
});
const number=v=>{const n=Number(String(v??'').replace(/[,$%\s]/g,''));return String(v??'').trim()&&Number.isFinite(n)?n:null};
export function text(s){return String(s??'').replace(/<script\b[\s\S]*?<\/script>/gi,'').replace(/<style\b[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&#(x[\da-f]+|\d+);?/gi,(_,v)=>{const n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<=0x10ffff?String.fromCodePoint(n):''}).replace(/&nbsp;?/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/\s+/g,' ').trim()}
function table(html,id='grid'){
 const t=html.match(new RegExp('<table\\b[^>]*\\bid=["\\\']'+id+'["\\\'][^>]*>([\\s\\S]*?)<\\/table>','i'))?.[1];
 if(!t)throw Error('SOURCE_TABLE_MISSING');return [...t.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)].map(m=>({attrs:m[1],html:m[2],cells:[...m[2].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].map(c=>({attrs:c[1],html:c[2],text:text(c[2])}))}));
}
function sym(c){const s=c?.html.match(/stock\.php\?sym=([^"&]+)/)?.[1];return s&&/^[A-Z0-9.\-]{1,12}$/.test(s)?s:null}
function manager(c){const id=c?.html.match(/holdings\.php\?m=([A-Za-z0-9_-]+)/)?.[1];return id?{id,name:c.text,url:'https://www.dataroma.com/m/holdings.php?m='+id}:null}
export function parseCoverage(html){
 const count=number(text(html).match(/Currently tracking portfolios of (\d+) Superinvestors/i)?.[1]);
 const quarter=text(html).match(/Top 10 buys last qtr\s*\(?\s*(Q[1-4])\s+(20\d\d)/i);
 const filings=text(html).match(/Based on (\d+) out of (\d+) SuperInvestor filings/i);
 if(!count||!quarter||!filings||Number(filings[2])!==count)throw Error('COHORT_DATE_UNVERIFIED');
 return {tracked:count,latest_quarter:quarter[2]+'-'+quarter[1],quarter_filings:Number(filings[1]),quarter_total:Number(filings[2]),source_url:URLS.home};
}
export function parseCommon(html){
 const result=table(html).filter(r=>sym(r.cells[0])).map(r=>({ticker:sym(r.cells[0]),name:r.cells[1].text,holders:number(r.cells[3].text),source_url:'https://www.dataroma.com/m/stock.php?sym='+sym(r.cells[0])}));
 if(result.length<10||result.some(r=>!Number.isSafeInteger(r.holders)||r.holders<1))throw Error('COMMON_HOLDINGS_INCOMPLETE');
 if(result.slice(1).some((r,i)=>r.holders>result[i].holders))throw Error('COMMON_HOLDINGS_NOT_SORTED');
 return result.slice(0,10).map((r,i)=>({...r,rank:i+1}));
}
export function parseActivity(html,quarter){
 const rows=table(html),out=[];let active=false,ended=false,seenQuarter=false;
 for(const r of rows){
  if(/q_chg/.test(r.attrs)){
   const m=text(r.html).match(/(Q[1-4])\s+(20\d\d)/);if(!m)throw Error('ACTIVITY_DATE_MISSING');const q=m[2]+'-'+m[1];
   if(active){ended=true;break;}active=q===quarter;seenQuarter||=active;continue;
  }
  if(!active||r.cells.length<5)continue;const who=manager(r.cells[1]);if(!who)throw Error('MANAGER_ID_MISSING');
  const action=r.cells[2].text,kind=/^(Add|Buy)/i.test(action)?'buy':/^(Reduce|Sell)/i.test(action)?'sell':null;
  if(!kind)throw Error('ACTIVITY_KIND_UNKNOWN');const change=number(r.cells[3].text);if(change===null||change<0)throw Error('ACTIVITY_AMOUNT_INVALID');
  out.push({...who,kind,action,share_change:change});
 }
 // 最新季度若跨分頁，不能把未讀到的紀錄當零；交由更新器保留上次完整結果。
 if(!seenQuarter||!ended&&/\bNext\b/.test(text(html.match(/<div id="pages">([\s\S]*?)<\/div>/)?.[1]||'')))throw Error('ACTIVITY_QUARTER_INCOMPLETE');
 if(new Set(out.map(r=>r.id)).size!==out.length)throw Error('DUPLICATE_MANAGER_ACTIVITY');
 const buys=out.filter(r=>r.kind==='buy'),sells=out.filter(r=>r.kind==='sell');
 return {quarter,buyers:buys.length,sellers:sells.length,buy_shares:buys.reduce((s,r)=>s+r.share_change,0),sell_shares:sells.reduce((s,r)=>s+r.share_change,0),
  inclination:buys.length>sells.length?'buy':buys.length<sells.length?'sell':'balanced',
  sample_buyers:buys.slice(0,2).map(({name,url})=>({name,url})),sample_sellers:sells.slice(0,2).map(({name,url})=>({name,url}))};
}
export function parseHolders(html,expected){
 const rows=table(html).filter(r=>r.cells.length===6&&manager(r.cells[1]));
 if(rows.length!==expected)throw Error('HOLDER_COUNT_MISMATCH');
 return rows.slice(0,3).map(r=>({...manager(r.cells[1]),portfolio_weight:number(r.cells[2].text),shares:number(r.cells[4].text)}));
}
export function rscObjects(html){
 const data=[...html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?)\)<\/script>/g)].flatMap(m=>{try{return JSON.parse(m[1]).filter(x=>typeof x==='string')}catch{return[]}}).join('\n'),objects=[];
 function visit(v,depth=0){
  if(depth>18)return;
  if(typeof v==='string'&&v.length<4000000&&/^[\[{]/.test(v)){try{visit(JSON.parse(v),depth+1)}catch{}return}
  if(Array.isArray(v)){for(const x of v)visit(x,depth+1);return}
  if(v&&typeof v==='object'){objects.push(v);for(const x of Object.values(v))visit(x,depth+1)}
 }
 for(const line of data.split('\n')){const i=line.indexOf(':');if(i<0)continue;try{visit(JSON.parse(line.slice(i+1)))}catch{}}
 return objects;
}
const slug=name=>name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,'').trim().replace(/[\s-]+/g,'-');
export function parseRanking(html){
 const all=rscObjects(html),rows=[...new Map(all.filter(r=>r.bwRank&&r.id&&r.politicianName&&typeof r.winRate==='number').map(r=>[r.id,r])).values()];
 const rated=all.find(r=>r.bwRankTotal)?.bwRankTotal;
 if(rows.length<15||!rated)throw Error('RANKING_SOURCE_INCOMPLETE');
 const eligible=rows.filter(r=>r.bwEligiblePricedBuys24mo>=20&&r.winRate>=0&&r.winRate<=1);
 if(eligible.length<10)throw Error('RANKING_SAMPLE_TOO_SMALL');
 const candidates=eligible.sort((a,b)=>b.winRate-a.winRate||b.bwEligiblePricedBuys24mo-a.bwEligiblePricedBuys24mo).map((r,i)=>({rank:i+1,id:r.id,name:r.politicianName,win_rate:r.winRate,priced_buys:r.bwEligiblePricedBuys24mo,
   source_url:'https://quantellect.ai/us/congress/politicians/'+slug(r.politicianName)+'/'+r.id}));
 return {coverage:rows.length,rated_cohort:rated,minimum_priced_buys:20,eligible:eligible.length,scope:'public_directory_sample',window:'24mo',rows:candidates.slice(0,10),candidates,source_url:URLS.directory};
}
function isoDate(s){if(/^\d{4}-\d{2}-\d{2}$/.test(s||''))return s;const n=Date.parse(s||'');return Number.isFinite(n)?new Date(n).toISOString().slice(0,10):null}
export function parseProfile(html,{id,name,source_url,trump=false}){
 const objects=rscObjects(html),profits=objects.find(r=>r.windows?.['24mo']?.basis==='estimated_unrealized_profit')?.windows['24mo'];
 if(!profits||profits.winRate!==null&&(!Number.isFinite(profits.winRate)||profits.winRate<0||profits.winRate>1)||!Number.isSafeInteger(profits.pricedBuys)||profits.wins>profits.pricedBuys||profits.pricedBuys>profits.totalBuys)throw Error('PROFILE_STATISTICS_INVALID');
 if(profits.pricedBuys&&Math.abs(profits.wins/profits.pricedBuys-profits.winRate)>.00011)throw Error('PROFILE_RATE_CONFLICT');
 const trades=trump?objects.filter(r=>r.transactionDate&&r.filedDate&&r.securityName&&r.transactionType):objects.filter(r=>r.tradedDate&&r.publishedDate&&r.transactionType&&r.companyName);
 const unique=[...new Map(trades.map(t=>[t.id,t])).values()].map(t=>({ticker:t.ticker||null,name:trump?t.securityName:t.companyName,
  action:/sell|sale/i.test(t.transactionType)?'sell':/buy|purchase/i.test(t.transactionType)?'buy':'other',
  transaction_date:isoDate(trump?t.transactionDate:t.tradedDate),filed_date:isoDate(trump?t.filedDate:t.publishedDate),
  amount:String(trump?t.amountBand:t.size||'').replace(/^\$\$/,'$'),source_url:trump?t.filingUrl:source_url})).filter(t=>t.transaction_date&&t.filed_date);
 unique.sort((a,b)=>b.filed_date.localeCompare(a.filed_date)||b.transaction_date.localeCompare(a.transaction_date));
 return {id,name,source_url,window:'24mo',window_start:profits.windowStart,priced_through:profits.windowEnd,win_rate:profits.winRate,
  wins:profits.wins,priced_buys:profits.pricedBuys,total_buys:profits.totalBuys,return_pct:profits.weightedReturnPct,
  performance_basis:'estimated_unrealized_buy_only',latest_filed:unique[0]?.filed_date||null,trades:unique.slice(0,3),
  positions:null,positions_note:'買賣申報沒有完整成本、期末數量及所有賣出配對；不推算目前持倉。'};
}
