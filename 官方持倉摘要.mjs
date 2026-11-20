const safeDay=s=>/^20\d\d-\d\d-\d\d$/.test(s||'');
export function annualSummary(data,personId){
 const r=data?.rows?.find(x=>x.person_id===personId);if(!r)return null;
 if(r.status!=='disclosed_annual'||!safeDay(r.holdings_asof)||!safeDay(r.filed_date)||!Array.isArray(r.positions)||r.positions.some(p=>!Number.isFinite(p.low_usd)||p.low_usd<0||p.high_usd!==null&&(!Number.isFinite(p.high_usd)||p.high_usd<p.low_usd)))throw Error('OFFICIAL_HOLDINGS_INVALID');
 const whole=r.positions.length>0&&r.allocation_basis==='disclosed_stock_range_midpoints'&&!(r.unvalued_stocks||[]).length&&!r.amendment_count&&r.positions.every(p=>Number.isFinite(p.weight)&&p.weight>=0&&p.weight<=1);
 if(whole&&r.positions.length&&Math.abs(r.positions.reduce((s,p)=>s+p.weight,0)-1)>.00001)throw Error('OFFICIAL_HOLDINGS_WEIGHTS_INVALID');
 const rows=r.positions.slice(0,5),other=whole&&rows.length<r.positions.length?Math.max(0,1-rows.reduce((s,p)=>s+p.weight,0)):0;
 return {source:'official_house_annual',status:r.positions.length?'disclosed_annual':'no_reported_stock_amounts',report_year:r.report_year,holdings_asof:r.holdings_asof,filed_date:r.filed_date,
  checked_at:data.checked_at,source_url:r.source_url,stock_count:r.stock_count,unvalued_stock_count:(r.unvalued_stocks||[]).length,
  allocation_basis:whole?'disclosed_stock_range_midpoints':'disclosed_stock_ranges',rows:rows.map(p=>({...p,weight:whole?p.weight:null})),other_weight:whole?other:null,
  amendment_count:r.amendment_count||0,notice:r.notice};
}
