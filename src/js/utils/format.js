/**
 * General formatting and display helpers for CopyBoard.
 */

const EXT_GROUPS = {
    pdf:['#fdecec','#c0392b'], doc:['#eaf1ff','#2f5bff'], docx:['#eaf1ff','#2f5bff'],
    xls:['#e9f8ef','#1e8e5a'], xlsx:['#e9f8ef','#1e8e5a'], csv:['#e9f8ef','#1e8e5a'],
    ppt:['#fff2e0','#c9720a'], pptx:['#fff2e0','#c9720a'],
    zip:['#f2eefc','#7c4fd6'], rar:['#f2eefc','#7c4fd6'], '7z':['#f2eefc','#7c4fd6'], tar:['#f2eefc','#7c4fd6'], gz:['#f2eefc','#7c4fd6'],
    mp3:['#fdeef7','#c02579'], wav:['#fdeef7','#c02579'], m4a:['#fdeef7','#c02579'],
    mp4:['#fdeef7','#c02579'], mov:['#fdeef7','#c02579'], avi:['#fdeef7','#c02579'], mkv:['#fdeef7','#c02579'], webm:['#fdeef7','#c02579'],
    json:['#eefaf4','#0f9d68'], xml:['#eefaf4','#0f9d68'], yml:['#eefaf4','#0f9d68'], yaml:['#eefaf4','#0f9d68'],
    ini:['#f4f5f7','#6b7280'], cfg:['#f4f5f7','#6b7280'], conf:['#f4f5f7','#6b7280'], env:['#f4f5f7','#6b7280'], log:['#f4f5f7','#6b7280'],
    js:['#fff9e0','#a3790a'], ts:['#fff9e0','#a3790a'], py:['#fff9e0','#a3790a'], html:['#fff9e0','#a3790a'], css:['#fff9e0','#a3790a'],
    java:['#fff9e0','#a3790a'], c:['#fff9e0','#a3790a'], cpp:['#fff9e0','#a3790a'], sh:['#fff9e0','#a3790a'], go:['#fff9e0','#a3790a'], rs:['#fff9e0','#a3790a'], rb:['#fff9e0','#a3790a'],
    txt:['#f4f5f7','#6b7280'], md:['#f4f5f7','#6b7280'], rtf:['#f4f5f7','#6b7280'],
    svg:['#eaf1ff','#2f5bff'], ai:['#eaf1ff','#2f5bff'], psd:['#eaf1ff','#2f5bff'], fig:['#eaf1ff','#2f5bff'], sketch:['#eaf1ff','#2f5bff']
  };

export function extOf(name){ const parts=(name||'').split('.'); return parts.length>1 ? parts.pop().toLowerCase() : ''; }
  export function extMeta(name){ const ext=extOf(name); const c=EXT_GROUPS[ext]||['#f4f5f7','#6b7280']; return {label: ext?ext.toUpperCase().slice(0,4):'FILE', bg:c[0], fg:c[1]}; }
  export function displayName(item){ return item.customName || item.name; }
  export function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
  export function fmtSize(bytes){ if(bytes<1024) return bytes+' B'; if(bytes<1024*1024) return (bytes/1024).toFixed(1)+' KB'; return (bytes/1024/1024).toFixed(1)+' MB'; }
  export function fmtTime(ts){
    const diff=Date.now()-ts, min=Math.floor(diff/60000);
    if(min<1) return 'gerade eben'; if(min<60) return 'vor '+min+' Min';
    const h=Math.floor(min/60); if(h<24) return 'vor '+h+' Std';
    const d=Math.floor(h/24); if(d<7) return 'vor '+d+' Tag'+(d>1?'en':'');
    return new Date(ts).toLocaleDateString('de-DE');
  }
