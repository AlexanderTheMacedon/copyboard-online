import { extOf, displayName } from './format.js';

/**
 * Filename and export helpers for CopyBoard.
 */

export function sanitizeFilename(name){ return (name||'Datei').replace(/[\\/:*?"<>|]+/g,'_').trim().slice(0,80) || 'Datei'; }
  export function exportFilename(item, used){
    let base;
    if(item.type === 'text'){ base = sanitizeFilename(displayName(item)) + '.txt'; }
    else {
      const ext = extOf(item.name);
      const nameBase = sanitizeFilename(displayName(item));
      base = (ext && !nameBase.toLowerCase().endsWith('.'+ext)) ? nameBase + '.' + ext : nameBase;
    }
    let final = base, i = 2;
    while(used.has(final)){ const dot = base.lastIndexOf('.'); final = dot>0 ? base.slice(0,dot)+' ('+i+')'+base.slice(dot) : base+' ('+i+')'; i++; }
    used.add(final);
    return final;
  }
