const API_ROOT = import.meta.env.VITE_API_ROOT || "";
import React, {useState} from 'react';
import axios from 'axios';
import Plot from 'react-plotly.js';
import { Upload, TrendingUp, Activity } from 'lucide-react';
const API=`${API_ROOT}/api/trend`;

function FieldSelect({label, value, cols, onChange}){return <label><span>{label}</span><select value={value||''} onChange={e=>onChange(e.target.value)}>{cols.map(c=><option key={c}>{c}</option>)}</select></label>}
function fmt(x,dec=1){return x===null||x===undefined?'—':Number(x).toFixed(dec)}
function MetricTile({title, rows, metric}){
 const total=rows.reduce((a,r)=>a+(r.total||0),0); const inc=rows.filter(r=>r.direction==='Increasing').length;
 return <div className="tile"><div className="tileIcon">{metric==='frequency'?<Activity/>:<TrendingUp/>}</div><div><h3>{title}</h3><div className="big">{fmt(total, metric==='frequency'?0:1)}</div><p>Top 3 total {metric==='frequency'?'events':'minutes'} · {inc} increasing trend(s)</p></div></div>
}
function TrendChart({title, items, yTitle}){
 const data=[]; items.forEach(it=>{data.push({x:it.dates,y:it.values,type:'scatter',mode:'lines+markers',name:it.combo}); data.push({x:it.dates,y:it.trend,type:'scatter',mode:'lines',name:it.combo+' trend',line:{dash:'dash'},hoverinfo:'skip'});});
 return <div className="card chart"><h2>{title}</h2><Plot data={data} layout={{autosize:true,height:430,margin:{l:60,r:20,t:20,b:80},xaxis:{title:'Date'},yaxis:{title:yTitle, rangemode:'tozero'},legend:{orientation:'h',y:-0.3}}} useResizeHandler style={{width:'100%'}} config={{displaylogo:false,responsive:true}}/></div>
}
function Sparkline({ item }){
 if(!item?.values?.length) return <span className="spark-empty">—</span>;
 const values=item.values.map(v=>Number(v)||0), trend=(item.trend||[]).map(v=>Number(v)||0);
 const width=150, height=44, pad=5;
 const all=[...values,...trend].filter(Number.isFinite);
 const min=Math.min(...all,0), max=Math.max(...all,1), span=max-min||1;
 const x=i=>pad+(i/Math.max(values.length-1,1))*(width-pad*2);
 const y=v=>height-pad-((v-min)/span)*(height-pad*2);
 const path=values.map((v,i)=>`${i?'L':'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
 const trendPath=trend.length===values.length?trend.map((v,i)=>`${i?'L':'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' '):'';
 return <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Trend for ${item.combo}`}><path d={path} className="spark-actual"/>{trendPath&&<path d={trendPath} className="spark-trend"/>}<circle cx={x(values.length-1)} cy={y(values[values.length-1])} r="2.5"/></svg>
}
function SummaryTable({title, rows, unit, seriesItems=[]}){const seriesByCombo=Object.fromEntries(seriesItems.map(item=>[item.combo,item])); return <div className="card"><h2>{title}</h2><table><thead><tr><th>Rank</th><th>Combination</th><th>Trend</th><th>Total</th><th>Avg/day</th><th>Slope/day</th><th>Direction</th><th>R²</th><th>% Change</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.combo}><td>{i+1}</td><td><b>{r.combo}</b></td><td><Sparkline item={seriesByCombo[r.combo]}/></td><td>{fmt(r.total,unit==='count'?0:1)}</td><td>{fmt(r.average_per_day,1)}</td><td>{fmt(r.slope_per_day,2)}</td><td><span className={'pill '+r.direction.toLowerCase()}>{r.direction}</span></td><td>{fmt(r.r2,2)}</td><td>{r.pct_change==null?'—':fmt(r.pct_change,1)+'%'}</td></tr>)}</tbody></table></div>}
function TrendAdvisor(){
 const [file,setFile]=useState(null),[meta,setMeta]=useState(null),[map,setMap]=useState({}),[res,setRes]=useState(null),[loading,setLoading]=useState(false),[err,setErr]=useState('');
 async function upload(){ if(!file)return; setErr(''); setLoading(true); const fd=new FormData(); fd.append('file',file); try{const r=await axios.post(API+'/upload',fd); setMeta(r.data); setMap(r.data.suggested_mapping); setRes(null);}catch(e){setErr(e.response?.data?.detail||e.message)} finally{setLoading(false)} }
 async function analyze(){ setErr(''); setLoading(true); try{const r=await axios.post(API+'/analyze',{file_id:meta.file_id,...map,top_n:3}); setRes(r.data);}catch(e){setErr(e.response?.data?.detail||e.message)} finally{setLoading(false)} }
 const cols=meta?.columns||[];
 return <div className="page"><header><div><h1>Trend Advisor</h1><p>Daily frequency and duration trend advisor by Category × Agency. Shows only top 3 combinations.</p></div></header>
 <section className="upload-panel trend-upload-panel"><label className="file-box"><input type="file" accept=".csv,.xlsx,.xls" onChange={e=>setFile(e.target.files[0])}/><Upload size={22}/><span>{file ? file.name : "Choose CSV / Excel delay file"}</span></label><button className="primary-btn" onClick={upload} disabled={!file||loading}>{loading?'Working...':'Upload CSV / Excel'}</button></section>{meta&&<section className="panel controls"><div className="grid"><FieldSelect label="Date" value={map.date_col} cols={cols} onChange={v=>setMap({...map,date_col:v})}/><FieldSelect label="Duration" value={map.duration_col} cols={cols} onChange={v=>setMap({...map,duration_col:v})}/><FieldSelect label="Agency" value={map.agency_col} cols={cols} onChange={v=>setMap({...map,agency_col:v})}/><FieldSelect label="Category" value={map.category_col} cols={cols} onChange={v=>setMap({...map,category_col:v})}/></div><button className="primary-btn" onClick={analyze} disabled={loading}>Run Trend Advisor</button><p className="hint">Uploaded {meta.rows} rows. Mapping can be changed before running.</p></section>}{err&&<div className="err">{err}</div>}
 {res&&<><div className="tiles"><MetricTile title="Frequency Advisor" rows={res.frequency_table} metric="frequency"/><MetricTile title="Duration Advisor" rows={res.duration_table} metric="duration"/><div className="tile"><div><h3>Records Used</h3><div className="big">{res.records_used}</div><p>{res.date_min} to {res.date_max}</p></div></div></div><div className="two"><TrendChart title="Top 3 Daily Frequency Trends" items={res.top_frequency} yTitle="Frequency / day"/><TrendChart title="Top 3 Daily Duration Trends" items={res.top_duration} yTitle="Duration minutes / day"/></div><div className="two"><SummaryTable title="Frequency Trend Ranking" rows={res.frequency_table} unit="count" seriesItems={res.top_frequency}/><SummaryTable title="Duration Trend Ranking" rows={res.duration_table} unit="min" seriesItems={res.top_duration}/></div></>}
 </div>
}
export default TrendAdvisor;
