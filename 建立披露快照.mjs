import{URLS,parseCoverage,parseCommon,parseActivity,parseHolders,parseRanking,parseProfile}from'./解析公開持倉.mjs';
export async function buildSnapshot(read,at=new Date().toISOString()){
 const coverage=parseCoverage(await read('投資人首頁',URLS.home));
 const common=parseCommon(await read('共同持倉',URLS.common));
 const buying=parseCommon(await read('季度買入按人數',URLS.buys)).map(({holders,...r})=>({...r,reported_buyers:holders}));
 const allStocks=[...new Map([...common,...buying].map(r=>[r.ticker,r])).values()],activity=new Map();
 for(const row of allStocks){
  const u='https://www.dataroma.com/m/activity.php?sym='+row.ticker+'&typ=a';
  activity.set(row.ticker,{...parseActivity(await read('活動_'+row.ticker,u),coverage.latest_quarter),source_url:u});
 }
 for(const row of common){
  row.activity=activity.get(row.ticker);
  row.holder_examples=parseHolders(await read('持倉_'+row.ticker,row.source_url),row.holders);
 }
 for(const row of buying){row.activity=activity.get(row.ticker);if(row.activity.buyers!==row.reported_buyers)throw Error('BUYER_COUNT_CONFLICT')}
 const directory=parseRanking(await read('政治人物',URLS.directory));
 const profiles=[];
 // 每次最多49次公開來源讀取，包含所有股票及兩位關注人物；不繞過免費平台限制。
 const candidateLimit=Math.min(directory.candidates.length,49-(6+allStocks.length+common.length));
 for(const who of directory.candidates.slice(0,candidateLimit)){
  const profile=parseProfile(await read('人物_'+who.id,who.source_url),{id:who.id,name:who.name,source_url:who.source_url});
  if(profile.priced_buys>=20&&profile.win_rate!==null)profiles.push(profile);
 }
 // 同一兩年視窗及同一計價日才比較；不能把不同年期的百分比混成一張榜。
 const groups=new Map();for(const p of profiles){const k=p.window_start+'/'+p.priced_through;groups.set(k,[...(groups.get(k)||[]),p])}
 const cohort=[...groups.values()].sort((a,b)=>b.length-a.length)[0]||[];
 if(cohort.length<10)throw Error('COMPARABLE_PERFORMANCE_SAMPLE_INCOMPLETE');
 const ranked=cohort.sort((a,b)=>b.win_rate-a.win_rate||b.priced_buys-a.priced_buys).slice(0,10).map((r,i)=>({...r,rank:i+1}));
 const pins=[];
 for(const who of [{id:'P000197',name:'佩洛西 Nancy Pelosi',source_url:URLS.pelosi,file:'佩洛西共同口徑'},
  {id:'TRUMP',name:'特朗普 Donald Trump',source_url:URLS.trump,file:'特朗普',trump:true}]){
  pins.push(parseProfile(await read(who.file,who.source_url),who));
 }
 return {version:'celebrity-disclosures-v1',updated_at:at,status:'complete',
  common:{...coverage,rows:common,buying_rows:buying,ranking_basis:'number_of_distinct_reporting_portfolios',positions_basis:'latest_disclosed_per_manager',source_url:URLS.common,buying_source_url:URLS.buys},
  people:{rows:ranked,pinned:pins,coverage:directory.coverage,rated_cohort:directory.rated_cohort,minimum_priced_buys:20,comparable_count:cohort.length,
   verified_profiles:profiles.length,scope:'已取得公開目錄樣本，並逐一核對人物頁；不是全部人物或機構的最高勝率排名',
   performance_basis:'estimated_unrealized_buy_only',window_start:cohort[0].window_start,priced_through:cohort[0].priced_through,source_url:URLS.directory},
  notices:['持倉及買賣反映申報資料，並非即時帳戶。13F通常在季末後45日內披露；持有者統計採各帳戶最近披露，買賣比較另標季度。',
   '持有、增持與減持人數是不同指標；申報股數變動不是交易所成交量。不同股份類別分開統計，不合併GOOG與GOOGL。',
   '估算買入成功率只計有股價覆蓋的買入，從交易日收市至計價日比較；沒有配對其後賣出，不是已實現交易勝率。',
   '名人及機構持倉只供研究，不代表股票較安全，也不作本站入場訊號。'],
  source_links:[{name:'DATAROMA 持倉統計',url:URLS.common},{name:'Quantellect 人物與計算方法',url:URLS.directory},
   {name:'SEC 13F 披露說明',url:'https://www.sec.gov/rules-regulations/staff-guidance/frequently-asked-questions-about-form-13f'}]};
}
