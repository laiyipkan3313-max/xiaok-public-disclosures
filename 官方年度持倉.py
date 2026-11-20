"""官方眾議院年報；只輸出上市股票金額區間，不發布其他個人資產資料。"""
from __future__ import annotations
import io,json,re,time,zipfile,urllib.request,xml.etree.ElementTree as ET
from datetime import datetime,timezone
from pathlib import Path
import pdfplumber

ROOT=Path(__file__).resolve().parent
CATALOG='https://disclosures-clerk.house.gov/public_disc/financial-pdfs/'
MEMBERS='https://clerk.house.gov/xml/lists/MemberData.xml'

def read(url):
 req=urllib.request.Request(url,headers={'User-Agent':'LianshiResearch public financial disclosures'})
 with urllib.request.urlopen(req,timeout=35)as r:
  data=r.read(16000001)
 if len(data)>16000000:raise ValueError('OFFICIAL_FILE_TOO_LARGE')
 time.sleep(.8)
 return data

def lines(words):
 out=[]
 for w in sorted(words,key=lambda x:(round(x['top']/2.3),x['x0'])):
  if not out or abs(w['top']-out[-1]['top'])>2.8:out.append({'top':w['top'],'words':[]})
  out[-1]['words'].append(w)
 for row in out:row['words'].sort(key=lambda x:x['x0'])
 return out

def amount(s):
 s=re.sub(r'\s+','',s).replace('–','-').replace('—','-')
 if s=='None':return 0,0
 m=re.fullmatch(r'\$([\d,]+)-\$?([\d,]+)',s)
 if m:
  lo,hi=(int(v.replace(',',''))for v in m.groups())
  if lo<0 or hi<lo:raise ValueError('ANNUAL_AMOUNT_ORDER')
  return lo,hi
 m=re.fullmatch(r'Over\$([\d,]+)',s,re.I)
 if m:return int(m[1].replace(',','')),None
 return None

def parse_pdf(raw,identity,filing):
 records=[];errors=[];unvalued=[];headers=0;first=''
 with pdfplumber.open(io.BytesIO(raw))as pdf:
  if len(pdf.pages)>250:raise ValueError('ANNUAL_PAGE_LIMIT')
  for page_index,page in enumerate(pdf.pages):
   text=page.extract_text()or''
   if page_index==0:first=text
   words=page.extract_words(x_tolerance=2,y_tolerance=3)
   grouped=lines(words);header=None
   for i,row in enumerate(grouped):
    names=[x['text']for x in row['words']]
    if 'Owner'in names and 'Value'in names and 'Income'in names:
     owner=next(w['x0']for w in row['words']if w['text']=='Owner')
     value=next(w['x0']for w in row['words']if w['text']=='Value')
     income=min(w['x0']for w in row['words']if w['text']=='Income'and w['x0']>value)
     header=(i,owner-2,value-2,income-2);break
   if not header:continue
   headers+=1;h,owner_x,value_x,income_x=header
   def segment(row,a,b):return ' '.join(w['text']for w in row['words']if a<=w['x0']<b)
   stop=next((i for i,row in enumerate(grouped[h+1:],h+1)if {'Owner','Date'}.issubset({w['text']for w in row['words']})and'Value'not in {w['text']for w in row['words']}),len(grouped))
   for i in range(h+1,stop):
    row=grouped[i];left=segment(row,0,owner_x)
    if '[ST]'not in left:continue
    start=i
    while start>h+1 and not re.search(r'\([A-Z][A-Z0-9.\-]{0,9}\)', ' '.join(segment(q,0,owner_x)for q in grouped[start:i+1]))and i-start<2:
     start-=1
    label=' '.join(segment(q,0,owner_x)for q in grouped[start:i+1])
    ticker=re.search(r'\(([A-Z][A-Z0-9.\-]{0,9})\)',label)
    if not ticker:
     errors.append({'page':page_index+1,'code':'STOCK_TICKER_MISSING'});continue
    owner=segment(grouped[start],owner_x,value_x)
    band=None;parts=[]
    for j in range(start,min(len(grouped),i+4)):
     parts.append(segment(grouped[j],value_x,income_x))
     band=amount(' '.join(parts))
     if band is not None:break
    if band is None and re.search(r'\$\d',' '.join(parts)):
     # 公司名稱換行時，金額上限可以與[ST]同列，而下限留在上一列；
     # 只接尚未完整的下限，不能借用上層投資帳戶已完整披露的總額。
     for back in range(start-1,max(h,start-3),-1):
      fragment=segment(grouped[back],value_x,income_x)
      if fragment.strip().endswith('-')and amount(fragment)is None:
       band=amount(fragment+' '+parts[0]);break
    if band is None:
     unvalued.append({'ticker':ticker[1],'page':page_index+1,'reason':'原申報未列個別股票金額，不能借用代管帳戶總額'});continue
    if band==(0,0):continue
    records.append({'ticker':ticker[1],'name':re.sub(r'\s*\([A-Z0-9.\-]+\)\s*\[ST\].*','',label).strip(),
     'low_usd':band[0],'high_usd':band[1],'owner':owner or'Self','page':page_index+1})
 if not headers:raise ValueError('ANNUAL_ASSET_TABLE_NOT_FOUND')
 if errors:raise ValueError('ANNUAL_STOCK_ROWS_NOT_COMPLETE:'+str(errors[:2]))
 # 年報身份和年度都要與官方目錄相符；不能借另一位同姓議員的年報。
 compact=re.sub(r'[^a-z0-9]','',first.lower())
 if re.sub(r'[^a-z0-9]','',identity['last'].lower())not in compact:raise ValueError('ANNUAL_IDENTITY_MISMATCH')
 year=re.search(r'Filing Year:\s*(20\d\d)',first)
 if not year or year[1]!=filing['Year']:raise ValueError('ANNUAL_YEAR_MISMATCH')
 filing_day=datetime.strptime(filing['FilingDate'],'%m/%d/%Y').date().isoformat()
 by={}
 for r in records:
  old=by.setdefault(r['ticker'],{'ticker':r['ticker'],'name':r['name'],'low_usd':0,'high_usd':0,'source_pages':[]})
  old['low_usd']+=r['low_usd'];old['high_usd']=None if old['high_usd']is None or r['high_usd']is None else old['high_usd']+r['high_usd'];old['source_pages'].append(r['page'])
 positions=list(by.values());bounded=not unvalued and all(r['high_usd']is not None for r in positions)
 total=sum((r['low_usd']+r['high_usd'])/2 for r in positions)if bounded else None
 for r in positions:
  r['weight']=((r['low_usd']+r['high_usd'])/2/total)if total else None
 positions.sort(key=lambda r:((r['low_usd']+r['high_usd'])/2 if r['high_usd']is not None else r['low_usd']),reverse=True)
 return {'person_id':identity['id'],'status':'disclosed_annual','report_year':int(year[1]),'holdings_asof':year[1]+'-12-31','filed_date':filing_day,
  'source_url':CATALOG+filing['Year']+'/'+filing['DocID']+'.pdf','filing_id':filing['DocID'],'positions':positions,
  'allocation_basis':'disclosed_stock_range_midpoints'if bounded else'disclosed_stock_ranges','stock_count':len(positions),'unvalued_stocks':unvalued,
  'notice':'按年度申報上市股票金額區間中點估算佔比；只反映該年度年末，不是目前持倉，亦不包括期權、現金、基金、物業及私人業務。'}

def main():
 at=datetime.now(timezone.utc);year=at.year
 data=json.loads((ROOT/'最新披露.json').read_text('utf8'))
 people={p['id']:p for p in data['people']['rows']+data['people']['pinned']if p['id']!='TRUMP'}
 roster_raw=read(MEMBERS);roster=ET.fromstring(roster_raw);identities={}
 print(json.dumps({'official_roster_root':roster.tag,'official_roster_members':len(roster.findall('.//member')),'tracked':len(people)}),flush=True)
 for item in roster.findall('.//member'):
  bio=item.find('member-info');bioid=bio.findtext('bioguideID')if bio is not None else None
  if bioid in people:identities[bioid]={'id':bioid,'first':bio.findtext('firstname')or'','last':bio.findtext('lastname')or'','district':item.get('key')or''}
 catalogs=[]
 for y in [year-1,year]:
  z=zipfile.ZipFile(io.BytesIO(read(CATALOG+str(y)+'FD.ZIP')))
  catalogs.extend({c.tag:c.text for c in r}for r in ET.fromstring(z.read(str(y)+'FD.xml')))
 try:previous=json.loads((ROOT/'人物年度持倉.json').read_text('utf8'))
 except FileNotFoundError:previous={'rows':[]}
 old={p['person_id']:p for p in previous['rows']};rows=[];issues=[]
 for pid,ident in identities.items():
  candidates=[r for r in catalogs if r.get('FilingType')=='O'and r.get('Last','').casefold()==ident['last'].casefold()and r.get('First','')[:3].casefold()==ident['first'][:3].casefold()]
  candidates.sort(key=lambda r:(r['Year'],datetime.strptime(r['FilingDate'],'%m/%d/%Y')),reverse=True)
  if not candidates:issues.append({'person_id':pid,'code':'ANNUAL_CATALOG_NOT_READY'});continue
  f=candidates[0]
  try:
   if old.get(pid,{}).get('filing_id')==f['DocID']:value=old[pid]
   else:
    url=CATALOG+f['Year']+'/'+f['DocID']+'.pdf';cache=ROOT/'暫存原申報';cache.mkdir(exist_ok=True);file=cache/(f['DocID']+'.pdf');raw=file.read_bytes()if file.exists()else read(url);file.write_bytes(raw);value=parse_pdf(raw,ident,f)
   amendments=[a for a in catalogs if a.get('FilingType')=='A'and a.get('Last')==f['Last']and a.get('First')==f['First']and a.get('Year')==f['Year']]
   value['amendment_count']=len(amendments)
   if amendments and '該年度另有修訂申報'not in value['notice']:value['notice']+=' 該年度另有修訂申報，圖示保留原年報範圍，請一併核對原申報。'
   rows.append(value);print(json.dumps({'id':pid,'stocks':value['stock_count'],'year':value['report_year']},ensure_ascii=False))
  except Exception as e:
   issues.append({'person_id':pid,'code':str(e)[:160]})
   if pid in old:rows.append(old[pid])
 if not rows:raise ValueError('NO_OFFICIAL_ANNUAL_HOLDINGS:'+json.dumps({'roster':len(identities),'issues':issues}))
 out={'version':'official-house-stock-allocation-v1','checked_at':at.isoformat(),'rows':rows,'issues':issues,'source_catalogs':[CATALOG+str(y)+'FD.ZIP'for y in[year-1,year]]}
 (ROOT/'人物年度持倉.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')),encoding='utf8')
 print(json.dumps({'annual_people':len(rows),'issues':issues},ensure_ascii=False))

if __name__=='__main__':main()
