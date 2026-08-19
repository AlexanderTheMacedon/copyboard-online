/**
 * General formatting and display helpers for CopyBoard.
 */

function extOf(name){ const parts=(name||'').split('.'); return parts.length>1 ? parts.pop().toLowerCase() : ''; }
  function extMeta(name){ const ext=extOf(name); const c=EXT_GROUPS[ext]||['#f4f5f7','#6b7280']; return {label: ext?ext.toUpperCase().slice(0,4):'FILE', bg:c[0], fg:c[1]}; }
  function displayName(item){ return item.customName || item.name; }
  function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
  function fmtSize(bytes){ if(bytes<1024) return bytes+' B'; if(bytes<1024*1024) return (bytes/1024).toFixed(1)+' KB'; return (bytes/1024/1024).toFixed(1)+' MB'; }
  function fmtTime(ts){
    const diff=Date.now()-ts, min=Math.floor(diff/60000);
    if(min<1) return 'gerade eben'; if(min<60) return 'vor '+min+' Min';
    const h=Math.floor(min/60); if(h<24) return 'vor '+h+' Std';
    const d=Math.floor(h/24); if(d<7) return 'vor '+d+' Tag'+(d>1?'en':'');
    return new Date(ts).toLocaleDateString('de-DE');
  }
