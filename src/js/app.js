
  /*
   * COPYBOARD SOURCE MAP
   * 01 Constants, DOM references and runtime state
   * 02 Schema normalization and import compatibility
   * 03 State synchronization and persistence
   * 04 Mutation policy, Undo and Redo
   * 05 Shared utility and location helpers
   * 06 Tabs, spaces and navigation
   * 07 Grid/folder rendering and delegated events
   * 08 Drag/drop, FLIP and transfer animations
   * 09 Item actions, editing and clipboard behavior
   * 10 Search, Command Palette and global collections
   * 11 Modal stack, previews and dialogs
   * 12 Help & Settings Center
   * 13 Import/export, backup and recovery
   * 14 Initialization and lifecycle hooks
   *
   * Maintenance rule:
   * Extend the nearest existing system. Do not create a second persistence
   * path, modal hierarchy, global key handler or state schema.
   */

(function(){
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
  const STORAGE_KEY = 'copyboard_state_v1';
  const STATE_SCHEMA_VERSION = 1;
  const AUTOSAVE_PREF_KEY = 'copyboard_autosave_pref';
  const AUTOSAVE_LAST_SAVED_KEY = 'copyboard_autosave_last_saved';
  const PASTE_CAPTURE_PREF_KEY = 'copyboard_paste_capture_pref';
  const CLOUD_DEVICE_KEY = 'copyboard_cloud_device_id_v1';
  const CLOUD_META_KEY_PREFIX = 'copyboard_cloud_meta_v1:';
  const CLOUD_PUSH_DEBOUNCE_MS = 900;
  const CLOUD_CONFIG = Object.freeze({
    supabaseUrl:'https://nfltixnoopjjpkbbpfus.supabase.co',
    supabasePublishableKey:'sb_publishable_R7b6EuUsfvcMJGFqZD8mRg_patfwPRO',
    bucket:'copyboard-snapshots'
  });
  // Device storage keys must be initialized before SETTINGS_REGISTRY references them.
  const SETTINGS_SCHEMA_VERSION = 1;
  const SETTINGS_REGISTRY = Object.freeze({
    'appearance.viewMode': {
      scope:'board',
      default:'grid',
      normalize:value=>value === 'list' ? 'list' : 'grid'
    },
    'appearance.spaceAtmosphere': {
      scope:'board',
      default:'subtle',
      normalize:value=>['off','subtle','strong'].includes(value) ? value : 'subtle'
    },
    'behavior.defaultSortMode': {
      scope:'board',
      default:'manual',
      normalize:value=>['manual','name','newest','oldest','size','type'].includes(value) ? value : 'manual'
    },
    'behavior.confirmDestructiveActions': {
      scope:'board',
      default:true,
      normalize:value=>value !== false
    },
    'behavior.startSpace': {
      scope:'board',
      default:'last',
      normalize:value=>value === 'first' ? 'first' : 'last'
    },
    'history.recentLimit': {
      scope:'board',
      default:30,
      normalize:value=>{
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(100, Math.max(5, Math.round(number))) : 30;
      }
    },
    'device.autoSave': {
      scope:'device',
      default:true,
      storageKey:AUTOSAVE_PREF_KEY,
      normalize:value=>value !== false
    },
    'device.pasteCapture': {
      scope:'device',
      default:true,
      storageKey:PASTE_CAPTURE_PREF_KEY,
      normalize:value=>value !== false
    }
  });
  const PREIMPORT_RECOVERY_KEY = 'copyboard_preimport_recovery_v1';
  const MAX_IMPORT_FILE_BYTES = 30 * 1024 * 1024;
  const PERSIST_DEBOUNCE_MS = 140;

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
  /*
   * V32 SETTINGS ARCHITECTURE
   * - SETTINGS_REGISTRY is the canonical definition list.
   * - Board-scoped settings live in state.settings and travel with backups.
   * - Device-scoped settings remain local to this browser profile.
   * - getSetting()/setSetting() are the only supported access paths.
   * - Existing state.viewMode remains a compatibility mirror for older backups.
   * - Future UI controls should bind to registry keys, not create new ad-hoc keys.
   * - V32.1 exposes the first four board preferences through the Help Center.
   * - V32.2 adds only start-space behavior and optional destructive confirmations.
   * - V32.3 adds isolated settings export/import/reset without touching board content.
   * - Import and recovery confirmations intentionally never use the optional destructive wrapper.
   * - Global scrollbar styling is a UI-system rule, not a per-component exception.
   */

  // ================= STATE (schema-normalized JSON blob in localStorage) =================
  // Full-state entries normalize first; frequent mutations debounce writes; critical lifecycle/import paths flush synchronously.
  function checkStorageAvailable(){
    try{ const k='__cb_probe__'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return true; }
    catch(e){ return false; }
  }
  const storageAvailable = checkStorageAvailable();
  let deviceSettings = {};
  let memoryProtectionOn = true;
  let lastSavedAt = null;
  let sessionDirty = false;
  let persistTimer = null;
  let persistPending = false;
  let lastPersistedJson = '';
  let persistErrorShown = false;
  let state = null; // versionierter, normalisierter CopyBoard-State
  let cloudClient = null;
  let cloudUser = null;
  let cloudChannel = null;
  let cloudPushTimer = null;
  let cloudRevision = 0;
  let cloudObjectPath = null;
  let cloudLastSyncedHash = '';
  let cloudDirty = false;
  let cloudApplyingRemote = false;
  let cloudUploadRunning = false;
  let cloudPendingRemote = null;
  let cloudDeviceId = null;


  function getPathValue(object, path){
    return String(path).split('.').reduce((value,key)=>isPlainObject(value) ? value[key] : undefined, object);
  }
  function setPathValue(object, path, value){
    const keys = String(path).split('.');
    let cursor = object;
    keys.forEach((key,index)=>{
      if(index === keys.length - 1){
        cursor[key] = value;
        return;
      }
      if(!isPlainObject(cursor[key])) cursor[key] = {};
      cursor = cursor[key];
    });
    return object;
  }
  function defaultBoardSettings(){
    const settings = {schemaVersion:SETTINGS_SCHEMA_VERSION};
    Object.entries(SETTINGS_REGISTRY).forEach(([path,definition])=>{
      if(definition.scope !== 'board') return;
      setPathValue(settings,path,definition.default);
    });
    return settings;
  }
  function normalizeBoardSettings(rawSettings, legacyState={}){
    const source = isPlainObject(rawSettings) ? {...rawSettings} : {};
    const incomingVersion = Number.isInteger(source.schemaVersion) ? source.schemaVersion : 0;
    if(incomingVersion > SETTINGS_SCHEMA_VERSION) throw new Error('UNSUPPORTED_SETTINGS_SCHEMA');

    const normalized = {...source, schemaVersion:SETTINGS_SCHEMA_VERSION};
    Object.entries(SETTINGS_REGISTRY).forEach(([path,definition])=>{
      if(definition.scope !== 'board') return;
      let value = getPathValue(source,path);
      if(value === undefined && path === 'appearance.viewMode') value = legacyState.viewMode;
      setPathValue(normalized,path,definition.normalize(value === undefined ? definition.default : value));
    });
    return normalized;
  }
  function loadDeviceSettings(){
    const settings = {};
    Object.entries(SETTINGS_REGISTRY).forEach(([path,definition])=>{
      if(definition.scope !== 'device') return;
      let value = definition.default;
      if(storageAvailable && definition.storageKey){
        try{
          const raw = localStorage.getItem(definition.storageKey);
          if(raw !== null) value = raw === '1';
        }catch(e){}
      }
      setPathValue(settings,path,definition.normalize(value));
    });
    return settings;
  }
  function getSetting(path){
    const definition = SETTINGS_REGISTRY[path];
    if(!definition) return undefined;
    const source = definition.scope === 'device' ? deviceSettings : state?.settings;
    const value = getPathValue(source,path);
    return definition.normalize(value === undefined ? definition.default : value);
  }
  function setSetting(path, value, options={}){
    const definition = SETTINGS_REGISTRY[path];
    if(!definition) throw new Error('UNKNOWN_SETTING: ' + path);
    const normalized = definition.normalize(value);

    if(definition.scope === 'device'){
      setPathValue(deviceSettings,path,normalized);
      if(storageAvailable && definition.storageKey){
        try{ localStorage.setItem(definition.storageKey, normalized ? '1' : '0'); }catch(e){}
      }
      return normalized;
    }

    if(!state) return normalized;
    if(!isPlainObject(state.settings)) state.settings = defaultBoardSettings();
    setPathValue(state.settings,path,normalized);

    // Compatibility mirror for older imports and code paths.
    if(path === 'appearance.viewMode') state.viewMode = normalized;

    if(options.persist !== false) persistState(options.immediate ? {immediate:true} : {});
    return normalized;
  }

  function boardSettingsSnapshot(){
    return normalizeBoardSettings(state?.settings || defaultBoardSettings(), state || {});
  }

  function exportBoardSettings(){
    const payload = {
      type:'copyboard-settings',
      version:1,
      exportedAt:new Date().toISOString(),
      settings:boardSettingsSnapshot()
    };
    downloadBlob(
      new Blob([JSON.stringify(payload,null,2)], {type:'application/json'}),
      `copyboard-settings-${new Date().toISOString().slice(0,10)}.json`
    );
    showToast('Einstellungen exportiert');
  }

  function validateImportedSettingsPayload(payload){
    if(!isPlainObject(payload)) throw new Error('INVALID_SETTINGS_FILE');
    if(payload.type !== 'copyboard-settings') throw new Error('INVALID_SETTINGS_FILE');
    if(payload.version !== 1) throw new Error('UNSUPPORTED_SETTINGS_FILE');
    if(!isPlainObject(payload.settings)) throw new Error('INVALID_SETTINGS_FILE');
    return normalizeBoardSettings(payload.settings, state || {});
  }

  function applyBoardSettings(nextSettings, options={}){
    state.settings = normalizeBoardSettings(nextSettings, state || {});
    state.viewMode = getPathValue(state.settings,'appearance.viewMode');

    viewMode = state.viewMode;
    applyViewMode();
    applySpaceAtmosphere(currentSpace());

    const recentLimit = getPathValue(state.settings,'history.recentLimit');
    state.recentItems = (state.recentItems || []).slice(0,recentLimit);
    updateRecentAccess();
    syncHelpSettings();

    persistState(options.immediate ? {immediate:true, force:true} : {});
    render(true);
  }

  function importBoardSettingsFile(file){
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const payload = JSON.parse(String(reader.result || ''));
        const normalized = validateImportedSettingsPayload(payload);
        openConfirm(
          'Einstellungen importieren?',
          'Nur die Board-Einstellungen werden ersetzt. Spaces, Karten, Ordner und Geräte-Einstellungen bleiben unverändert.',
          'Importieren',
          async()=>{
            const mutation = mutationCheckpoint('boardData');
            applyBoardSettings(normalized, {immediate:true});
            if(mutation) commitMutation(mutation);
            showToast('Einstellungen importiert');
          }
        );
      }catch(error){
        console.error('CopyBoard: Settings-Import fehlgeschlagen.', error);
        showToast(
          error?.message === 'UNSUPPORTED_SETTINGS_FILE'
            ? 'Nicht unterstützte Einstellungsdatei'
            : 'Ungültige Einstellungsdatei'
        );
      }finally{
        settingsImportInput.value = '';
      }
    };
    reader.onerror = ()=>{
      settingsImportInput.value = '';
      showToast('Einstellungsdatei konnte nicht gelesen werden');
    };
    reader.readAsText(file);
  }

  function resetBoardSettings(){
    openConfirm(
      'Einstellungen zurücksetzen?',
      'Alle Board-Einstellungen werden auf Standard gesetzt. Spaces, Karten, Ordner, Verlauf und Geräte-Einstellungen bleiben erhalten.',
      'Zurücksetzen',
      async()=>{
        const mutation = mutationCheckpoint('boardData');
        applyBoardSettings(defaultBoardSettings(), {immediate:true});
        if(mutation) commitMutation(mutation);
        showToast('Board-Einstellungen zurückgesetzt');
      }
    );
  }

  function defaultSortModeSetting(){
    return getSetting('behavior.defaultSortMode') || 'manual';
  }

  function defaultState(){
    const id = 'default';
    return {
      schemaVersion:STATE_SCHEMA_VERSION,
      spaces:[{id, name:'Dein CopyBoard', sortMode:'manual'}],
      activeSpaceId:id,
      settings:defaultBoardSettings(),
      viewMode:'grid',
      recentItems:[],
      helpNotes:[],
      data:{ [id]: {itemIds:[], items:{}} }
    };
  }
  function normalizedString(value, fallback=''){
    return typeof value === 'string' && value.trim() ? value : fallback;
  }
  function normalizedTimestamp(value, fallback=0){
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }
  function normalizedSize(value, data){
    const number = Number(value);
    if(Number.isFinite(number) && number >= 0) return number;
    if(typeof data !== 'string') return 0;
    if(data.startsWith('data:')){
      const comma = data.indexOf(',');
      if(comma > -1){
        const payload = data.slice(comma + 1);
        return Math.max(0, Math.floor(payload.length * 0.75));
      }
    }
    try{ return new Blob([data]).size; }catch(e){ return data.length; }
  }
  function normalizeItem(rawItem, itemId){
    const item = isPlainObject(rawItem) ? {...rawItem} : {};
    item.id = itemId;
    item.type = normalizedString(item.type, 'file');
    const fallbackName = item.type === 'folder' ? 'Ordner' : item.type === 'text' ? 'Text' : 'Unbenannt';
    item.name = normalizedString(item.name, fallbackName);
    if(typeof item.customName !== 'string' || !item.customName.trim()) delete item.customName;
    else item.customName = item.customName.trim();
    item.timestamp = normalizedTimestamp(item.timestamp, 0);
    if(item.type === 'folder'){
      const rawIds = Array.isArray(item.itemIds) ? item.itemIds : [];
      item.itemIds = [...new Set(rawIds.filter(id=>typeof id === 'string' && id && id !== itemId))];
    } else {
      item.size = normalizedSize(item.size, item.data);
      if(typeof item.mime !== 'string' || !item.mime) item.mime = item.type === 'text' ? 'text/plain' : 'application/octet-stream';
    }
    ['favorite','pinned','locked'].forEach(key=>{
      if(item[key] !== true) delete item[key];
    });
    return item;
  }
  function normalizeSpaceData(rawData){
    const source = isPlainObject(rawData) ? rawData : {};
    const rawItems = isPlainObject(source.items) ? source.items : {};
    const items = {};
    for(const [itemId, rawItem] of Object.entries(rawItems)){
      if(typeof itemId !== 'string' || !itemId || !isPlainObject(rawItem)) continue;
      items[itemId] = normalizeItem(rawItem, itemId);
    }
    for(const item of Object.values(items)){
      if(item.type !== 'folder') continue;
      item.itemIds = item.itemIds.filter(id=>!!items[id]);
    }
    const topIds = Array.isArray(source.itemIds) ? source.itemIds : [];
    return {
      ...source,
      itemIds:[...new Set(topIds.filter(id=>typeof id === 'string' && !!items[id]))],
      items
    };
  }
  function normalizeRecentItems(rawRecent, validSpaceIds){
    if(!Array.isArray(rawRecent)) return [];
    const seen = new Set();
    const result = [];
    for(const raw of rawRecent){
      if(!isPlainObject(raw) || typeof raw.itemId !== 'string' || !raw.itemId) continue;
      const spaceId = typeof raw.spaceId === 'string' && validSpaceIds.has(raw.spaceId) ? raw.spaceId : null;
      if(!spaceId) continue;
      const key = spaceId + '::' + raw.itemId;
      if(seen.has(key)) continue;
      seen.add(key);
      result.push({
        ...raw,
        itemId:raw.itemId,
        spaceId,
        folderId:typeof raw.folderId === 'string' && raw.folderId ? raw.folderId : null,
        action:normalizedString(raw.action, 'Verwendet'),
        usedAt:normalizedTimestamp(raw.usedAt, 0)
      });
      if(result.length >= 30) break;
    }
    return result;
  }
  function normalizeHelpNotes(rawNotes){
    if(!Array.isArray(rawNotes)) return [];
    const seen = new Set();
    const result = [];
    for(const raw of rawNotes){
      if(!isPlainObject(raw) || typeof raw.text !== 'string' || !raw.text.trim()) continue;
      const id = normalizedString(raw.id, 'note_'+uid());
      if(seen.has(id)) continue;
      seen.add(id);
      result.push({...raw, id, text:raw.text, createdAt:normalizedTimestamp(raw.createdAt, 0)});
    }
    return result;
  }
  /**
   * Canonical full-state migration and normalization boundary.
   * Every loaded, imported or recovered board must pass through this function.
   */
  function normalizeState(rawState){
    const source = isPlainObject(rawState) ? {...rawState} : {};
    const incomingVersion = Number.isInteger(source.schemaVersion) ? source.schemaVersion : 0;
    if(incomingVersion > STATE_SCHEMA_VERSION) throw new Error('UNSUPPORTED_STATE_SCHEMA');

    const rawSpaces = Array.isArray(source.spaces) ? source.spaces : [];
    const spaces = [];
    const usedSpaceIds = new Set();
    for(const rawSpace of rawSpaces){
      if(!isPlainObject(rawSpace)) continue;
      const id = normalizedString(rawSpace.id, 'space_'+uid());
      if(usedSpaceIds.has(id)) continue;
      usedSpaceIds.add(id);
      const space = {
        ...rawSpace,
        id,
        name:normalizedString(rawSpace.name, 'Unbenannter Space'),
        sortMode:SORT_MODES[rawSpace.sortMode] ? rawSpace.sortMode : 'manual'
      };
      if(typeof space.color !== 'string' || !space.color.trim()) delete space.color;
      spaces.push(space);
    }
    if(!spaces.length){
      const fallback = defaultState();
      spaces.push(fallback.spaces[0]);
      usedSpaceIds.add(fallback.spaces[0].id);
    }

    const rawData = isPlainObject(source.data) ? source.data : {};
    const data = {...rawData};
    spaces.forEach(space=>{ data[space.id] = normalizeSpaceData(rawData[space.id]); });

    const activeSpaceId = typeof source.activeSpaceId === 'string' && usedSpaceIds.has(source.activeSpaceId)
      ? source.activeSpaceId
      : spaces[0].id;

    const settings = normalizeBoardSettings(source.settings, source);
    const recentLimit = getPathValue(settings,'history.recentLimit');

    return {
      ...source,
      schemaVersion:STATE_SCHEMA_VERSION,
      settings,
      spaces,
      activeSpaceId,
      viewMode:getPathValue(settings,'appearance.viewMode'),
      recentItems:normalizeRecentItems(source.recentItems, usedSpaceIds).slice(0,recentLimit),
      helpNotes:normalizeHelpNotes(source.helpNotes),
      data
    };
  }
  function loadPersistedState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(raw){
        lastPersistedJson = raw;
        return normalizeState(JSON.parse(raw));
      }
    }catch(e){ console.warn('CopyBoard: gespeicherter State konnte nicht normalisiert werden.', e); }
    return null;
  }
  function nowTimeStr(ts=Date.now()){ return new Date(ts).toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit', second:'2-digit'}); }
  function updateAutosaveStatus(html){ if(autosaveStatusEl) autosaveStatusEl.innerHTML = html; }
  function refreshAutosaveStatus(){
    if(!storageAvailable){ updateAutosaveStatus('Nicht<br>verfügbar'); return; }
    if(memoryProtectionOn){
      updateAutosaveStatus(lastSavedAt ? 'Gespeichert<br>' + nowTimeStr(lastSavedAt) : 'AutoSave<br>bereit');
    } else {
      updateAutosaveStatus(sessionDirty ? 'Temporär<br>ungespeichert' : 'Temporär<br>aktiv');
    }
  }
  function clearPersistTimer(){
    if(persistTimer !== null){
      clearTimeout(persistTimer);
      persistTimer = null;
    }
  }

  /**
   * Performs actual serialization and localStorage writing.
   * Do not add parallel direct writes to STORAGE_KEY elsewhere.
   */
  function flushPersistedState(options={}){
    const force = options === true || options?.force === true;
    clearPersistTimer();

    if(!storageAvailable){
      persistPending = false;
      refreshAutosaveStatus();
      return false;
    }
    if(!memoryProtectionOn){
      persistPending = false;
      sessionDirty = true;
      refreshAutosaveStatus();
      return true;
    }

    let serialized;
    try{
      serialized = JSON.stringify(state);
    }catch(e){
      persistPending = false;
      updateAutosaveStatus('Speichern<br>fehlgeschlagen');
      if(!persistErrorShown){
        persistErrorShown = true;
        showToast('Der aktuelle Zustand konnte nicht serialisiert werden');
      }
      console.error('CopyBoard: State-Serialisierung fehlgeschlagen.', e);
      return false;
    }

    if(!force && serialized === lastPersistedJson){
      persistPending = false;
      sessionDirty = false;
      refreshAutosaveStatus();
      return true;
    }

    try{
      localStorage.setItem(STORAGE_KEY, serialized);
      lastPersistedJson = serialized;
      lastSavedAt = Date.now();
      localStorage.setItem(AUTOSAVE_LAST_SAVED_KEY, String(lastSavedAt));
      persistPending = false;
      sessionDirty = false;
      persistErrorShown = false;
      refreshAutosaveStatus();
      cloudMarkLocalPersisted(serialized);
      return true;
    }catch(e){
      persistPending = false;
      updateAutosaveStatus('Speichern<br>fehlgeschlagen');
      if(!persistErrorShown){
        persistErrorShown = true;
        showToast('Konnte nicht gespeichert werden (Speicherlimit erreicht?)');
      }
      console.error('CopyBoard: Persistieren fehlgeschlagen.', e);
      return false;
    }
  }

  /**
   * Central save request. Normal mutations debounce; critical paths may flush.
   */
  function persistState(options={}){
    const immediate = options === true || options?.immediate === true;

    if(!storageAvailable){
      refreshAutosaveStatus();
      return false;
    }
    if(!memoryProtectionOn){
      clearPersistTimer();
      persistPending = false;
      sessionDirty = true;
      refreshAutosaveStatus();
      return true;
    }

    persistPending = true;
    sessionDirty = true;

    if(immediate) return flushPersistedState({force:options?.force === true});

    clearPersistTimer();
    updateAutosaveStatus('Speichert<br>…');
    persistTimer = setTimeout(()=>{
      persistTimer = null;
      flushPersistedState();
    }, PERSIST_DEBOUNCE_MS);
    return true;
  }
  async function migrateFromLegacyWindowStorage(){
    // best-effort one-time import from an earlier version of this tool that used window.storage
    try{
      if(typeof window.storage === 'undefined') return null;
      const idxRaw = await window.storage.get('spaces-index', false);
      if(!idxRaw) return null;
      const spacesIdx = JSON.parse(idxRaw.value);
      const data = {};
      for(const sp of spacesIdx){
        let sd = null;
        try{ const r = await window.storage.get('space:'+sp.id+':data', false); if(r) sd = JSON.parse(r.value); }catch(e){}
        data[sp.id] = sd || { itemIds: [], items: {} };
      }
      let active = spacesIdx[0].id;
      try{ const r = await window.storage.get('active-space', false); if(r) active = JSON.parse(r.value); }catch(e){}
      let vm = 'grid';
      try{ const r = await window.storage.get('view-mode', false); if(r) vm = JSON.parse(r.value); }catch(e){}
      return normalizeState({ spaces: spacesIdx, activeSpaceId: active, viewMode: vm, data });
    }catch(e){ return null; }
  }
  function estimateBytes(obj){ return new Blob([JSON.stringify(obj)]).size; }
  function dataOf(sid){
    if(!isPlainObject(state.data)) state.data = {};
    if(!state.data[sid]) state.data[sid] = normalizeSpaceData(null);
    return state.data[sid];
  }

  let spaces = [], currentSpaceId = null, items = [];
  let selectedIds = new Set(), lastSelectedId = null;
  let viewMode = 'grid';
  function syncFromState(){
    spaces = state.spaces;
    currentSpaceId = state.activeSpaceId;
    viewMode = getSetting('appearance.viewMode');
  }
  function currentSpace(){ return spaces.find(s=>s.id===currentSpaceId); }
  const SORT_MODES = {
    manual:'Manuell',
    name:'Name A–Z',
    newest:'Neueste zuerst',
    oldest:'Älteste zuerst',
    size:'Größe absteigend',
    type:'Dateityp'
  };
  function currentSortMode(){ return currentSpace()?.sortMode || 'manual'; }
  function itemSortSize(item){
    if(!item) return 0;
    if(item.type !== 'folder') return Number(item.size)||0;
    return (item.itemIds||[]).reduce((sum,id)=>sum + itemSortSize(item.items?.[id]), 0);
  }
  function itemTypeLabel(item){
    if(!item) return '';
    if(item.type==='folder') return '0-folder';
    if(item.type==='text') return '1-text';
    if(item.type==='image') return '2-image';
    if(item.type==='audio') return '3-audio';
    return '4-' + String(item.mime || item.type || 'file').toLowerCase();
  }
  function sortItemsForView(list){
    const mode = currentSortMode();
    const sorted = list.slice();
    sorted.sort((a,b)=>{
      const pinDiff = (b.pinned?1:0) - (a.pinned?1:0);
      if(pinDiff) return pinDiff;
      if(mode==='manual') return 0;
      if(mode==='name') return displayName(a).localeCompare(displayName(b),'de',{sensitivity:'base',numeric:true});
      if(mode==='newest') return (Number(b.timestamp)||0) - (Number(a.timestamp)||0);
      if(mode==='oldest') return (Number(a.timestamp)||0) - (Number(b.timestamp)||0);
      if(mode==='size') return itemSortSize(b) - itemSortSize(a);
      if(mode==='type'){
        const typeDiff = itemTypeLabel(a).localeCompare(itemTypeLabel(b),'de',{sensitivity:'base'});
        return typeDiff || displayName(a).localeCompare(displayName(b),'de',{sensitivity:'base',numeric:true});
      }
      return 0;
    });
    return sorted;
  }
  function setSortMode(mode){
    if(!SORT_MODES[mode] || currentSortMode() === mode) return;
    mutationCheckpoint('spaceMeta');
    currentSpace().sortMode = mode;
    persistState();
    refreshItems();
    render();
    countPill.title = 'Sortierung: ' + SORT_MODES[mode];
    showToast('Sortierung: ' + SORT_MODES[mode]);
  }
  function refreshItems(){
    const d = dataOf(currentSpaceId);
    const list = d.itemIds.map(id=>d.items[id]).filter(Boolean);
    items = sortItemsForView(list);
    if(countPill) countPill.title = 'Sortierung: ' + SORT_MODES[currentSortMode()];
  }

  async function switchSpace(id){
    state.activeSpaceId = id; currentSpaceId = id;
    persistState();
    titleInput.value = currentSpace().name;
    renderTabs();
    selectedIds.clear(); lastSelectedId=null; selectionBar.classList.remove('show');
    refreshItems();
    render();
  }
  async function addSpace(){
    mutationCheckpoint('board');
    const id = uid(), name = 'Space ' + (spaces.length + 1);
    spaces.push({id, name, sortMode:defaultSortModeSetting()});
    dataOf(id);
    persistState();
    await switchSpace(id);
  }
  async function deleteSpace(id){
    if(spaces.length <= 1) return;
    mutationCheckpoint('board');
    delete state.data[id];
    state.spaces = state.spaces.filter(s=>s.id!==id);
    spaces = state.spaces;
    persistState();
    if(currentSpaceId === id){ await switchSpace(spaces[0].id); } else { renderTabs(); }
  }
  async function renameCurrentSpace(newName){
    const sp = currentSpace();
    const nextName = newName.trim() || sp.name;
    if(nextName === sp.name) return;
    mutationCheckpoint('spaceMeta');
    sp.name = nextName;
    titleInput.value = sp.name;
    persistState();
    renderTabs();
  }

  function exportSpaceAsJson(sp){
    const payload = { format:'copyboard-space', version:1, name:sp.name, color:sp.color||null, exportedAt:new Date().toISOString(), data:dataOf(sp.id) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    a.href = url; a.download = 'copyboard-space-'+sanitizeFilename(sp.name)+'-'+stamp+'.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
    showToast('Space exportiert');
  }
  function duplicateSpace(sp){
    mutationCheckpoint('boardData');
    const newId = uid();
    state.data[newId] = JSON.parse(JSON.stringify(dataOf(sp.id)));
    const newSpace = { id:newId, name: sp.name + ' Kopie', sortMode:sp.sortMode||'manual' };
    if(sp.color) newSpace.color = sp.color;
    spaces.push(newSpace);
    state.spaces = spaces;
    persistState();
    renderTabs();
    showToast('Space dupliziert');
  }
  function clearSpaceData(sid){
    mutationCheckpoint('content', sid);
    state.data[sid] = { itemIds: [], items: {} };
    if(sid === currentSpaceId){ refreshItems(); render(); }
    persistState();
    showToast('Space geleert');
  }
  function buildSpaceContextMenu(sp, tabEl){
    const rows = [];
    rows.push({icon:ICONS.rename, label:'Umbenennen', onClick:()=>enterTabRenameMode(tabEl, sp)});
    rows.push({icon:`<span style="width:14px;height:14px;border-radius:50%;background:${sp.color||'#c7cbd3'};display:inline-block;"></span>`, label:'Farbe wählen', onClick:()=>openColorPicker(tabEl.querySelector('.tab-dot') || tabEl, sp)});
    rows.push({sep:true});
    rows.push({icon:ICONS.duplicate, label:'Space duplizieren', onClick:()=>duplicateSpace(sp)});
    rows.push({icon:ICONS.download, label:'Als JSON exportieren', onClick:()=>exportSpaceAsJson(sp)});
    rows.push({sep:true});
    rows.push({icon:ICONS.trash, label:'Space leeren', onClick:()=>{
      openDestructiveConfirm('Space leeren?', `Alle Einträge in "${sp.name}" werden dauerhaft gelöscht.`, 'Leeren', ()=>clearSpaceData(sp.id));
    }});
    if(spaces.length > 1){
      rows.push({icon:ICONS.trash, label:'Space löschen', danger:true, onClick:()=>{
        openDestructiveConfirm('Space löschen?', `"${sp.name}" und alle enthaltenen Einträge werden dauerhaft gelöscht.`, 'Löschen', ()=>deleteSpace(sp.id));
      }});
    }
    return rows;
  }

  // ---------- dom refs ----------
  const grid = document.getElementById('grid');
  const dropzone = document.getElementById('dropzone');
  const dzTitle = document.getElementById('dzTitle');
  const dzTextLink = document.getElementById('dzTextLink');
  const fileInput = document.getElementById('fileInput');
  const countPill = document.getElementById('countPill');
  const clearBtn = document.getElementById('clearBtn');
  const addTextBtn = document.getElementById('addTextBtn');
  const emptyNote = document.getElementById('emptyNote');
  const toast = document.getElementById('toast');
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmTitle = document.getElementById('confirmTitle');
  const confirmMsg = document.getElementById('confirmMsg');
  const confirmOkBtn = document.getElementById('confirmOkBtn');
  const confirmCancelBtn = document.getElementById('confirmCancelBtn');
  const textOverlay = document.getElementById('textOverlay');
  const textArea = document.getElementById('textArea');
  const textOkBtn = document.getElementById('textOkBtn');
  const textCancelBtn = document.getElementById('textCancelBtn');
  const previewOverlay = document.getElementById('previewOverlay');
  const previewName = document.getElementById('previewName');
  const previewBody = document.getElementById('previewBody');
  const previewFooter = document.getElementById('previewFooter');
  const previewCloseBtn = document.getElementById('previewCloseBtn');
  const inspectorOverlay = document.getElementById('inspectorOverlay');
  const inspectorIcon = document.getElementById('inspectorIcon');
  const inspectorTitle = document.getElementById('inspectorTitle');
  const inspectorStatuses = document.getElementById('inspectorStatuses');
  const inspectorGrid = document.getElementById('inspectorGrid');
  const inspectorCloseBtn = document.getElementById('inspectorCloseBtn');
  const inspectorLocateBtn = document.getElementById('inspectorLocateBtn');
  const inspectorOpenBtn = document.getElementById('inspectorOpenBtn');
  const spaceMoveOverlay = document.getElementById('spaceMoveOverlay');
  const spaceMoveList = document.getElementById('spaceMoveList');
  const spaceMoveCancelBtn = document.getElementById('spaceMoveCancelBtn');
  const shareOverlay = document.getElementById('shareOverlay');
  const shareOptions = document.getElementById('shareOptions');
  const shareCancelBtn = document.getElementById('shareCancelBtn');
  const paletteOverlay = document.getElementById('paletteOverlay');
  const paletteInput = document.getElementById('paletteInput');
  const paletteResults = document.getElementById('paletteResults');
  const paletteHelpBtn = document.getElementById('paletteHelpBtn');
  const importFileInput = document.getElementById('importFileInput');
  const replaceFileInput = document.getElementById('replaceFileInput');
  const imageEditOverlay = document.getElementById('imageEditOverlay');
  const imageEditCanvas = document.getElementById('imageEditCanvas');
  const rotateLeftBtn = document.getElementById('rotateLeftBtn');
  const rotateRightBtn = document.getElementById('rotateRightBtn');
  const flipHBtn = document.getElementById('flipHBtn');
  const flipVBtn = document.getElementById('flipVBtn');
  const imageEditCancelBtn = document.getElementById('imageEditCancelBtn');
  const imageEditSaveBtn = document.getElementById('imageEditSaveBtn');
  const textOverlayTitle = document.getElementById('textOverlayTitle');
  const micBtn = document.getElementById('micBtn');
  const paletteExtractOverlay = document.getElementById('paletteExtractOverlay');
  const paletteSwatches = document.getElementById('paletteSwatches');
  const paletteExtractCloseBtn = document.getElementById('paletteExtractCloseBtn');
  const paletteExtractSaveBtn = document.getElementById('paletteExtractSaveBtn');
  const watchBtn = document.getElementById('watchBtn');
  const pinOverlay = document.getElementById('pinOverlay');
  const pinOverlayTitle = document.getElementById('pinOverlayTitle');
  const pinInput = document.getElementById('pinInput');
  const pinError = document.getElementById('pinError');
  const pinCancelBtn = document.getElementById('pinCancelBtn');
  const pinOkBtn = document.getElementById('pinOkBtn');
  const burnOverlay = document.getElementById('burnOverlay');
  const burnContent = document.getElementById('burnContent');
  const burnCloseBtn = document.getElementById('burnCloseBtn');
  const renameOverlay = document.getElementById('renameOverlay');
  const renameInput = document.getElementById('renameInput');
  const renameCancelBtn = document.getElementById('renameCancelBtn');
  const renameOkBtn = document.getElementById('renameOkBtn');
  const helpToggle = document.getElementById('helpToggle');
  const helpOverlay = document.getElementById('helpOverlay');
  const helpCloseBtn = document.getElementById('helpCloseBtn');
  const helpNav = document.getElementById('helpNav');
  const helpAutosaveStatus = document.getElementById('helpAutosaveStatus');
  const helpPasteStatus = document.getElementById('helpPasteStatus');
  const helpAutosaveBtn = document.getElementById('helpAutosaveBtn');
  const helpPasteBtn = document.getElementById('helpPasteBtn');
  // V32.1 runtime fix: legacy helpGridBtn/helpListBtn references were removed with the new select control.
  const helpViewModeSelect = document.getElementById('helpViewModeSelect');
  const helpDefaultSortSelect = document.getElementById('helpDefaultSortSelect');
  const helpRecentLimitSelect = document.getElementById('helpRecentLimitSelect');
  const helpAtmosphereSelect = document.getElementById('helpAtmosphereSelect');
  const helpStartSpaceSelect = document.getElementById('helpStartSpaceSelect');
  const helpConfirmDeleteSelect = document.getElementById('helpConfirmDeleteSelect');
  const helpExportSettingsBtn = document.getElementById('helpExportSettingsBtn');
  const helpImportSettingsBtn = document.getElementById('helpImportSettingsBtn');
  const helpResetSettingsBtn = document.getElementById('helpResetSettingsBtn');
  const settingsImportInput = document.getElementById('settingsImportInput');
  const favoritesOverlay = document.getElementById('favoritesOverlay');
  const favoritesList = document.getElementById('favoritesList');
  const favoritesCloseBtn = document.getElementById('favoritesCloseBtn');
  const recentOverlay = document.getElementById('recentOverlay');
  const recentList = document.getElementById('recentList');
  const recentCloseBtn = document.getElementById('recentCloseBtn');
  const selectionBar = document.getElementById('selectionBar');
  const selectionCount = document.getElementById('selectionCount');
  const selAllBtn = document.getElementById('selAllBtn');
  const selAllLabel = document.getElementById('selAllLabel');
  const selMoveBtn = document.getElementById('selMoveBtn');
  const selFolderBtn = document.getElementById('selFolderBtn');
  const selDuplicateBtn = document.getElementById('selDuplicateBtn');
  const selDeleteBtn = document.getElementById('selDeleteBtn');
  const selClearBtn = document.getElementById('selClearBtn');
  const folderOverlay = document.getElementById('folderOverlay');
  const folderTitleInput = document.getElementById('folderTitleInput');
  const folderGrid = document.getElementById('folderGrid');
  const folderZipBtn = document.getElementById('folderZipBtn');
  const folderDissolveBtn = document.getElementById('folderDissolveBtn');
  const folderDeleteBtn = document.getElementById('folderDeleteBtn');
  const folderCloseBtn = document.getElementById('folderCloseBtn');
  const contextMenu = document.getElementById('contextMenu');
  const contextSubmenu = document.getElementById('contextSubmenu');
  const titleInput = document.getElementById('titleInput');
  const tabsScroll = document.getElementById('tabsScroll');
  const tabsDropdown = document.getElementById('tabsDropdown');
  const tabAddBtn = document.getElementById('tabAddBtn');
  const tabOverflowBtn = document.getElementById('tabOverflowBtn');
  const scrollLeftBtn = document.getElementById('scrollLeftBtn');
  const scrollRightBtn = document.getElementById('scrollRightBtn');
  const viewGridBtn = document.getElementById('viewGridBtn');
  const searchOpenBtn = document.getElementById('searchOpenBtn');
  const viewListBtn = document.getElementById('viewListBtn');
  const favoritesHeaderBtn = document.getElementById('favoritesHeaderBtn');
  const recentHeaderBtn = document.getElementById('recentHeaderBtn');
  const dragFog = document.getElementById('dragFog');
  const dragHint = document.getElementById('dragHint');
  const dropLine = document.getElementById('dropLine');
  const memoryToggle = document.getElementById('memoryToggle');
  const autosaveStatusEl = document.getElementById('autosaveStatus');
  const duplicateOverlay = document.getElementById('duplicateOverlay');
  const duplicateList = document.getElementById('duplicateList');
  const duplicateCloseBtn = document.getElementById('duplicateCloseBtn');
  const duplicateDetectedOverlay = document.getElementById('duplicateDetectedOverlay');
  const duplicateDetectedBody = document.getElementById('duplicateDetectedBody');
  const duplicateDetectedCloseBtn = document.getElementById('duplicateDetectedCloseBtn');
  const duplicateCancelBtn = document.getElementById('duplicateCancelBtn');
  const duplicateOpenExistingBtn = document.getElementById('duplicateOpenExistingBtn');
  const duplicateAddAnywayBtn = document.getElementById('duplicateAddAnywayBtn');
  const storageOverlay = document.getElementById('storageOverlay');
  const storageMeterFill = document.getElementById('storageMeterFill');
  const storageUsedLabel = document.getElementById('storageUsedLabel');
  const storageLimitLabel = document.getElementById('storageLimitLabel');
  const storageCardsCount = document.getElementById('storageCardsCount');
  const storageSpacesCount = document.getElementById('storageSpacesCount');
  const storagePercentLabel = document.getElementById('storagePercentLabel');
  const storageLargestList = document.getElementById('storageLargestList');
  const storageHint = document.getElementById('storageHint');
  const storageCloseBtn = document.getElementById('storageCloseBtn');
  const helpNoteInput = document.getElementById('helpNoteInput');
  const helpNoteAddBtn = document.getElementById('helpNoteAddBtn');
  const helpNotesGrid = document.getElementById('helpNotesGrid');
  const cloudToggle = document.getElementById('cloudToggle');
  const cloudOverlay = document.getElementById('cloudOverlay');
  const cloudModalTitle = document.getElementById('cloudModalTitle');
  const cloudModalCopy = document.getElementById('cloudModalCopy');
  const cloudSignedOutPanel = document.getElementById('cloudSignedOutPanel');
  const cloudSignedInPanel = document.getElementById('cloudSignedInPanel');
  const cloudEmailInput = document.getElementById('cloudEmailInput');
  const cloudPasswordInput = document.getElementById('cloudPasswordInput');
  const cloudCloseBtn = document.getElementById('cloudCloseBtn');
  const cloudSignInBtn = document.getElementById('cloudSignInBtn');
  const cloudSignedInCloseBtn = document.getElementById('cloudSignedInCloseBtn');
  const cloudSyncNowBtn = document.getElementById('cloudSyncNowBtn');
  const cloudDownloadBtn = document.getElementById('cloudDownloadBtn');
  const cloudSignOutBtn = document.getElementById('cloudSignOutBtn');
  const cloudAccountLabel = document.getElementById('cloudAccountLabel');
  const cloudStatusLabel = document.getElementById('cloudStatusLabel');
  const cloudRevisionLabel = document.getElementById('cloudRevisionLabel');
  const cloudUpdateBanner = document.getElementById('cloudUpdateBanner');
  const cloudUpdateBtn = document.getElementById('cloudUpdateBtn');
  const cloudUpdateDismiss = document.getElementById('cloudUpdateDismiss');

  function cloudIsConfigured(){
    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(CLOUD_CONFIG.supabaseUrl)
      && CLOUD_CONFIG.supabasePublishableKey
      && !CLOUD_CONFIG.supabasePublishableKey.includes('YOUR_');
  }
  function cloudUuid(){
    if(crypto?.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    return [...bytes].map((byte,index)=>([4,6,8,10].includes(index)?'-':'')+byte.toString(16).padStart(2,'0')).join('');
  }
  function cloudGetDeviceId(){
    if(cloudDeviceId) return cloudDeviceId;
    try{ cloudDeviceId = localStorage.getItem(CLOUD_DEVICE_KEY); }catch(e){}
    if(!cloudDeviceId){
      cloudDeviceId = cloudUuid();
      try{ localStorage.setItem(CLOUD_DEVICE_KEY, cloudDeviceId); }catch(e){}
    }
    return cloudDeviceId;
  }
  async function cloudHash(serialized){
    if(crypto?.subtle){
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
      return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    }
    let output = '';
    for(let seed=0;seed<8;seed++){
      let hash = (2166136261 ^ Math.imul(seed + 1, 2654435761)) >>> 0;
      for(let i=0;i<serialized.length;i++) hash = Math.imul(hash ^ serialized.charCodeAt(i), 16777619);
      output += (hash >>> 0).toString(16).padStart(8,'0');
    }
    return output;
  }
  function cloudMetaStorageKey(){ return cloudUser ? CLOUD_META_KEY_PREFIX + cloudUser.id : ''; }
  function cloudReadLocalMeta(){
    if(!cloudUser) return null;
    try{
      const parsed = JSON.parse(localStorage.getItem(cloudMetaStorageKey()) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : null;
    }catch(e){ return null; }
  }
  function cloudSaveLocalMeta(){
    if(!cloudUser) return;
    try{
      localStorage.setItem(cloudMetaStorageKey(), JSON.stringify({
        revision:cloudRevision,
        contentHash:cloudLastSyncedHash,
        objectPath:cloudObjectPath,
        savedAt:Date.now()
      }));
    }catch(e){}
  }
  function cloudSetStatus(mode, label){
    cloudToggle.dataset.state = mode;
    const titles = {
      local:'Cloud-Synchronisierung einrichten',
      offline:'Cloud offline — lokale Kopie ist verfügbar',
      syncing:'CopyBoard wird synchronisiert',
      synced:'CopyBoard ist synchronisiert',
      attention:'Neuer Cloud-Stand verfügbar',
      error:'Cloud-Synchronisierung prüfen'
    };
    const statusText = label || titles[mode] || titles.local;
    cloudToggle.title = statusText;
    cloudToggle.setAttribute('aria-label', statusText + '. Cloud-Synchronisierung öffnen');
    if(cloudStatusLabel && label) cloudStatusLabel.textContent = label;
    if(cloudRevisionLabel) cloudRevisionLabel.textContent = cloudRevision ? 'Rev. '+cloudRevision : 'Lokal';
  }
  function cloudSetSignedInUI(){
    const signedIn = !!cloudUser;
    cloudSignedOutPanel.hidden = signedIn;
    cloudSignedInPanel.hidden = !signedIn;
    cloudModalTitle.textContent = signedIn ? 'Cloud-Synchronisierung' : 'Geräte verbinden';
    cloudModalCopy.textContent = signedIn
      ? 'Änderungen werden lokal gespeichert und anschließend revisionssicher hochgeladen.'
      : 'Melde dich auf Mac und Windows mit demselben Konto an. Deine lokale Kopie bleibt als schneller Offline-Stand erhalten.';
    if(signedIn) cloudAccountLabel.textContent = cloudUser.email || 'Angemeldet';
  }
  function cloudShowUpdate(metadata){
    cloudPendingRemote = metadata;
    cloudUpdateBanner.classList.add('show');
    cloudSetStatus('attention','Neue Elemente auf einem anderen Gerät verfügbar');
  }
  function cloudHideUpdate(){ cloudUpdateBanner.classList.remove('show'); }
  function cloudStateHasContent(){
    const spaceCount = state?.spaces?.length || 0;
    const itemCount = Object.values(state?.data || {}).reduce((sum,data)=>sum+Object.keys(data?.items || {}).length,0);
    return itemCount > 0 || spaceCount > 1 || (state?.helpNotes?.length || 0) > 0;
  }
  async function cloudFetchMetadata(){
    if(!cloudClient || !cloudUser) return null;
    const {data,error} = await cloudClient
      .from('copyboard_boards')
      .select('owner_id,revision,object_path,content_hash,state_bytes,updated_at,updated_by_device')
      .eq('owner_id',cloudUser.id)
      .maybeSingle();
    if(error) throw error;
    return data || null;
  }
  async function cloudApplySnapshot(metadata){
    if(!metadata?.object_path) throw new Error('Cloud-Snapshot fehlt');
    cloudSetStatus('syncing','Cloud-Stand wird geladen …');
    const {data,error} = await cloudClient.storage.from(CLOUD_CONFIG.bucket).download(metadata.object_path);
    if(error) throw error;
    const serialized = await data.text();
    const hash = await cloudHash(serialized);
    if(metadata.content_hash && hash !== metadata.content_hash) throw new Error('Prüfsumme des Cloud-Stands stimmt nicht');
    const parsed = JSON.parse(serialized);
    const normalized = normalizeState(parsed);
    if(estimateBytes(normalized) > MAX_TOTAL_BYTES) throw new Error('Cloud-Stand überschreitet das Board-Limit');

    cloudApplyingRemote = true;
    try{
      state = normalized;
      syncFromState();
      selectedIds.clear(); lastSelectedId = null;
      selectionBar.classList.remove('show');
      applyViewMode();
      titleInput.value = currentSpace().name;
      renderTabs();
      refreshItems();
      render(true);
      persistState({immediate:true,force:true});
    }finally{
      cloudApplyingRemote = false;
    }

    cloudRevision = Number(metadata.revision) || 0;
    cloudObjectPath = metadata.object_path;
    cloudLastSyncedHash = hash;
    cloudDirty = false;
    cloudPendingRemote = null;
    cloudHideUpdate();
    cloudSaveLocalMeta();
    cloudSetStatus('synced','Synchronisiert');
    showToast('Neuer Cloud-Stand geladen');
  }
  async function cloudLoadLatest(options={}){
    try{
      const metadata = options.metadata || await cloudFetchMetadata();
      if(!metadata){ showToast('Noch kein Cloud-Stand vorhanden'); return; }
      const apply = async()=>{
        if(options.manual && cloudDirty) savePreImportRecovery();
        try{ await cloudApplySnapshot(metadata); }
        catch(error){ console.error('CopyBoard Cloud: Download fehlgeschlagen.', error); cloudSetStatus('error','Cloud-Stand konnte nicht geladen werden'); showToast('Cloud-Stand konnte nicht geladen werden'); }
      };
      if(options.manual && cloudDirty){
        openConfirm(
          'Cloud-Stand laden?',
          'Lokale Änderungen, die noch nicht hochgeladen wurden, werden ersetzt. Vorher wird ein lokaler Wiederherstellungspunkt angelegt.',
          'Sichern & laden',
          apply
        );
      } else await apply();
    }catch(error){
      console.error('CopyBoard Cloud: Metadaten konnten nicht geladen werden.', error);
      cloudSetStatus(navigator.onLine ? 'error' : 'offline','Cloud-Verbindung nicht verfügbar');
      showToast('Cloud-Verbindung nicht verfügbar');
    }
  }
  async function cloudHandleRemoteMetadata(metadata){
    if(!metadata || Number(metadata.revision) <= cloudRevision) return;
    if(metadata.updated_by_device === cloudGetDeviceId()) return;
    if(cloudDirty || cloudUploadRunning) cloudShowUpdate(metadata);
    else await cloudLoadLatest({metadata});
  }
  function cloudUnsubscribe(){
    if(cloudClient && cloudChannel) cloudClient.removeChannel(cloudChannel);
    cloudChannel = null;
  }
  function cloudSubscribe(){
    cloudUnsubscribe();
    if(!cloudClient || !cloudUser) return;
    cloudChannel = cloudClient
      .channel('copyboard-'+cloudUser.id)
      .on('postgres_changes',{
        event:'*', schema:'public', table:'copyboard_boards', filter:'owner_id=eq.'+cloudUser.id
      },payload=>cloudHandleRemoteMetadata(payload.new))
      .subscribe(status=>{
        if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') cloudSetStatus('offline','Realtime vorübergehend nicht verfügbar');
      });
  }
  async function cloudConnectUser(user){
    cloudUser = user;
    cloudSetSignedInUI();
    const localMeta = cloudReadLocalMeta();
    cloudRevision = Number(localMeta?.revision) || 0;
    cloudObjectPath = localMeta?.objectPath || null;
    cloudLastSyncedHash = localMeta?.contentHash || '';
    cloudSubscribe();
    cloudSetStatus('syncing','Cloud-Stand wird geprüft …');

    try{
      const [metadata,currentHash] = await Promise.all([cloudFetchMetadata(),cloudHash(JSON.stringify(state))]);
      if(!metadata){
        cloudRevision = 0; cloudObjectPath = null; cloudLastSyncedHash = '';
        cloudDirty = true;
        await cloudUploadNow();
        return;
      }

      const remoteRevision = Number(metadata.revision) || 0;
      if(localMeta?.revision === remoteRevision && localMeta?.contentHash === currentHash){
        cloudRevision = remoteRevision;
        cloudObjectPath = metadata.object_path;
        cloudLastSyncedHash = currentHash;
        cloudDirty = false;
        cloudSaveLocalMeta();
        cloudSetStatus('synced','Synchronisiert');
      } else if(!localMeta && !cloudStateHasContent()){
        await cloudLoadLatest({metadata});
      } else if(remoteRevision > cloudRevision){
        cloudDirty = currentHash !== cloudLastSyncedHash;
        if(cloudDirty) cloudShowUpdate(metadata);
        else await cloudLoadLatest({metadata});
      } else {
        cloudDirty = currentHash !== (metadata.content_hash || cloudLastSyncedHash);
        cloudRevision = remoteRevision;
        cloudObjectPath = metadata.object_path;
        if(cloudDirty) cloudSchedulePush();
        else cloudSetStatus('synced','Synchronisiert');
      }
    }catch(error){
      console.error('CopyBoard Cloud: Initialisierung fehlgeschlagen.', error);
      cloudSetStatus(navigator.onLine ? 'error' : 'offline','Cloud-Verbindung nicht verfügbar');
    }
  }
  async function cloudUploadNow(){
    if(!cloudClient || !cloudUser || cloudUploadRunning || cloudApplyingRemote || !memoryProtectionOn) return false;
    clearTimeout(cloudPushTimer); cloudPushTimer = null;
    cloudUploadRunning = true;
    cloudSetStatus('syncing','Wird hochgeladen …');
    let uploadedPath = null;
    try{
      const serialized = JSON.stringify(state);
      const hash = await cloudHash(serialized);
      const currentMetadata = await cloudFetchMetadata();
      const remoteRevision = Number(currentMetadata?.revision) || 0;
      if(remoteRevision > cloudRevision){
        cloudShowUpdate(currentMetadata);
        return false;
      }
      if(hash === cloudLastSyncedHash){
        cloudDirty = false;
        cloudSetStatus('synced','Synchronisiert');
        return true;
      }

      const previousPath = currentMetadata?.object_path || cloudObjectPath;
      uploadedPath = cloudUser.id+'/snapshots/'+Date.now()+'-'+cloudGetDeviceId()+'.json';
      const snapshot = new Blob([serialized],{type:'application/json'});
      const {error:uploadError} = await cloudClient.storage
        .from(CLOUD_CONFIG.bucket)
        .upload(uploadedPath,snapshot,{contentType:'application/json',cacheControl:'0',upsert:false});
      if(uploadError) throw uploadError;

      const {data,error:publishError} = await cloudClient.rpc('copyboard_publish_snapshot',{
        p_base_revision:remoteRevision,
        p_object_path:uploadedPath,
        p_content_hash:hash,
        p_state_bytes:snapshot.size,
        p_device_id:cloudGetDeviceId()
      });
      if(publishError) throw publishError;
      const published = Array.isArray(data) ? data[0] : data;
      cloudRevision = Number(published?.revision) || remoteRevision + 1;
      cloudObjectPath = uploadedPath;
      cloudLastSyncedHash = hash;
      cloudDirty = false;
      cloudPendingRemote = null;
      cloudHideUpdate();
      cloudSaveLocalMeta();
      cloudSetStatus('synced','Synchronisiert');
      if(previousPath && previousPath !== uploadedPath){
        cloudClient.storage.from(CLOUD_CONFIG.bucket).remove([previousPath]).catch(()=>{});
      }
      return true;
    }catch(error){
      console.error('CopyBoard Cloud: Upload fehlgeschlagen.', error);
      if(uploadedPath) cloudClient.storage.from(CLOUD_CONFIG.bucket).remove([uploadedPath]).catch(()=>{});
      const conflict = String(error?.message || '').includes('COPYBOARD_REVISION_CONFLICT');
      if(conflict){
        try{ cloudShowUpdate(await cloudFetchMetadata()); }catch(e){ cloudSetStatus('error','Versionskonflikt'); }
      } else cloudSetStatus(navigator.onLine ? 'error' : 'offline','Upload ausstehend — lokale Kopie ist sicher');
      return false;
    }finally{
      cloudUploadRunning = false;
    }
  }
  function cloudSchedulePush(){
    if(!cloudUser || cloudApplyingRemote || !memoryProtectionOn) return;
    clearTimeout(cloudPushTimer);
    cloudPushTimer = setTimeout(()=>cloudUploadNow(),CLOUD_PUSH_DEBOUNCE_MS);
  }
  let cloudHashRequest = 0;
  async function cloudMarkLocalPersisted(serialized){
    if(!cloudUser || cloudApplyingRemote) return;
    const request = ++cloudHashRequest;
    const hash = await cloudHash(serialized);
    if(request !== cloudHashRequest) return;
    cloudDirty = hash !== cloudLastSyncedHash;
    if(cloudDirty) cloudSchedulePush();
    else cloudSetStatus('synced','Synchronisiert');
  }
  async function cloudReconcile(){
    if(!cloudClient || !cloudUser) return;
    try{
      const metadata = await cloudFetchMetadata();
      if(metadata && Number(metadata.revision) > cloudRevision) await cloudHandleRemoteMetadata(metadata);
      else if(cloudDirty) cloudSchedulePush();
      else cloudSetStatus('synced','Synchronisiert');
    }catch(error){ cloudSetStatus(navigator.onLine ? 'error' : 'offline','Cloud-Verbindung nicht verfügbar'); }
  }
  async function initCloudSync(){
    cloudGetDeviceId();
    cloudSetSignedInUI();
    if(!cloudIsConfigured()){
      cloudSetStatus('local','Cloud noch nicht konfiguriert');
      cloudModalCopy.textContent = 'Trage zuerst Projekt-URL und öffentlichen Supabase-Schlüssel im V34-Konfigurationsblock ein. Bis dahin läuft CopyBoard vollständig lokal.';
      cloudSignInBtn.disabled = true;
      return;
    }
    if(!window.supabase?.createClient){
      cloudSetStatus('error','Cloud-Bibliothek konnte nicht geladen werden');
      return;
    }
    cloudClient = window.supabase.createClient(CLOUD_CONFIG.supabaseUrl,CLOUD_CONFIG.supabasePublishableKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    cloudClient.auth.onAuthStateChange((_event,session)=>{
      setTimeout(()=>{
        if(session?.user){
          if(session.user.id !== cloudUser?.id) cloudConnectUser(session.user);
        } else {
          cloudUnsubscribe(); cloudUser = null; cloudRevision = 0; cloudLastSyncedHash = ''; cloudDirty = false;
          cloudSetSignedInUI(); cloudSetStatus('local','Nicht mit der Cloud verbunden');
        }
      },0);
    });
    const {data,error} = await cloudClient.auth.getSession();
    if(error){ cloudSetStatus('error','Anmeldung konnte nicht geprüft werden'); return; }
    if(data.session?.user) await cloudConnectUser(data.session.user);
    else cloudSetStatus('local','Nicht mit der Cloud verbunden');
  }

  cloudToggle.addEventListener('click',()=>{ cloudSetSignedInUI(); cloudOverlay.classList.add('show'); });
  cloudCloseBtn.addEventListener('click',()=>cloudOverlay.classList.remove('show'));
  cloudSignedInCloseBtn.addEventListener('click',()=>cloudOverlay.classList.remove('show'));
  cloudOverlay.addEventListener('click',event=>{ if(event.target===cloudOverlay) cloudOverlay.classList.remove('show'); });
  cloudSignInBtn.addEventListener('click',async()=>{
    if(!cloudClient) return;
    const email = cloudEmailInput.value.trim();
    const password = cloudPasswordInput.value;
    if(!email || !password){ showToast('E-Mail und Passwort eingeben'); return; }
    cloudSignInBtn.disabled = true; cloudSignInBtn.textContent = 'Wird angemeldet …';
    const {error} = await cloudClient.auth.signInWithPassword({email,password});
    cloudSignInBtn.disabled = false; cloudSignInBtn.textContent = 'Anmelden';
    if(error){ showToast('Anmeldung fehlgeschlagen'); return; }
    cloudPasswordInput.value = '';
    cloudOverlay.classList.remove('show');
    showToast('Cloud-Konto verbunden');
  });
  cloudPasswordInput.addEventListener('keydown',event=>{ if(event.key==='Enter') cloudSignInBtn.click(); });
  cloudSyncNowBtn.addEventListener('click',async()=>{
    if(cloudPendingRemote){ cloudShowUpdate(cloudPendingRemote); showToast('Zuerst den neueren Cloud-Stand prüfen'); return; }
    const ok = await cloudUploadNow();
    if(ok) showToast('Synchronisiert');
  });
  cloudDownloadBtn.addEventListener('click',()=>cloudLoadLatest({manual:true}));
  cloudSignOutBtn.addEventListener('click',async()=>{ if(cloudClient) await cloudClient.auth.signOut(); cloudOverlay.classList.remove('show'); showToast('Cloud-Konto getrennt'); });
  cloudUpdateBtn.addEventListener('click',()=>cloudLoadLatest({metadata:cloudPendingRemote,manual:true}));
  cloudUpdateDismiss.addEventListener('click',()=>cloudHideUpdate());
  window.addEventListener('online',()=>{ if(cloudUser){ cloudSetStatus('syncing','Verbindung wird wiederhergestellt …'); cloudReconcile(); } });
  window.addEventListener('offline',()=>cloudSetStatus('offline','Offline — lokale Kopie ist verfügbar'));
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible' && cloudUser) cloudReconcile(); });

  function fileToDataURL(file){
    return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error('Lesefehler')); r.readAsDataURL(file); });
  }
  function openConfirm(title,msg,okLabel,onOk){
    confirmTitle.textContent=title; confirmMsg.textContent=msg; confirmOkBtn.textContent=okLabel;
    confirmOkBtn.onclick=async()=>{ confirmOverlay.classList.remove('show'); await onOk(); };
    confirmOverlay.classList.add('show');
  }

  function openDestructiveConfirm(title,msg,okLabel,onOk){
    if(!getSetting('behavior.confirmDestructiveActions')){
      Promise.resolve().then(onOk);
      return;
    }
    openConfirm(title,msg,okLabel,onOk);
  }
  confirmCancelBtn.addEventListener('click', ()=>confirmOverlay.classList.remove('show'));
  confirmOverlay.addEventListener('click', (e)=>{ if(e.target===confirmOverlay) confirmOverlay.classList.remove('show'); });

  function itemStorageBytes(item){ return estimateBytes(item || {}); }
  function getStorageSnapshot(){
    const entries = []; let cards = 0;
    for(const sp of state.spaces || []){
      const d = state.data?.[sp.id];
      if(!d) continue;
      const nestedIn = new Map();
      for(const candidate of Object.values(d.items || {})){
        if(candidate?.type !== 'folder') continue;
        for(const nestedId of candidate.itemIds || []) nestedIn.set(nestedId, candidate.id);
      }
      for(const [id,item] of Object.entries(d.items || {})){
        if(!item) continue;
        cards++;
        const folderId = nestedIn.get(id) || null;
        const folder = folderId ? d.items?.[folderId] : null;
        entries.push({
          id, item, spaceId:sp.id, space:sp.name,
          folderId, folderName:folder ? displayName(folder) : '',
          name:displayName(item), bytes:itemStorageBytes(item)
        });
      }
    }
    entries.sort((a,b)=>b.bytes-a.bytes);
    const used = estimateBytes(state);
    return {used, percent:Math.min(100, used / MAX_TOTAL_BYTES * 100), cards, entries};
  }
  function deleteStorageEntry(entry){
    const data = state.data?.[entry.spaceId];
    const item = data?.items?.[entry.id];
    if(!data || !item){ showToast('Inhalt nicht mehr vorhanden'); openStorageStatus(); return; }
    mutationCheckpoint('content', entry.spaceId);
    if(item.type === 'folder'){
      for(const nestedId of item.itemIds || []) delete data.items[nestedId];
      data.itemIds = (data.itemIds || []).filter(id=>id!==entry.id);
      delete data.items[entry.id];
    } else if(entry.folderId && data.items?.[entry.folderId]){
      const folder = data.items[entry.folderId];
      folder.itemIds = (folder.itemIds || []).filter(id=>id!==entry.id);
      delete data.items[entry.id];
      if(!folder.itemIds.length){
        data.itemIds = (data.itemIds || []).filter(id=>id!==entry.folderId);
        delete data.items[entry.folderId];
      }
    } else {
      data.itemIds = (data.itemIds || []).filter(id=>id!==entry.id);
      delete data.items[entry.id];
    }
    if(entry.spaceId === currentSpaceId){ refreshItems(); render(); }
    persistState();
    showToast('Gelöscht');
    openStorageStatus();
  }
  function openStorageStatus(){
    const snap = getStorageSnapshot();
    storageMeterFill.style.width = snap.percent.toFixed(1)+'%';
    storageMeterFill.classList.toggle('warn', snap.percent >= 70 && snap.percent < 90);
    storageMeterFill.classList.toggle('danger', snap.percent >= 90);
    storageUsedLabel.textContent = fmtSize(snap.used)+' verwendet';
    storageLimitLabel.textContent = 'von '+fmtSize(MAX_TOTAL_BYTES);
    storageCardsCount.textContent = String(snap.cards);
    storageSpacesCount.textContent = String((state.spaces || []).length);
    storagePercentLabel.textContent = Math.round(snap.percent)+' %';
    storageLargestList.innerHTML = '';
    if(!snap.entries.length){
      const empty=document.createElement('div'); empty.className='storage-row';
      empty.innerHTML='<div class="storage-row-main"><span class="storage-row-name">Noch keine Inhalte</span></div><span class="storage-row-size">0 B</span>';
      storageLargestList.appendChild(empty);
    }
    snap.entries.forEach(entry=>{
      const row=document.createElement('div'); row.className='storage-row';
      const main=document.createElement('div'); main.className='storage-row-main';
      const name=document.createElement('span'); name.className='storage-row-name'; name.textContent=entry.name;
      const meta=document.createElement('span'); meta.className='storage-row-meta'; meta.textContent=entry.folderName ? entry.space+' · '+entry.folderName : entry.space;
      main.append(name,meta);
      const size=document.createElement('span'); size.className='storage-row-size'; size.textContent=fmtSize(entry.bytes);
      const actions=document.createElement('div'); actions.className='storage-row-actions';
      const preview=document.createElement('button'); preview.className='storage-row-action'; preview.type='button'; preview.title='Vorschau'; preview.setAttribute('aria-label','Vorschau für '+entry.name);
      preview.innerHTML=utilityIconMarkup('preview');
      preview.addEventListener('click', ()=>{
        if(entry.item.type === 'folder'){
          folderOverlay.classList.add('storage-child-modal');
          switchSpace(entry.spaceId);
          setTimeout(()=>openFolder(entry.item), 40);
        } else {
          previewOverlay.classList.add('storage-child-modal');
          openPreview(entry.item);
        }
      });
      const del=document.createElement('button'); del.className='storage-row-action delete'; del.type='button'; del.title='Löschen'; del.setAttribute('aria-label',entry.name+' löschen');
      del.innerHTML=utilityIconMarkup('trash');
      del.addEventListener('click', ()=>openDestructiveConfirm('Inhalt löschen?', '„'+entry.name+'“ wird dauerhaft aus „'+entry.space+'“ gelöscht.', 'Löschen', ()=>deleteStorageEntry(entry)));
      actions.append(preview,del);
      row.append(main,size,actions); storageLargestList.appendChild(row);
    });
    storageHint.textContent = snap.percent >= 90
      ? 'Kritische Auslastung: Lösche oder exportiere große Inhalte, bevor weitere Daten abgelegt werden.'
      : snap.percent >= 70
        ? 'Der konfigurierte CopyBoard-Speicher wird knapp. Große Bilder, Audios und Dateien belegen den meisten Platz.'
        : 'Die Anzeige misst den vollständigen CopyBoard-Zustand. Das tatsächliche Browserlimit für localStorage kann je nach Browser niedriger sein.';
    storageOverlay.classList.add('show');
  }
  autosaveStatusEl.addEventListener('click', openStorageStatus);
  storageCloseBtn.addEventListener('click', ()=>storageOverlay.classList.remove('show'));
  storageOverlay.addEventListener('click', e=>{ if(e.target===storageOverlay) storageOverlay.classList.remove('show'); });

  // ---------- AutoSave toggle ----------
  // ON: every change is written to localStorage immediately.
  // OFF: changes remain temporary for this session. The last saved snapshot is preserved and restored on reload.
  function applyMemoryToggle(){
    memoryToggle.classList.toggle('active', memoryProtectionOn);
    memoryToggle.classList.toggle('unavailable', !storageAvailable);
    memoryToggle.title = !storageAvailable
      ? 'AutoSave ist in diesem Browser nicht verfügbar'
      : memoryProtectionOn
        ? 'AutoSave ist aktiv: Änderungen werden dauerhaft lokal gespeichert'
        : 'Temporärer Modus: Änderungen werden nicht gespeichert; der letzte gespeicherte Stand bleibt erhalten';
    refreshAutosaveStatus();
  }
  memoryToggle.addEventListener('click', ()=>{
    if(!storageAvailable){ showToast('localStorage ist in diesem Browser nicht verfügbar'); return; }
    memoryProtectionOn = !memoryProtectionOn;
    setSetting('device.autoSave', memoryProtectionOn, {persist:false});
    if(memoryProtectionOn){
      persistState({immediate:true, force:true});
      showToast('AutoSave aktiviert — der aktuelle Stand wurde gespeichert');
    } else {
      sessionDirty = false;
      showToast('Temporärer Modus aktiviert — der letzte gespeicherte Stand bleibt erhalten');
    }
    applyMemoryToggle();
  });

  function flushBeforePageExit(){
    if(memoryProtectionOn && persistPending) flushPersistedState();
  }

  window.addEventListener('pagehide', flushBeforePageExit);
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'hidden') flushBeforePageExit();
  });

  window.addEventListener('beforeunload', (e)=>{
    flushBeforePageExit();
    if(memoryProtectionOn || !sessionDirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // ---------- tabs ----------
  let dropdownOpen = false;
  function updateTabsOverflow(){
    const overflow = tabsScroll.scrollWidth > tabsScroll.clientWidth + 2;
    scrollLeftBtn.hidden = !overflow;
    scrollRightBtn.hidden = !overflow;
    tabOverflowBtn.hidden = !overflow;
    tabOverflowBtn.classList.toggle('open', dropdownOpen && overflow);
    if(!overflow){ dropdownOpen=false; tabsDropdown.classList.remove('show'); }
  }
  function mixHex(baseHex, tintHex, amount){
    const parse = (hex)=>{
      const clean = String(hex || '').replace('#','');
      if(!/^[0-9a-f]{6}$/i.test(clean)) return null;
      return [parseInt(clean.slice(0,2),16), parseInt(clean.slice(2,4),16), parseInt(clean.slice(4,6),16)];
    };
    const base = parse(baseHex), tint = parse(tintHex);
    if(!base || !tint) return baseHex;
    const a = Math.max(0, Math.min(1, Number(amount) || 0));
    return '#' + base.map((v,i)=>Math.round(v*(1-a)+tint[i]*a).toString(16).padStart(2,'0')).join('');
  }
  function applySpaceAtmosphere(sp){
    const root = document.documentElement;
    const tint = sp && sp.color;
    const mode = getSetting('appearance.spaceAtmosphere');
    const defaults = {
      primary:'#4f6bff', secondary:'#8a76ff', tertiary:'#ff6b57',
      deep:'#05060c', mid:'#0c1230', top:'#070912'
    };
    if(!tint || mode === 'off'){
      root.style.setProperty('--atmo-primary', defaults.primary);
      root.style.setProperty('--atmo-secondary', defaults.secondary);
      root.style.setProperty('--atmo-tertiary', defaults.tertiary);
      root.style.setProperty('--atmo-deep', defaults.deep);
      root.style.setProperty('--atmo-mid', defaults.mid);
      root.style.setProperty('--atmo-top', defaults.top);
      return;
    }
    const weights = mode === 'strong'
      ? {primary:.76, secondary:.80, tertiary:.66, deep:.16, mid:.22, top:.18}
      : {primary:.58, secondary:.62, tertiary:.48, deep:.10, mid:.14, top:.11};
    root.style.setProperty('--atmo-primary', mixHex(defaults.primary, tint, weights.primary));
    root.style.setProperty('--atmo-secondary', mixHex(defaults.secondary, tint, weights.secondary));
    root.style.setProperty('--atmo-tertiary', mixHex(defaults.tertiary, tint, weights.tertiary));
    root.style.setProperty('--atmo-deep', mixHex(defaults.deep, tint, weights.deep));
    root.style.setProperty('--atmo-mid', mixHex(defaults.mid, tint, weights.mid));
    root.style.setProperty('--atmo-top', mixHex(defaults.top, tint, weights.top));
  }
  function renderTabs(){
    applySpaceAtmosphere(currentSpace());
    tabsScroll.innerHTML = '';
    spaces.forEach(sp=>{
      const tab = document.createElement('div');
      tab.className = 'tab' + (sp.id===currentSpaceId ? ' active' : '');
      tab.dataset.id = sp.id;
      if(sp.id===currentSpaceId && sp.color) tab.style.background = sp.color;
      const handle = document.createElement('span');
      handle.className = 'tab-handle'; handle.title = 'Ziehen zum Verschieben';
      handle.innerHTML = '<svg width="8" height="14" viewBox="0 0 8 16" fill="currentColor"><circle cx="2" cy="2" r="1.5"/><circle cx="6" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="6" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="6" cy="14" r="1.5"/></svg>';
      handle.addEventListener('pointerdown', (e)=>{ e.stopPropagation(); startTabDrag(e, tab, sp.id); });
      handle.addEventListener('click', (e)=> e.stopPropagation());
      tab.appendChild(handle);
      const dot = document.createElement('span');
      dot.className = 'tab-dot';
      dot.title = 'Farb-Label';
      dot.style.background = sp.color || 'transparent';
      dot.style.border = sp.color ? 'none' : '2px solid currentColor';
      dot.style.opacity = sp.color ? '1' : '.4';
      dot.addEventListener('click', (e)=>{ e.stopPropagation(); openColorPicker(dot, sp); });
      tab.appendChild(dot);
      const label = document.createElement('span');
      label.className = 'tab-label'; label.textContent = sp.name;
      tab.appendChild(label);
      const pencil = document.createElement('span');
      pencil.className = 'tab-pencil'; pencil.title = 'Umbenennen';
      pencil.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
      pencil.addEventListener('click', (e)=>{ e.stopPropagation(); enterTabRenameMode(tab, sp); });
      tab.appendChild(pencil);
      if(spaces.length > 1){
        const x = document.createElement('span');
        x.className = 'tab-x';
        x.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        x.addEventListener('click', (e)=>{ e.stopPropagation(); openDestructiveConfirm('Space löschen?', `"${sp.name}" und alle enthaltenen Einträge werden gelöscht.`, 'Löschen', ()=>deleteSpace(sp.id)); });
        tab.appendChild(x);
      }
      tab.addEventListener('click', ()=>{ if(sp.id!==currentSpaceId) switchSpace(sp.id); });
      tab.addEventListener('contextmenu', (e)=>{
        e.preventDefault(); e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, buildSpaceContextMenu(sp, tab));
      });
      tabsScroll.appendChild(tab);
    });
    renderDropdown();
    requestAnimationFrame(updateTabsOverflow);
  }
  function enterTabRenameMode(tabEl, sp){
    const label = tabEl.querySelector('.tab-label');
    if(!label) return;
    const input = document.createElement('input');
    input.className = 'tab-rename-input'; input.maxLength = 40; input.value = sp.name;
    label.replaceWith(input); input.focus(); input.select();
    input.addEventListener('click', (e)=> e.stopPropagation());
    input.addEventListener('pointerdown', (e)=> e.stopPropagation());
    input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape'){ input.value=sp.name; input.blur(); } });
    input.addEventListener('blur', ()=>{
      const nextName = input.value.trim() || sp.name;
      if(nextName !== sp.name){
        mutationCheckpoint('spaceMeta');
        sp.name = nextName;
        if(sp.id === currentSpaceId) titleInput.value = sp.name;
        persistState();
      }
      renderTabs();
    });
  }
  scrollLeftBtn.addEventListener('click', ()=> tabsScroll.scrollBy({left:-120, behavior:'smooth'}));
  scrollRightBtn.addEventListener('click', ()=> tabsScroll.scrollBy({left:120, behavior:'smooth'}));
  tabAddBtn.addEventListener('click', addSpace);
  tabOverflowBtn.addEventListener('click', (e)=>{ e.stopPropagation(); toggleDropdown(); });
  function toggleDropdown(){
    dropdownOpen = !dropdownOpen;
    tabsDropdown.classList.toggle('show', dropdownOpen);
    tabOverflowBtn.classList.toggle('open', dropdownOpen);
  }
  document.addEventListener('click', (e)=>{
    if(dropdownOpen && !tabsDropdown.contains(e.target) && e.target!==tabOverflowBtn && !tabOverflowBtn.contains(e.target)){
      dropdownOpen=false; tabsDropdown.classList.remove('show'); tabOverflowBtn.classList.remove('open');
    }
  });
  function hexToRgba(hex, alpha){
    const clean = String(hex || '').replace('#','');
    if(!/^[0-9a-fA-F]{6}$/.test(clean)) return `rgba(79,107,255,${alpha})`;
    const n = parseInt(clean, 16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`;
  }
  function beginDropdownRename(row, sp){
    const main = row.querySelector('.dd-main');
    if(!main) return;
    const oldName = sp.name;
    main.innerHTML = '';
    const dot = document.createElement('span');
    dot.className = 'dd-color';
    dot.style.background = sp.color || '#c7cbd3';
    main.appendChild(dot);
    const input = document.createElement('input');
    input.className = 'dd-rename-input';
    input.maxLength = 40;
    input.value = oldName;
    main.appendChild(input);
    input.focus(); input.select();
    let settled = false;
    const finish = (save)=>{
      if(settled) return;
      settled = true;
      if(save){
        const next = input.value.trim();
        if(next && next !== sp.name){
          mutationCheckpoint('spaceMeta');
          sp.name = next;
          if(sp.id === currentSpaceId) titleInput.value = sp.name;
          persistState();
        }
      }
      renderTabs();
      dropdownOpen = true;
      tabsDropdown.classList.add('show');
      tabOverflowBtn.classList.add('open');
    };
    input.addEventListener('click', e=>e.stopPropagation());
    input.addEventListener('pointerdown', e=>e.stopPropagation());
    input.addEventListener('keydown', e=>{
      if(e.key==='Enter'){ e.preventDefault(); finish(true); }
      if(e.key==='Escape'){ e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', ()=>finish(true), {once:true});
  }
  function renderDropdown(){
    tabsDropdown.innerHTML = '';
    spaces.forEach(sp=>{
      const row = document.createElement('div');
      row.className = 'dropdown-row' + (sp.id===currentSpaceId ? ' active' : '');
      row.dataset.id = sp.id;
      const tint = sp.color || '#c7cbd3';
      row.style.background = `linear-gradient(90deg, ${hexToRgba(tint, sp.id===currentSpaceId ? .14 : .075)}, rgba(255,255,255,.96) 72%)`;

      const main = document.createElement('div');
      main.className = 'dd-main';
      const dot = document.createElement('span');
      dot.className = 'dd-color';
      dot.style.background = tint;
      dot.title = 'Space-Farbe';
      const name = document.createElement('span');
      name.className='dd-name'; name.textContent=sp.name;
      main.append(dot, name);
      row.appendChild(main);

      const actions = document.createElement('div');
      actions.className = 'dd-actions';
      const colorBtn = document.createElement('button');
      colorBtn.className = 'dd-action';
      colorBtn.title = 'Farbe ändern';
      colorBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 8h.01M16 12h.01M12 16h.01"/></svg>';
      colorBtn.addEventListener('click', e=>{ e.stopPropagation(); openColorPicker(colorBtn, sp); });
      actions.appendChild(colorBtn);

      const renameBtn = document.createElement('button');
      renameBtn.className = 'dd-action';
      renameBtn.title = 'Umbenennen';
      renameBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
      renameBtn.addEventListener('click', e=>{ e.stopPropagation(); beginDropdownRename(row, sp); });
      actions.appendChild(renameBtn);

      if(spaces.length > 1){
        const delBtn = document.createElement('button');
        delBtn.className = 'dd-action danger';
        delBtn.title = 'Space löschen';
        delBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        delBtn.addEventListener('click', e=>{ e.stopPropagation(); openDestructiveConfirm('Space löschen?', `"${sp.name}" und alle enthaltenen Einträge werden gelöscht.`, 'Löschen', ()=>deleteSpace(sp.id)); });
        actions.appendChild(delBtn);
      }
      row.appendChild(actions);

      row.addEventListener('click', async ()=>{
        dropdownOpen=false; tabsDropdown.classList.remove('show'); tabOverflowBtn.classList.remove('open');
        if(sp.id !== currentSpaceId){ await switchSpace(sp.id); }
        const tabEl = tabsScroll.querySelector(`.tab[data-id="${sp.id}"]`);
        if(tabEl) tabEl.scrollIntoView({behavior:'smooth', inline:'center', block:'nearest'});
      });
      tabsDropdown.appendChild(row);
    });
  }
  let tabsResizeTimer=null;
  window.addEventListener('resize', ()=>{ clearTimeout(tabsResizeTimer); tabsResizeTimer=setTimeout(updateTabsOverflow, 150); });

  let dragState = null;
  function startTabDrag(e, tabEl, spaceId){
    e.preventDefault();
    const visibleEls = Array.from(tabsScroll.querySelectorAll('.tab'));
    dragState = { spaceId, startX:e.clientX, correction:0, orderIds:visibleEls.map(el=>el.dataset.id), moved:false };
    tabEl.classList.add('dragging'); tabEl.setPointerCapture(e.pointerId); tabEl.style.transition='none';
    function onMove(ev){
      const deltaX = ev.clientX - dragState.startX;
      if(Math.abs(deltaX) > 3) dragState.moved = true;
      tabEl.style.transform = `translateX(${deltaX + dragState.correction}px)`;
      const others = Array.from(tabsScroll.querySelectorAll('.tab')).filter(el=>el!==tabEl);
      const pointerX = ev.clientX;
      let newIndex = 0;
      others.forEach(el=>{ const r=el.getBoundingClientRect(); if(r.left+r.width/2 < pointerX) newIndex++; });
      const currentIndex = dragState.orderIds.indexOf(spaceId);
      if(newIndex !== currentIndex){
        const allEls = Array.from(tabsScroll.querySelectorAll('.tab'));
        const before = new Map(allEls.map(el=>[el, el.getBoundingClientRect()]));
        dragState.orderIds.splice(currentIndex,1); dragState.orderIds.splice(newIndex,0,spaceId);
        allEls.forEach(el=> el.style.order = dragState.orderIds.indexOf(el.dataset.id));
        void tabsScroll.offsetWidth;
        const after = new Map(allEls.map(el=>[el, el.getBoundingClientRect()]));
        allEls.forEach(el=>{
          if(el===tabEl){ const jump=after.get(el).left-before.get(el).left; dragState.correction-=jump; tabEl.style.transform=`translateX(${deltaX+dragState.correction}px)`; }
          else{ const dx=before.get(el).left-after.get(el).left; el.style.transition='none'; el.style.transform=`translateX(${dx}px)`;
            requestAnimationFrame(()=>{ el.style.transition='transform .28s cubic-bezier(.2,.8,.2,1)'; el.style.transform='translateX(0)'; }); }
        });
      }
    }
    function onUp(){
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      tabEl.classList.remove('dragging');
      tabEl.style.transition='transform .2s cubic-bezier(.2,.8,.2,1)'; tabEl.style.transform='translateX(0)';
      if(dragState.moved){
        mutationCheckpoint('spaceMeta');
        const visibleSet = new Set(dragState.orderIds);
        const rest = spaces.filter(s=>!visibleSet.has(s.id));
        const reordered = dragState.orderIds.map(id=> spaces.find(s=>s.id===id));
        spaces = [...reordered, ...rest];
        state.spaces = spaces;
        persistState();
      }
      setTimeout(()=>{
        Array.from(tabsScroll.querySelectorAll('.tab')).forEach(el=>{ el.style.order=''; el.style.transform=''; el.style.transition=''; });
        renderTabs();
      }, 160);
      dragState = null;
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // ---------- view toggle ----------
  function applyViewMode(){
    grid.classList.toggle('list-view', viewMode==='list');
    viewGridBtn.classList.toggle('active', viewMode==='grid');
    viewListBtn.classList.toggle('active', viewMode==='list');
  }
  function setViewMode(mode){ viewMode = setSetting('appearance.viewMode', mode, {persist:false}); state.viewMode = viewMode; applyViewMode(); persistState(); }
  viewGridBtn.addEventListener('click', ()=> setViewMode('grid'));
  viewListBtn.addEventListener('click', ()=> setViewMode('list'));

  // ---------- context menu ----------
  let lastCtxPos = {x:0,y:0};
  let submenuCloseTimer = null;

  function renderContextRows(container, rows, isSubmenu){
    container.innerHTML = '';
    rows.forEach(r=>{
      if(r.sep){ const sep=document.createElement('div'); sep.className='ctx-sep'; container.appendChild(sep); return; }
      if(r.header){ const label=document.createElement('div'); label.className='ctx-label'; label.textContent=r.label; container.appendChild(label); return; }
      const row=document.createElement('div');
      row.className='ctx-row'+(r.danger?' danger':'')+(r.disabled?' disabled':'')+(r.submenu?' has-submenu':'');
      row.innerHTML=`${r.icon||''}<span>${r.label}</span>`;
      if(r.submenu){
        const open=()=>openContextSubmenu(row,r.submenu);
        row.addEventListener('mouseenter',open);
        row.addEventListener('click',(e)=>{ e.stopPropagation(); open(); });
      } else if(!r.disabled){
        row.addEventListener('click',(e)=>{ e.stopPropagation(); hideContextMenu(); r.onClick(); });
      }
      container.appendChild(row);
    });
  }

  function showContextMenu(x, y, rows){
    lastCtxPos={x,y};
    hideContextSubmenu();
    renderContextRows(contextMenu,rows,false);
    contextMenu.style.left='0px'; contextMenu.style.top='0px'; contextMenu.classList.add('show');
    const rect=contextMenu.getBoundingClientRect();
    const clampedX=Math.min(x,window.innerWidth-rect.width-10);
    const clampedY=Math.min(y,window.innerHeight-rect.height-10);
    contextMenu.style.left=Math.max(10,clampedX)+'px';
    contextMenu.style.top=Math.max(10,clampedY)+'px';
  }

  function openContextSubmenu(anchorRow, rows){
    if(submenuCloseTimer){ clearTimeout(submenuCloseTimer); submenuCloseTimer=null; }
    renderContextRows(contextSubmenu,rows,true);
    contextSubmenu.style.left='0px'; contextSubmenu.style.top='0px'; contextSubmenu.classList.add('show');
    const anchor=anchorRow.getBoundingClientRect();
    const rect=contextSubmenu.getBoundingClientRect();
    let left=anchor.right+6;
    if(left+rect.width>window.innerWidth-10) left=anchor.left-rect.width-6;
    let top=Math.min(anchor.top,window.innerHeight-rect.height-10);
    contextSubmenu.style.left=Math.max(10,left)+'px';
    contextSubmenu.style.top=Math.max(10,top)+'px';
  }

  function scheduleSubmenuClose(){
    if(submenuCloseTimer) clearTimeout(submenuCloseTimer);
    submenuCloseTimer=setTimeout(()=>hideContextSubmenu(),180);
  }
  function hideContextSubmenu(){ contextSubmenu.classList.remove('show'); contextSubmenu.innerHTML=''; }
  function hideContextMenu(){ contextMenu.classList.remove('show'); hideContextSubmenu(); }

  contextMenu.addEventListener('mouseleave',(e)=>{ if(!contextSubmenu.contains(e.relatedTarget)) scheduleSubmenuClose(); });
  contextSubmenu.addEventListener('mouseenter',()=>{ if(submenuCloseTimer){ clearTimeout(submenuCloseTimer); submenuCloseTimer=null; } });
  contextSubmenu.addEventListener('mouseleave',(e)=>{ if(!contextMenu.contains(e.relatedTarget)) scheduleSubmenuClose(); });
  document.addEventListener('click',(e)=>{ if(!contextMenu.contains(e.target)&&!contextSubmenu.contains(e.target)) hideContextMenu(); });
  document.addEventListener('scroll',hideContextMenu,true);
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') hideContextMenu(); });

  const ICONS = {
    preview:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    folderOpen:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
    copy:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    rename:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    reset:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
    download:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 19h16"/></svg>',
    unlink:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></svg>',
    trash:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>',
    move:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16M14 6l6 6-6 6"/></svg>',
    paste:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/></svg>',
    plus:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    grid:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>',
    list:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    duplicate:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="13" height="13" rx="2.5"/><path d="M9 16v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-3"/></svg>',
    share:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.7 15.7 6.3M8.3 13.3l7.4 4.4"/></svg>',
    edit:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l1.5-1.5a1 1 0 0 1 1.4 0l.6.6a1 1 0 0 1 0 1.4L11 17l-2 .5.5-2Z"/></svg>',
    pin:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6"/><path d="M8 8h8l1 5H7l1-5Z"/><path d="M12 13v9"/></svg>',
    palette:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 0 20c1.4 0 2-1 2-2s-.5-1.5-.5-2.3c0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4c0-5.5-4.5-10-9-10Z"/><circle cx="7.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="9.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
    ocr:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h4M7 12h10M7 15h7"/></svg>',
    lock:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    unlock:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.4-2"/></svg>',
    star:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>',
    fire:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1 3-3 4-3 8a3 3 0 0 0 6 0c1.5 1 2 3 2 4.5A5.5 5.5 0 0 1 6 15c0-5 4-6 6-13Z"/></svg>',
    info:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>'
  };

  const CARD_ICONS = Object.freeze({
    preview:'<svg class="card-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.75"/></svg>',
    folderOpen:'<svg class="card-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z"/></svg>',
    copy:'<svg class="card-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8.5" y="8.5" width="12" height="12" rx="2.25"/><path d="M15.5 5.5v-1A2 2 0 0 0 13.5 2.5h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1"/></svg>',
    edit:'<svg class="card-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 5.5 18.5 10.5"/><path d="m4 20 1.2-5.1L15.8 4.3a2.1 2.1 0 0 1 3 3L8.1 17.8Z"/><path d="m5.2 14.9 2.9 2.9"/></svg>',
    trash:'<svg class="card-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="m6.5 7 .8 13h9.4l.8-13"/><path d="M10 11v5M14 11v5"/></svg>',
    lock:'<svg class="card-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10" width="15" height="10" rx="2.25"/><path d="M8 10V7.25a4 4 0 0 1 8 0V10"/></svg>',
    unlock:'<svg class="card-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10" width="15" height="10" rx="2.25"/><path d="M8 10V7.25a4 4 0 0 1 7.35-2.2"/></svg>',
    pin:'<svg class="card-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6"/><path d="m10 3-.8 6-2.2 3h10l-2.2-3L14 3"/><path d="M12 12v9"/></svg>',
    star:'<svg class="card-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.45 6.02.88-4.36 4.25 1.03 6-5.39-2.84-5.39 2.84 1.03-6-4.36-4.25 6.02-.88Z"/></svg>',
    share:'<svg class="card-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/></svg>'
  });


  const MENU_ICONS = Object.freeze({
    preview:CARD_ICONS.preview,
    copy:CARD_ICONS.copy,
    edit:CARD_ICONS.edit,
    trash:CARD_ICONS.trash,
    star:CARD_ICONS.star,
    pin:CARD_ICONS.pin,
    share:CARD_ICONS.share,
    duplicate:'<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h1"/></svg>',
    rename:'<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h10M4 12h7M4 18h5"/><path d="m14 16 5-5 2 2-5 5-3 1Z"/></svg>',
    color:'<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a1.5 1.5 0 0 1 0-3h3a6 6 0 0 0 0-12Z"/><circle cx="7.5" cy="9" r=".75" fill="currentColor" stroke="none"/></svg>',
    search:'<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
    upload:'<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M5 20h14"/></svg>',
    download:'<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12"/><path d="m7.5 11.5 4.5 4.5 4.5-4.5"/><path d="M5 20h14"/></svg>',
    settings:'<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></svg>',
    folder:CARD_ICONS.folderOpen,
    lock:CARD_ICONS.lock
  });

  function inferMenuIcon(label=''){
    const value=String(label).trim().toLowerCase();
    if(/vorschau|öffnen/.test(value)) return 'preview';
    if(/kopieren|zwischenablage/.test(value)) return 'copy';
    if(/bearbeiten/.test(value)) return 'edit';
    if(/umbenennen/.test(value)) return 'rename';
    if(/favorit/.test(value)) return 'star';
    if(/anheften|pin/.test(value)) return 'pin';
    if(/teilen/.test(value)) return 'share';
    if(/löschen|leeren/.test(value)) return 'trash';
    if(/duplizieren/.test(value)) return 'duplicate';
    if(/export|download/.test(value)) return 'download';
    if(/import|upload/.test(value)) return 'upload';
    if(/einstellungen/.test(value)) return 'settings';
    if(/such/.test(value)) return 'search';
    if(/farbe/.test(value)) return 'color';
    if(/ordner/.test(value)) return 'folder';
    if(/pin entfernen|entsperren|sperren/.test(value)) return 'lock';
    return '';
  }

  function decorateMenuIcons(root=document){
    root.querySelectorAll('.ctx-row,.dropdown-row').forEach(control=>{
      if(control.querySelector('.menu-icon-wrap')) return;
      const label=(control.textContent || control.getAttribute('aria-label') || control.title || '').trim();
      const iconName=inferMenuIcon(label);
      if(!iconName || !MENU_ICONS[iconName]) return;
      const wrap=document.createElement('span');
      wrap.className='menu-icon-wrap';
      wrap.setAttribute('aria-hidden','true');
      wrap.innerHTML=MENU_ICONS[iconName];
      control.prepend(wrap);
      if(!control.getAttribute('aria-label') && label) control.setAttribute('aria-label',label);
    });

    root.querySelectorAll('.palette-row').forEach(row=>{
      const iconBox=row.querySelector('.p-icon');
      if(!iconBox || iconBox.querySelector('.menu-icon')) return;
      const label=(row.querySelector('.p-label')?.textContent || row.textContent || '').trim();
      const iconName=inferMenuIcon(label);
      if(!iconName || !MENU_ICONS[iconName]) return;
      iconBox.innerHTML=MENU_ICONS[iconName];
      iconBox.setAttribute('aria-hidden','true');
      if(!row.getAttribute('aria-label') && label) row.setAttribute('aria-label',label);
    });
  }

  const menuDecorationObserver=new MutationObserver(records=>{
    records.forEach(record=>{
      record.addedNodes.forEach(node=>{
        if(!(node instanceof Element)) return;
        decorateMenuIcons(node.matches?.('.ctx-row,.dropdown-row,.palette-row') ? node.parentElement || node : node);
      });
    });
  });


  const UTILITY_ICONS = Object.freeze({
    home:'<svg class="utility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/></svg>',
    workflow:'<svg class="utility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M4 7h12"/><path d="m13 4 3 3-3 3"/><path d="M20 17H8"/><path d="m11 14-3 3 3 3"/></svg>',
    keyboard:'<svg class="utility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 9h.01M11 9h.01M15 9h.01M7 13h10"/></svg>',
    spaces:'<svg class="utility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>',
    storage:'<svg class="utility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></svg>',
    settings:'<svg class="utility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></svg>',
    note:'<svg class="utility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M5 3h14a2 2 0 0 1 2 2v11l-5 5H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M16 21v-5h5"/><path d="M7 8h10M7 12h7"/></svg>',
    warning:'<svg class="utility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M12 3 2.8 19h18.4L12 3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    plus:'<svg class="utility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    toggle:'<svg class="utility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="9" cy="12" r="3"/></svg>',
    reset:'<svg class="utility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M4 4v6h6"/><path d="M5.5 15a7 7 0 1 0 .5-7.5L4 10"/></svg>',
    preview:CARD_ICONS.preview,
    trash:CARD_ICONS.trash,
    palette:MENU_ICONS.search,
    download:MENU_ICONS.download,
    upload:MENU_ICONS.upload,
    search:MENU_ICONS.search
  });

  function utilityIconMarkup(name){ return UTILITY_ICONS[name] || ''; }

  function inferHelpUtilityIcon(control){
    const action=control.dataset.helpAction || '';
    const id=control.id || '';
    const text=(control.textContent || control.title || '').trim().toLowerCase();
    if(action==='palette') return 'palette';
    if(action==='storage') return 'storage';
    if(action==='new-space') return 'plus';
    if(id==='helpAutosaveBtn' || id==='helpPasteBtn') return 'toggle';
    if(id==='helpExportSettingsBtn') return 'download';
    if(id==='helpImportSettingsBtn') return 'upload';
    if(id==='helpResetSettingsBtn') return 'reset';
    if(id==='helpNoteAddBtn') return 'note';
    if(/sortierung suchen/.test(text)) return 'search';
    return '';
  }

  function decorateHelpUtilities(root=document){
    root.querySelectorAll('.help-action').forEach(control=>{
      const iconName=inferHelpUtilityIcon(control);
      if(!iconName) return;
      control.querySelector(':scope > svg')?.remove();
      if(!control.querySelector('.utility-icon')) control.insertAdjacentHTML('afterbegin',utilityIconMarkup(iconName));
      if(!control.getAttribute('aria-label')){
        const label=(control.textContent || '').trim();
        if(label) control.setAttribute('aria-label',label);
      }
      if(control.id==='helpResetSettingsBtn') control.classList.add('danger');
    });

    const navMap={start:'home',workflow:'workflow',shortcuts:'keyboard',spaces:'spaces',storage:'storage',settings:'settings',notes:'note',privacy:'warning'};
    root.querySelectorAll('.help-nav-btn[data-help-panel]').forEach(button=>{
      const box=button.querySelector('.help-nav-icon');
      const iconName=navMap[button.dataset.helpPanel];
      if(!box || !iconName) return;
      box.innerHTML=utilityIconMarkup(iconName);
      box.setAttribute('aria-hidden','true');
      if(!button.getAttribute('aria-label')){
        const label=(button.textContent || '').trim();
        if(label) button.setAttribute('aria-label',label);
      }
    });
  }

  function createCardActionButton(className, label, iconName, action){
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = CARD_ICONS[iconName] || '';
    button.dataset.cardAction = action;
    return button;
  }

  function toggleFavorite(item, ctx){
    const located = locateItem(item.id);
    mutationCheckpoint('content', located?.space?.id || currentSpaceId);
    item.favorite = !item.favorite;
    if(!item.favorite) delete item.favorite;
    persistState();
    if(ctx?.insideFolder) renderFolderGrid(); else render();
    if(favoritesOverlay.classList.contains('show')) openFavorites();
    showToast(item.favorite ? 'Zu Favoriten hinzugefügt' : 'Aus Favoriten entfernt');
  }

  function collectFavorites(){
    const result=[];
    for(const sp of state.spaces || []){
      const d=state.data?.[sp.id];
      if(!d) continue;
      const nestedIn=new Map();
      for(const candidate of Object.values(d.items || {})){
        if(candidate?.type==='folder') for(const childId of candidate.itemIds || []) nestedIn.set(childId,candidate);
      }
      for(const item of Object.values(d.items || {})){
        if(!item?.favorite) continue;
        const folder=nestedIn.get(item.id) || null;
        result.push({item, space:sp, folder, timestamp:Number(item.timestamp)||0});
      }
    }
    return result.sort((a,b)=>b.timestamp-a.timestamp || displayName(a.item).localeCompare(displayName(b.item),'de',{sensitivity:'base'}));
  }

  function updateFavoritesHeaderShortcut(){
    if(!favoritesHeaderBtn) return;
    const count = collectFavorites().length;
    favoritesHeaderBtn.hidden = count === 0;
    favoritesHeaderBtn.classList.toggle('has-favorites', count > 0);
    favoritesHeaderBtn.title = count === 1 ? '1 Favorit öffnen' : `${count} Favoriten öffnen`;
  }
  favoritesHeaderBtn?.addEventListener('click', openFavorites);

  const RECENT_ACTION_LABELS = {open:'Geöffnet', copy:'Kopiert', edit:'Bearbeitet'};
  function locateItem(itemId, preferredSpaceId){
    const ordered = preferredSpaceId ? [preferredSpaceId, ...state.spaces.map(s=>s.id).filter(id=>id!==preferredSpaceId)] : state.spaces.map(s=>s.id);
    for(const spaceId of ordered){
      const d=state.data?.[spaceId]; const item=d?.items?.[itemId];
      if(!item) continue;
      let folder=null;
      for(const candidate of Object.values(d.items||{})){
        if(candidate?.type==='folder' && (candidate.itemIds||[]).includes(itemId)){ folder=candidate; break; }
      }
      return {item, space:state.spaces.find(s=>s.id===spaceId), folder};
    }
    return null;
  }
  function cleanRecentItems(){
    if(!Array.isArray(state.recentItems)) state.recentItems=[];
    state.recentItems=state.recentItems.filter(entry=>entry?.itemId && locateItem(entry.itemId,entry.spaceId)).slice(0,getSetting('history.recentLimit'));
    return state.recentItems;
  }
  function markRecent(item, action='open'){
    if(!item?.id) return;
    if(!Array.isArray(state.recentItems)) state.recentItems=[];
    let folderId=null;
    const d=state.data?.[currentSpaceId];
    if(d){ for(const candidate of Object.values(d.items||{})){ if(candidate?.type==='folder' && (candidate.itemIds||[]).includes(item.id)){ folderId=candidate.id; break; } } }
    state.recentItems=state.recentItems.filter(entry=>entry.itemId!==item.id);
    state.recentItems.unshift({itemId:item.id,spaceId:currentSpaceId,folderId,action,usedAt:Date.now()});
    state.recentItems=state.recentItems.slice(0,getSetting('history.recentLimit'));
    persistState(); updateRecentHeaderShortcut();
    if(recentOverlay?.classList.contains('show')) renderRecentItems();
  }
  function getRecentEntries(){
    cleanRecentItems();
    return state.recentItems.map(entry=>{ const found=locateItem(entry.itemId,entry.spaceId); return found ? {...found,...entry} : null; }).filter(Boolean);
  }
  function updateRecentHeaderShortcut(){
    if(!recentHeaderBtn) return;
    const count=getRecentEntries().length;
    recentHeaderBtn.hidden=count===0; recentHeaderBtn.classList.toggle('has-recent',count>0);
    recentHeaderBtn.title=count===1?'1 zuletzt verwendeter Inhalt':`${count} zuletzt verwendete Inhalte`;
  }
  function relativeRecentTime(ts){
    const diff=Math.max(0,Date.now()-(Number(ts)||0));
    if(diff<60000) return 'gerade eben';
    if(diff<3600000) return `vor ${Math.floor(diff/60000)} Min.`;
    if(diff<86400000) return `vor ${Math.floor(diff/3600000)} Std.`;
    return new Date(ts).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});
  }
  function openRecentEntry(entry){
    recentOverlay.classList.remove('show');
    switchSpace(entry.space.id);
    setTimeout(()=>{
      if(entry.folder){
        openFolder(entry.folder);
        setTimeout(()=>{ const target=folderGrid.querySelector(`[data-id="${entry.item.id}"]`); if(target){ target.scrollIntoView({block:'center'}); target.animate([{outline:'3px solid var(--accent)',outlineOffset:'3px'},{outline:'0 solid transparent',outlineOffset:'0'}],{duration:900,easing:'ease-out'}); } },80);
      } else if(entry.item.locked){ previewLockedItem(entry.item); }
      else { entry.item.type==='folder' ? openFolder(entry.item) : openPreview(entry.item); }
    },60);
  }
  function renderRecentItems(){
    const entries=getRecentEntries(); recentList.innerHTML='';
    if(!entries.length){ const empty=document.createElement('div'); empty.className='recent-empty'; empty.textContent='Noch keine Aktivität. Öffne, kopiere oder bearbeite eine Karte.'; recentList.appendChild(empty); return; }
    entries.forEach(entry=>{
      const row=document.createElement('div'); row.className='recent-row';
      const icon=document.createElement('div'); icon.className='recent-row-icon'; icon.innerHTML=entry.item.type==='folder'?ICONS.folderOpen:ICONS.preview;
      const main=document.createElement('div'); main.className='recent-row-main';
      const name=document.createElement('span'); name.className='recent-row-name'; name.textContent=displayName(entry.item);
      const meta=document.createElement('span'); meta.className='recent-row-meta'; meta.textContent=`${RECENT_ACTION_LABELS[entry.action]||'Verwendet'} · ${entry.folder?entry.space.name+' · '+displayName(entry.folder):entry.space.name}`;
      const time=document.createElement('span'); time.className='recent-row-time'; time.textContent=relativeRecentTime(entry.usedAt);
      main.append(name,meta); row.append(icon,main,time); row.addEventListener('click',()=>openRecentEntry(entry)); recentList.appendChild(row);
    });
  }
  function openRecentItems(){ renderRecentItems(); recentOverlay.classList.add('show'); }
  recentHeaderBtn?.addEventListener('click',openRecentItems);
  recentCloseBtn?.addEventListener('click',()=>recentOverlay.classList.remove('show'));
  recentOverlay?.addEventListener('click',e=>{ if(e.target===recentOverlay) recentOverlay.classList.remove('show'); });

  function renderHelpNotes(){
    if(!helpNotesGrid) return;
    if(!Array.isArray(state.helpNotes)) state.helpNotes=[];
    helpNotesGrid.innerHTML='';
    if(!state.helpNotes.length){
      const empty=document.createElement('div'); empty.className='sticky-empty';
      empty.textContent='Noch keine Sticky Note. Lege hier kleine Erinnerungen oder Ideen ab.';
      helpNotesGrid.appendChild(empty); return;
    }
    [...state.helpNotes].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).forEach(note=>{
      const card=document.createElement('article'); card.className='sticky-note';
      const p=document.createElement('p'); p.textContent=note.text;
      const del=document.createElement('button'); del.type='button'; del.title='Notiz löschen'; del.textContent='×';
      del.addEventListener('click',()=>{
        mutationCheckpoint('notes');
        state.helpNotes=state.helpNotes.filter(n=>n.id!==note.id);
        persistState(); renderHelpNotes();
      });
      card.append(p,del); helpNotesGrid.appendChild(card);
    });
  }
  function addHelpNote(){
    const value=helpNoteInput?.value.trim();
    if(!value) return;
    if(!Array.isArray(state.helpNotes)) state.helpNotes=[];
    mutationCheckpoint('notes');
    state.helpNotes.push({id:'note_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), text:value, createdAt:Date.now()});
    helpNoteInput.value=''; persistState(); renderHelpNotes();
    showToast('Sticky Note gespeichert');
  }
  helpNoteAddBtn?.addEventListener('click', addHelpNote);
  helpNoteInput?.addEventListener('keydown', e=>{ if((e.metaKey||e.ctrlKey) && e.key==='Enter'){ e.preventDefault(); addHelpNote(); } });

  function openFavoriteEntry(entry){
    favoritesOverlay.classList.remove('show');
    switchSpace(entry.space.id);
    setTimeout(()=>{
      if(entry.folder){
        openFolder(entry.folder);
        setTimeout(()=>{
          const target=folderGrid.querySelector(`[data-id="${entry.item.id}"]`);
          if(target){ target.scrollIntoView({block:'center'}); target.animate([{outline:'3px solid var(--accent)',outlineOffset:'3px'},{outline:'0 solid transparent',outlineOffset:'0'}],{duration:900,easing:'ease-out'}); }
        },80);
      } else if(entry.item.locked){
        previewLockedItem(entry.item);
      } else {
        entry.item.type==='folder' ? openFolder(entry.item) : openPreview(entry.item);
      }
    },60);
  }

  function openFavorites(){
    const entries=collectFavorites();
    favoritesList.innerHTML='';
    if(!entries.length){
      const empty=document.createElement('div'); empty.className='favorites-empty';
      empty.textContent='Noch keine Favoriten. Markiere eine Karte über ihr Kontextmenü mit einem Stern.';
      favoritesList.appendChild(empty);
    }
    entries.forEach(entry=>{
      const row=document.createElement('div'); row.className='favorite-row';
      const icon=document.createElement('div'); icon.className='favorite-row-icon';
      icon.innerHTML=entry.item.type==='folder' ? ICONS.folderOpen : ICONS.star;
      const main=document.createElement('div'); main.className='favorite-row-main';
      const name=document.createElement('span'); name.className='favorite-row-name'; name.textContent=displayName(entry.item);
      const meta=document.createElement('span'); meta.className='favorite-row-meta'; meta.textContent=entry.folder ? `${entry.space.name} · ${displayName(entry.folder)}` : entry.space.name;
      main.append(name,meta);
      const actions=document.createElement('div'); actions.className='favorite-row-actions';
      const open=document.createElement('button'); open.type='button'; open.title='Öffnen'; open.innerHTML=ICONS.preview; open.addEventListener('click',()=>openFavoriteEntry(entry));
      const remove=document.createElement('button'); remove.type='button'; remove.className='unfavorite'; remove.title='Aus Favoriten entfernen'; remove.innerHTML=ICONS.star; remove.addEventListener('click',()=>toggleFavorite(entry.item,{insideFolder:!!entry.folder,folderId:entry.folder?.id}));
      actions.append(open,remove); row.append(icon,main,actions);
      row.addEventListener('dblclick',()=>openFavoriteEntry(entry));
      favoritesList.appendChild(row);
    });
    favoritesOverlay.classList.add('show');
  }
  favoritesCloseBtn.addEventListener('click',()=>favoritesOverlay.classList.remove('show'));
  favoritesOverlay.addEventListener('click',e=>{ if(e.target===favoritesOverlay) favoritesOverlay.classList.remove('show'); });

  let inspectorItemId = null;
  function inspectorTypeLabel(item){
    if(item.type==='folder') return 'Ordner';
    if(item.type==='text') return 'Textkarte';
    if(item.type==='image') return 'Bild';
    if(item.mime?.startsWith('audio/')) return 'Audio';
    return 'Datei';
  }
  function inspectorItemIcon(item){
    if(item.type==='folder') return ICONS.folderOpen;
    if(item.type==='text') return ICONS.edit;
    if(item.type==='image') return ICONS.preview;
    if(item.mime?.startsWith('audio/')) return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>';
    return ICONS.download;
  }
  function inspectorFolderSize(folder, spaceId){
    const d=state.data?.[spaceId];
    return (folder.itemIds||[]).reduce((sum,id)=>sum+(Number(d?.items?.[id]?.size)||0),0);
  }
  function inspectorDate(ts){
    if(!Number(ts)) return 'Nicht verfügbar';
    return new Date(Number(ts)).toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'});
  }
  function addInspectorField(label,value,wide=false,idRow=false){
    const field=document.createElement('div'); field.className='inspector-field'+(wide?' wide':'');
    const lab=document.createElement('span'); lab.className='inspector-label'; lab.textContent=label; field.appendChild(lab);
    if(idRow){
      const row=document.createElement('div'); row.className='inspector-id-row';
      const val=document.createElement('span'); val.className='inspector-value'; val.textContent=String(value||'—');
      const btn=document.createElement('button'); btn.type='button'; btn.className='inspector-copy-id'; btn.title='ID kopieren'; btn.innerHTML=ICONS.copy;
      btn.addEventListener('click',async()=>{ try{ await navigator.clipboard.writeText(String(value||'')); showToast('ID kopiert'); }catch(e){ showToast('ID konnte nicht kopiert werden'); } });
      row.append(val,btn); field.appendChild(row);
    }else{
      const val=document.createElement('span'); val.className='inspector-value'; val.textContent=String(value ?? '—'); field.appendChild(val);
    }
    inspectorGrid.appendChild(field);
  }
  function closeInspector(){ inspectorOverlay.classList.remove('show'); inspectorItemId=null; inspectorGrid.innerHTML=''; inspectorStatuses.innerHTML=''; }
  function openInspector(item){
    const found=locateItem(item.id,currentSpaceId);
    if(!found) return showToast('Inhalt nicht mehr verfügbar');
    inspectorItemId=item.id;
    inspectorIcon.innerHTML=inspectorItemIcon(item);
    inspectorTitle.textContent=displayName(item);
    inspectorStatuses.innerHTML=''; inspectorGrid.innerHTML='';
    const statuses=[];
    if(item.favorite) statuses.push(['Favorit','accent']);
    if(item.pinned) statuses.push(['Angeheftet','accent']);
    if(item.locked) statuses.push(['PIN-geschützt','']);
    if(item.customName) statuses.push(['Eigener Name','']);
    if(item.type==='folder') statuses.push([`${(item.itemIds||[]).length} Elemente`, '']);
    if(!statuses.length) statuses.push(['Standard','']);
    statuses.forEach(([label,cls])=>{ const chip=document.createElement('span'); chip.className='inspector-chip'+(cls?' '+cls:''); chip.textContent=label; inspectorStatuses.appendChild(chip); });
    const size=item.type==='folder' ? inspectorFolderSize(item,found.space.id) : Number(item.size)||0;
    addInspectorField('Typ',inspectorTypeLabel(item));
    addInspectorField('Größe',fmtSize(size));
    addInspectorField('Space',found.space?.name||'—');
    addInspectorField('Ordner',found.folder ? displayName(found.folder) : 'Kein Ordner');
    addInspectorField('Erstellt',inspectorDate(item.timestamp));
    addInspectorField('Dateiformat',item.type==='folder' ? 'Ordner' : (item.mime || extMeta(item.name||'').label || 'Unbekannt'));
    if(item.name && item.name!==displayName(item)) addInspectorField('Ursprünglicher Name',item.name,true);
    addInspectorField('Interne ID',item.id,true,true);
    inspectorLocateBtn.innerHTML=ICONS.move+' Im Space anzeigen';
    inspectorOpenBtn.innerHTML=(item.type==='folder'?ICONS.folderOpen:ICONS.preview)+(item.type==='folder'?' Ordner öffnen':' Vorschau öffnen');
    inspectorOverlay.classList.add('show');
  }
  inspectorCloseBtn.addEventListener('click',closeInspector);
  inspectorOverlay.addEventListener('click',e=>{ if(e.target===inspectorOverlay) closeInspector(); });
  inspectorLocateBtn.addEventListener('click',()=>{
    const found=inspectorItemId ? locateItem(inspectorItemId) : null; if(!found) return closeInspector();
    closeInspector(); switchSpace(found.space.id);
    setTimeout(()=>{ if(found.folder) openFolder(found.folder); const el=document.querySelector(`[data-id="${found.item.id}"]`); el?.scrollIntoView({behavior:'smooth',block:'center'}); el?.classList.add('search-highlight'); setTimeout(()=>el?.classList.remove('search-highlight'),1300); },80);
  });
  inspectorOpenBtn.addEventListener('click',()=>{
    const found=inspectorItemId ? locateItem(inspectorItemId) : null; if(!found) return closeInspector();
    closeInspector(); switchSpace(found.space.id);
    setTimeout(()=>{ found.item.type==='folder' ? openFolder(found.item) : openPreview(found.item); },60);
  });

  // ---------- unified context menu for cards AND folders ----------
  function buildActionsForItem(item, cardEl, ctx){
    ctx = ctx || {};
    const isFolder = item.type === 'folder';

    if(item.locked){
      return [
        {icon:ICONS.unlock, label:'Mit PIN anzeigen', onClick:()=>previewLockedItem(item)},
        {icon:ICONS.unlock, label:'PIN entfernen', onClick:()=>unlockItemPermanently(item, ctx)},
        {sep:true},
        {icon:ICONS.info, label:'Details', onClick:()=>openInspector(item)},
        {icon:ICONS.rename, label:'Umbenennen', onClick:()=>startCardRename(cardEl, item, ctx)},
        {icon:ICONS.star, label:item.favorite?'Aus Favoriten entfernen':'Zu Favoriten hinzufügen', onClick:()=>toggleFavorite(item,ctx)},
        {sep:true},
        {icon:ICONS.trash, label:'Löschen', danger:true, onClick:()=>{
          openDestructiveConfirm('Löschen?', `"${displayName(item)}" wird entfernt.`, 'Löschen', ()=>{
            if(ctx.insideFolder){ deleteItemFromFolder(item.id, ctx.folderId); } else { removeItem(item.id); }
          });
        }}
      ];
    }

    // Ordner behalten bewusst ihre bisherige, direkte Menüstruktur.
    if(isFolder){
      const folderRows=[
        {icon:ICONS.folderOpen,label:'Öffnen',onClick:()=>openFolder(item)},
        {icon:ICONS.copy,label:'Kopieren',onClick:()=>copyFolderSummary(item)},
        {icon:ICONS.duplicate,label:'Duplizieren',onClick:()=>duplicateItem(item,ctx)},
        {icon:ICONS.share,label:'Teilen',onClick:()=>openShareSheet(item)},
        {icon:ICONS.info,label:'Details',onClick:()=>openInspector(item)},
        {sep:true},
        {icon:ICONS.rename,label:'Umbenennen',onClick:()=>startCardRename(cardEl,item,ctx)},
        {icon:ICONS.star,label:item.favorite?'Aus Favoriten entfernen':'Zu Favoriten hinzufügen',onClick:()=>toggleFavorite(item,ctx)}
      ];
      if(item.customName) folderRows.push({icon:ICONS.reset,label:'Namen zurücksetzen',onClick:()=>resetItemName(item,ctx)});
      if(!ctx.insideFolder) folderRows.push({icon:ICONS.pin,label:item.pinned?'Lösen':'Anheften',onClick:()=>togglePin(item)});
      folderRows.push({icon:ICONS.download,label:'Herunterladen',onClick:()=>downloadFolderAsZip(item)});
      if(!ctx.insideFolder) folderRows.push({icon:ICONS.move,label:'In anderen Space verschieben',onClick:()=>openSpaceMoveModal(item)});
      if(ctx.insideFolder) folderRows.push({icon:ICONS.unlink,label:'Aus Ordner entfernen',onClick:()=>removeFromFolder(item.id,ctx.folderId)});
      folderRows.push({sep:true},{icon:ICONS.trash,label:'Ordner löschen (mit Inhalt)',danger:true,onClick:()=>{
        openDestructiveConfirm('Löschen?', `"${displayName(item)}" und alle ${item.itemIds.length} enthaltenen Elemente werden dauerhaft gelöscht.`, 'Löschen', ()=>deleteFolder(item.id));
      }});
      return folderRows;
    }

    const moreActions=[
      {icon:ICONS.duplicate,label:'Duplizieren',onClick:()=>duplicateItem(item,ctx)},
      {icon:ICONS.share,label:'Teilen',onClick:()=>openShareSheet(item)},
      {icon:ICONS.download,label:'Herunterladen',onClick:()=>downloadItem(item)}
    ];
    if(!ctx.insideFolder) moreActions.push({icon:ICONS.move,label:'In anderen Space verschieben',onClick:()=>openSpaceMoveModal(item)});
    if(ctx.insideFolder) moreActions.push({icon:ICONS.unlink,label:'Aus Ordner entfernen',onClick:()=>removeFromFolder(item.id,ctx.folderId)});
    if(item.type==='image'){
      moreActions.push({sep:true});
      moreActions.push({icon:ICONS.palette,label:'Farbpalette extrahieren',onClick:()=>openPaletteExtract(item)});
      moreActions.push({icon:ICONS.ocr,label:'Text erkennen (OCR)',onClick:()=>runOcr(item)});
    }
    if(item.type==='text'){
      moreActions.push({sep:true});
      moreActions.push({icon:ICONS.fire,label:'Burn-after-reading-Link',onClick:()=>createBurnLink(item)});
    }
    moreActions.push({sep:true});
    moreActions.push({icon:ICONS.lock,label:'Mit PIN schützen',onClick:()=>lockItemWithPin(item,ctx)});

    const rows=[
      {icon:ICONS.preview,label:'Vorschau',onClick:()=>openPreview(item)},
      {icon:ICONS.info,label:'Details',onClick:()=>openInspector(item)},
      {icon:ICONS.copy,label:'Kopieren',onClick:()=>copyItem(item)},
      {icon:ICONS.edit,label:'Inhalt bearbeiten',onClick:()=>openEditContent(item,ctx)},
      {icon:ICONS.rename,label:'Umbenennen',onClick:()=>startCardRename(cardEl,item,ctx)},
      {icon:ICONS.star,label:item.favorite?'Aus Favoriten entfernen':'Zu Favoriten hinzufügen',onClick:()=>toggleFavorite(item,ctx)}
    ];
    if(item.customName) rows.push({icon:ICONS.reset,label:'Namen zurücksetzen',onClick:()=>resetItemName(item,ctx)});
    if(!ctx.insideFolder) rows.push({icon:ICONS.pin,label:item.pinned?'Lösen':'Anheften',onClick:()=>togglePin(item)});
    rows.push({sep:true});
    rows.push({icon:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></svg>',label:'Weitere Aktionen',submenu:moreActions});
    rows.push({sep:true});
    rows.push({icon:ICONS.trash,label:'Löschen',danger:true,onClick:()=>{
      openDestructiveConfirm('Löschen?', `"${displayName(item)}" wird entfernt.`, 'Löschen', ()=>{
        if(ctx.insideFolder){ deleteItemFromFolder(item.id,ctx.folderId); } else { removeItem(item.id); }
      });
    }});
    return rows;
  }

  function duplicateItem(item, ctx, options={}){
    ctx = ctx || {};
    if(!options.skipHistory) mutationCheckpoint('content', currentSpaceId);
    const data = dataOf(currentSpaceId);
    const newId = uid();
    if(item.type === 'folder'){
      const newNestedIds = [];
      for(const nid of item.itemIds){
        const nested = data.items[nid];
        if(nested){ const clone = {...nested, id:uid()}; data.items[clone.id] = clone; newNestedIds.push(clone.id); }
      }
      data.items[newId] = {...item, id:newId, itemIds:newNestedIds};
    } else {
      data.items[newId] = {...item, id:newId};
    }
    if(ctx.insideFolder){
      const folder = data.items[ctx.folderId];
      if(folder){ const idx = folder.itemIds.indexOf(item.id); folder.itemIds.splice(idx>-1?idx+1:folder.itemIds.length, 0, newId); }
      renderFolderGrid();
    } else {
      const idx = data.itemIds.indexOf(item.id);
      data.itemIds.splice(idx>-1?idx+1:data.itemIds.length, 0, newId);
      refreshItems();
      flipRenderGrid();
    }
    if(!options.skipPersist) persistState();
    if(!options.silent) showToast('Dupliziert');
  }

  function createSpaceQuiet(options={}){
    const id = uid(), name = 'Space ' + (spaces.length + 1);
    spaces.push({id, name, sortMode:defaultSortModeSetting()});
    state.spaces = spaces;
    dataOf(id);
    if(!options.skipPersist) persistState();
    renderTabs();
    return id;
  }
  function renderSpacePickerRows(listEl, onPick){
    listEl.innerHTML = '';
    spaces.filter(s=>s.id!==currentSpaceId).forEach(s=>{
      const row = document.createElement('div');
      row.className = 'space-move-row';
      row.textContent = s.name;
      row.addEventListener('click', ()=>onPick(s.id));
      listEl.appendChild(row);
    });
    const newRow = document.createElement('div');
    newRow.className = 'space-move-row new-space';
    newRow.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Neuer Space';
    newRow.addEventListener('click', ()=> onPick(null, {createNew:true}));
    listEl.appendChild(newRow);
  }
  function openSpaceMoveModal(item){
    renderSpacePickerRows(spaceMoveList, (targetId, meta={})=>{
      spaceMoveOverlay.classList.remove('show');
      mutationCheckpoint('crossSpace');
      if(meta.createNew) targetId = createSpaceQuiet({skipPersist:true});
      moveItemToSpace(item, targetId, {skipHistory:true, skipPersist:true});
      persistState();
      flipRenderGrid();
    });
    spaceMoveOverlay.classList.add('show');
  }
  spaceMoveCancelBtn.addEventListener('click', ()=>spaceMoveOverlay.classList.remove('show'));
  spaceMoveOverlay.addEventListener('click', (e)=>{ if(e.target===spaceMoveOverlay) spaceMoveOverlay.classList.remove('show'); });

  function openSpacePicker(item){
    const others = spaces.filter(s=>s.id!==currentSpaceId);
    if(!others.length){ showToast('Es gibt noch keinen weiteren Space'); return; }
    const rows = others.map(s=>({ label:s.name, icon:'', onClick:()=>copyItemToSpace(item, s.id) }));
    showContextMenu(lastCtxPos.x, lastCtxPos.y, rows);
  }
  function copyItemToSpace(item, targetSpaceId){
    mutationCheckpoint('crossSpace');
    const sourceData = dataOf(currentSpaceId);
    const targetData = dataOf(targetSpaceId);
    const newId = uid();
    if(item.type === 'folder'){
      const newNestedIds = [];
      for(const nid of item.itemIds){
        const nested = sourceData.items[nid];
        if(nested){ const clone = {...nested, id:uid()}; targetData.items[clone.id] = clone; newNestedIds.push(clone.id); }
      }
      targetData.items[newId] = {...item, id:newId, itemIds:newNestedIds};
    } else {
      targetData.items[newId] = {...item, id:newId};
    }
    targetData.itemIds.unshift(newId);
    persistState();
    const targetSpace = spaces.find(s=>s.id===targetSpaceId);
    showToast(`Nach "${targetSpace ? targetSpace.name : 'Space'}" kopiert`);
  }
  function moveItemToSpace(item, targetSpaceId, options={}){
    if(!options.skipHistory) mutationCheckpoint('crossSpace');
    const sourceData = dataOf(currentSpaceId);
    const targetData = dataOf(targetSpaceId);
    sourceData.itemIds = sourceData.itemIds.filter(id=>id!==item.id);
    delete sourceData.items[item.id];
    targetData.items[item.id] = item;
    if(item.type === 'folder'){
      for(const nid of item.itemIds){
        const nested = sourceData.items[nid];
        if(nested){ targetData.items[nid] = nested; delete sourceData.items[nid]; }
      }
    }
    targetData.itemIds.unshift(item.id);
    refreshItems();
    if(!options.skipPersist) persistState();
    const targetSpace = spaces.find(s=>s.id===targetSpaceId);
    if(!options.silent) showToast(`Nach "${targetSpace ? targetSpace.name : 'Space'}" verschoben`);
  }

  function copyFolderSummary(folder){
    const data = dataOf(currentSpaceId);
    const names = folder.itemIds.map(id=> data.items[id] ? displayName(data.items[id]) : null).filter(Boolean);
    if(!names.length){ showToast('Ordner ist leer'); return; }
    navigator.clipboard.writeText(names.join('\n')).then(()=>showToast('Dateiliste kopiert')).catch(()=>showToast('Kopieren fehlgeschlagen'));
  }
  async function buildFolderZipBlob(folder){
    if(typeof JSZip === 'undefined') return null;
    const data = dataOf(currentSpaceId);
    const zip = new JSZip();
    const used = new Set();
    let count = 0;
    for(const id of folder.itemIds){
      const it = data.items[id];
      if(!it || it.type==='folder') continue;
      const filename = exportFilename(it, used);
      if(it.type === 'text'){ zip.file(filename, it.data); }
      else { const base64 = (it.data.split(',')[1]) || ''; zip.file(filename, base64, {base64:true}); }
      count++;
    }
    if(!count) return null;
    return await zip.generateAsync({type:'blob'});
  }
  async function downloadFolderAsZip(folder){
    if(typeof JSZip === 'undefined'){ showToast('ZIP-Funktion nicht verfügbar (kein Internet?)'); return; }
    showToast('ZIP wird erstellt…');
    const blob = await buildFolderZipBlob(folder);
    if(!blob){ showToast('Ordner ist leer'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = sanitizeFilename(displayName(folder)) + '.zip'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  }

  // ---------- share ----------
  function closeShare(){ shareOverlay.classList.remove('show'); }
  shareCancelBtn.addEventListener('click', closeShare);
  shareOverlay.addEventListener('click', (e)=>{ if(e.target===shareOverlay) closeShare(); });

  async function itemToShareFile(item){
    if(item.type === 'text') return null; // handled as text, not a file
    const blob = await (await fetch(item.data)).blob();
    return new File([blob], displayName(item), {type: blob.type || item.mime || 'application/octet-stream'});
  }
  async function nativeShare(item){
    closeShare();
    try{
      if(item.type === 'folder'){
        showToast('ZIP wird für die Freigabe erstellt…');
        const blob = await buildFolderZipBlob(item);
        if(!blob){ showToast('Ordner ist leer'); return; }
        const file = new File([blob], sanitizeFilename(displayName(item))+'.zip', {type:'application/zip'});
        if(navigator.canShare && navigator.canShare({files:[file]})){ await navigator.share({files:[file], title: displayName(item)}); }
        else { showToast('Teilen von ZIPs wird hier nicht unterstützt — nutze Herunterladen'); }
        return;
      }
      if(item.type === 'text'){ await navigator.share({text: item.data, title: displayName(item)}); return; }
      const file = await itemToShareFile(item);
      if(file && navigator.canShare && navigator.canShare({files:[file]})){ await navigator.share({files:[file], title: displayName(item)}); }
      else { await navigator.share({title: displayName(item)}); }
    }catch(e){
      if(e && e.name === 'AbortError') return;
      showToast('Teilen fehlgeschlagen');
    }
  }
  function openShareSheet(item){
    const isFolder = item.type === 'folder';
    shareOptions.innerHTML = '';
    const rows = [];
    if(navigator.share){
      rows.push({ label:'Über das Gerät teilen', icon:ICONS.move, onClick:()=>nativeShare(item) });
    }
    if(!isFolder){
      rows.push({ label:'Kopieren', icon:ICONS.copy, onClick:()=>{ closeShare(); copyItem(item); } });
    } else {
      rows.push({ label:'Dateiliste kopieren', icon:ICONS.copy, onClick:()=>{ closeShare(); copyFolderSummary(item); } });
    }
    rows.push({ label: isFolder ? 'Als ZIP herunterladen' : 'Herunterladen', icon:ICONS.download, onClick:()=>{ closeShare(); isFolder ? downloadFolderAsZip(item) : downloadItem(item); } });
    rows.push({ label:'In anderen Space kopieren', icon:ICONS.plus, onClick:()=>{ closeShare(); openSpacePicker(item); } });
    rows.forEach(r=>{
      const row = document.createElement('div');
      row.className = 'share-row';
      row.innerHTML = `<span class="share-icon">${r.icon}</span><span>${r.label}</span>`;
      row.addEventListener('click', r.onClick);
      shareOptions.appendChild(row);
    });
    shareOverlay.classList.add('show');
  }

  let renameContext = null;
  function startCardRename(cardEl, item, ctx){
    if(cardEl){
      renameContext = {item, ctx};
      renameInput.value = displayName(item);
      renameOverlay.classList.add('show');
      setTimeout(()=>{ renameInput.focus(); renameInput.select(); }, 50);
    } else {
      folderTitleInput.value = displayName(item);
      folderContext = item;
      folderOverlay.classList.add('show');
      setTimeout(()=>{ folderTitleInput.focus(); folderTitleInput.select(); }, 50);
    }
  }
  function commitRename(){
    if(!renameContext) return;
    const {item, ctx} = renameContext;
    const val = renameInput.value.trim();
    const nextCustomName = (val && val !== item.name) ? val : undefined;
    if((item.customName || undefined) === nextCustomName){
      renameOverlay.classList.remove('show');
      renameContext = null;
      return;
    }
    mutationCheckpoint('content', currentSpaceId);
    item.customName = nextCustomName;
    if(!item.customName) delete item.customName;
    markRecent(item,'edit');
    if(ctx && ctx.insideFolder){ renderFolderGrid(); } else { render(); }
    renameOverlay.classList.remove('show');
    renameContext = null;
  }
  renameOkBtn.addEventListener('click', commitRename);
  renameCancelBtn.addEventListener('click', ()=>{ renameOverlay.classList.remove('show'); renameContext=null; });
  renameInput.addEventListener('keydown', e=>{ if(e.key==='Enter') commitRename(); });
  renameOverlay.addEventListener('click', (e)=>{ if(e.target===renameOverlay){ renameOverlay.classList.remove('show'); renameContext=null; } });
  function switchHelpPanel(panel){
    document.querySelectorAll('[data-help-panel]').forEach(btn=>btn.classList.toggle('active', btn.dataset.helpPanel===panel));
    document.querySelectorAll('[data-help-content]').forEach(section=>section.classList.toggle('active', section.dataset.helpContent===panel));
    document.querySelector('.help-content')?.scrollTo({top:0,behavior:'smooth'});
    if(panel==='notes') renderHelpNotes();
  }
  function syncHelpSettings(){
    if(helpAutosaveStatus) helpAutosaveStatus.textContent = memoryProtectionOn ? 'Aktiv – Änderungen werden dauerhaft lokal gespeichert.' : 'Temporär – Änderungen dieser Sitzung werden nicht gespeichert.';
    if(helpPasteStatus) helpPasteStatus.textContent = pasteCaptureOn ? 'Aktiv – bewusstes ⌘/Strg+V wird direkt abgelegt.' : 'Aus – globale Paste-Ereignisse werden nicht übernommen.';
    helpAutosaveBtn?.classList.toggle('active', memoryProtectionOn);
    helpPasteBtn?.classList.toggle('active', pasteCaptureOn);
    if(helpViewModeSelect) helpViewModeSelect.value = getSetting('appearance.viewMode');
    if(helpDefaultSortSelect) helpDefaultSortSelect.value = getSetting('behavior.defaultSortMode');
    if(helpRecentLimitSelect) helpRecentLimitSelect.value = String(getSetting('history.recentLimit'));
    if(helpAtmosphereSelect) helpAtmosphereSelect.value = getSetting('appearance.spaceAtmosphere');
    if(helpStartSpaceSelect) helpStartSpaceSelect.value = getSetting('behavior.startSpace');
    if(helpConfirmDeleteSelect) helpConfirmDeleteSelect.value = getSetting('behavior.confirmDestructiveActions') ? 'on' : 'off';
  }
  function openHelp(panel='start'){
    switchHelpPanel(panel);
    syncHelpSettings();
    decorateHelpUtilities(helpOverlay);
    helpOverlay.classList.add('show');
  }
  helpToggle.addEventListener('click', ()=> openHelp('start'));
  helpCloseBtn.addEventListener('click', ()=> helpOverlay.classList.remove('show'));
  helpOverlay.addEventListener('click', (e)=>{ if(e.target===helpOverlay) helpOverlay.classList.remove('show'); });
  helpNav.addEventListener('click', e=>{ const btn=e.target.closest('[data-help-panel]'); if(btn) switchHelpPanel(btn.dataset.helpPanel); });
  helpOverlay.addEventListener('click', e=>{
    const action=e.target.closest('[data-help-action]');
    if(!action) return;
    const type=action.dataset.helpAction;
    if(type==='storage'){ openStorageStatus(); }
    if(type==='palette'){ openPalette(); }
    if(type==='new-space'){ helpOverlay.classList.remove('show'); addSpace(); }
  });
  helpAutosaveBtn.addEventListener('click', ()=>{ memoryToggle.click(); syncHelpSettings(); });
  helpPasteBtn.addEventListener('click', ()=>{ setPasteCapture(!pasteCaptureOn); syncHelpSettings(); });
  helpViewModeSelect?.addEventListener('change', ()=>{
    setViewMode(helpViewModeSelect.value);
    syncHelpSettings();
  });
  helpDefaultSortSelect?.addEventListener('change', ()=>{
    setSetting('behavior.defaultSortMode', helpDefaultSortSelect.value);
    syncHelpSettings();
    showToast('Standardsortierung gespeichert');
  });
  helpRecentLimitSelect?.addEventListener('change', ()=>{
    const limit = setSetting('history.recentLimit', Number(helpRecentLimitSelect.value), {persist:false});
    state.recentItems = (state.recentItems || []).slice(0, limit);
    persistState();
    updateRecentAccess();
    syncHelpSettings();
    showToast(`Verlauf auf ${limit} Einträge begrenzt`);
  });
  helpAtmosphereSelect?.addEventListener('change', ()=>{
    setSetting('appearance.spaceAtmosphere', helpAtmosphereSelect.value);
    applySpaceAtmosphere(currentSpace());
    syncHelpSettings();
  });
  helpStartSpaceSelect?.addEventListener('change', ()=>{
    setSetting('behavior.startSpace', helpStartSpaceSelect.value);
    syncHelpSettings();
    showToast(helpStartSpaceSelect.value === 'first' ? 'Startet künftig im ersten Space' : 'Startet künftig im zuletzt verwendeten Space');
  });
  helpConfirmDeleteSelect?.addEventListener('change', ()=>{
    setSetting('behavior.confirmDestructiveActions', helpConfirmDeleteSelect.value === 'on');
    syncHelpSettings();
    showToast(helpConfirmDeleteSelect.value === 'on' ? 'Löschbestätigungen aktiviert' : 'Löschbestätigungen deaktiviert');
  });
  helpExportSettingsBtn?.addEventListener('click', exportBoardSettings);
  helpImportSettingsBtn?.addEventListener('click', ()=>settingsImportInput?.click());
  helpResetSettingsBtn?.addEventListener('click', resetBoardSettings);
  settingsImportInput?.addEventListener('change', ()=>{
    importBoardSettingsFile(settingsImportInput.files?.[0] || null);
  });
  function resetItemName(item, ctx){
    if(!item.customName) return;
    mutationCheckpoint('content', currentSpaceId);
    delete item.customName;
    persistState();
    if(ctx && ctx.insideFolder){ renderFolderGrid(); } else { render(); }
    showToast('Name zurückgesetzt');
  }

  // ---------- card building ----------
  function buildCard(item, ctx){
    ctx = ctx || {};
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = item.id;
    card.dataset.insideFolder = ctx.insideFolder ? '1' : '0';
    if(ctx.folderId) card.dataset.folderId = ctx.folderId;
    const openAction = item.locked ? (()=>previewLockedItem(item)) : (item.type==='folder' ? (()=>openFolder(item)) : (()=>openPreview(item)));

    if(!ctx.insideFolder){
      const handle = document.createElement('div');
      handle.className = 'card-handle'; handle.title='Ziehen zum Verschieben / auf eine Karte für Ordner / auf einen Space oben zum Verschieben';
      handle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="6" r="1.8"/><circle cx="18" cy="6" r="1.8"/><circle cx="6" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/><circle cx="6" cy="18" r="1.8"/><circle cx="18" cy="18" r="1.8"/></svg>';
      handle.addEventListener('pointerdown', (e)=>{ e.stopPropagation(); startCardDrag(e, card, item.id); });
      handle.addEventListener('click', e=>e.stopPropagation());
      card.appendChild(handle);

      const selectBox = document.createElement('div');
      selectBox.className = 'card-select' + (selectedIds.has(item.id) ? ' checked' : '');
      selectBox.title = 'Auswählen (Umschalttaste für Bereich)';
      selectBox.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
      selectBox.dataset.cardAction = 'select';
      card.appendChild(selectBox);

      if(item.type !== 'folder' && !item.locked){
        const dragOut = document.createElement('div');
        dragOut.className = 'card-dragout';
        dragOut.title = 'Auf den Desktop ziehen (nur Chrome/Edge)';
        dragOut.setAttribute('draggable','true');
        dragOut.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 19h16"/></svg>';
        dragOut.dataset.cardAction = 'dragout';
        card.appendChild(dragOut);
      }
      if(item.pinned){
        const pinBadge = document.createElement('div');
        pinBadge.className = 'card-pin'; pinBadge.title = 'Angeheftet';
        pinBadge.innerHTML = CARD_ICONS.pin;
        card.appendChild(pinBadge);
      }
      if(item.favorite){
        const favoriteBadge=document.createElement('div');
        favoriteBadge.className='card-favorite'; favoriteBadge.title='Favorit';
        favoriteBadge.innerHTML=CARD_ICONS.star;
        card.appendChild(favoriteBadge);
      }
    }

    const thumb = document.createElement('div');
    thumb.className = 'thumb';

    if(item.locked){
      const locked = document.createElement('div'); locked.className='locked-thumb';
      locked.innerHTML = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><span>Gesperrt</span>`;
      thumb.appendChild(locked);
    } else if(item.type === 'folder'){
      const wrap = document.createElement('div'); wrap.className='folder-thumb';
      for(let i=0;i<4;i++){ const cell=document.createElement('div'); cell.className='fcell'; wrap.appendChild(cell); }
      thumb.appendChild(wrap);
      const badge = document.createElement('span'); badge.className='folder-count'; badge.textContent = item.itemIds.length;
      thumb.appendChild(badge);
      fillFolderThumb(item, wrap);
    } else if(item.type === 'image'){
      const img = document.createElement('img'); img.src = item.data; img.draggable = false; thumb.appendChild(img);
    } else if(item.type === 'text'){
      const p = document.createElement('div'); p.className='text-preview'; p.textContent = item.data; thumb.appendChild(p);
      const inlineEditBtn=document.createElement('button');
      inlineEditBtn.className='inline-text-edit-trigger';
      inlineEditBtn.title='Text direkt bearbeiten';
      inlineEditBtn.setAttribute('aria-label','Text direkt bearbeiten');
      inlineEditBtn.type='button';
      inlineEditBtn.innerHTML=CARD_ICONS.edit;
      inlineEditBtn.dataset.cardAction='inline-edit';
      thumb.appendChild(inlineEditBtn);
    } else {
      const meta = extMeta(item.name);
      const w = document.createElement('div'); w.className='file-icon-wrap'; w.style.color=meta.fg;
      w.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><span class="file-badge" style="background:${meta.bg};color:${meta.fg}">${meta.label}</span>`;
      thumb.appendChild(w);
    }
    card.appendChild(thumb);

    if(ctx.insideFolder){
      thumb.style.cursor = 'pointer';
      thumb.addEventListener('click', openAction);
    } else {
      bindThumbDrag(thumb, card, item, openAction);
    }

    const metaBox = document.createElement('div'); metaBox.className='card-meta';
    const nameEl = document.createElement('div'); nameEl.className='card-name'; nameEl.textContent = displayName(item);
    const subEl = document.createElement('div'); subEl.className='card-sub';
    subEl.textContent = item.type==='folder' ? (item.itemIds.length+' Element'+(item.itemIds.length===1?'':'e')) : (fmtSize(item.size)+' · '+fmtTime(item.timestamp));
    const actions = document.createElement('div'); actions.className='card-actions';

    if(item.locked){
      const unlockBtn = createCardActionButton('btn-icon btn-preview', 'Mit PIN anzeigen', 'unlock', 'unlock-preview');
      const removeLockBtn = createCardActionButton('btn-icon btn-copy', 'PIN entfernen', 'lock', 'unlock-permanent');
      const delBtn = createCardActionButton('btn-icon btn-del', 'Löschen', 'trash', 'delete');
      actions.appendChild(unlockBtn); actions.appendChild(removeLockBtn); actions.appendChild(delBtn);
    } else if(item.type === 'folder'){
      const openBtn = createCardActionButton('btn-icon btn-preview', 'Ordner öffnen', 'folderOpen', 'folder-open');
      const copyBtn = createCardActionButton('btn-icon btn-copy', 'Dateiliste kopieren', 'copy', 'folder-copy');
      const delBtn = createCardActionButton('btn-icon btn-del', 'Ordner löschen', 'trash', 'delete');
      actions.appendChild(openBtn); actions.appendChild(copyBtn); actions.appendChild(delBtn);
    } else {
      const previewBtn = createCardActionButton('btn-icon btn-preview', 'Vorschau öffnen', 'preview', 'preview');
      const copyBtn = createCardActionButton('btn-icon btn-copy', 'Inhalt kopieren', 'copy', 'copy');
      const delBtn = createCardActionButton('btn-icon btn-del', 'Inhalt löschen', 'trash', 'delete');
      actions.appendChild(previewBtn); actions.appendChild(copyBtn); actions.appendChild(delBtn);
    }

    metaBox.appendChild(nameEl); metaBox.appendChild(subEl); metaBox.appendChild(actions);
    card.appendChild(metaBox);

    return card;
  }

  // ---------- delegated card events ----------
  function cardContextFromElement(element){
    const card = element?.closest?.('.card[data-id]');
    if(!card) return null;
    const item = dataOf(currentSpaceId).items[card.dataset.id];
    if(!item) return null;
    const insideFolder = card.dataset.insideFolder === '1';
    return {card, item, ctx:{insideFolder, folderId:card.dataset.folderId || null}};
  }
  function handleCardAction(event){
    const actionEl = event.target.closest('[data-card-action]');
    if(!actionEl) return;
    const resolved = cardContextFromElement(actionEl);
    if(!resolved) return;
    const {card,item,ctx}=resolved;
    const action=actionEl.dataset.cardAction;
    event.preventDefault(); event.stopPropagation();
    if(action==='select'){ toggleSelect(item.id,event.shiftKey); return; }
    if(action==='inline-edit'){ startInlineTextEdit(item,ctx,card,card.querySelector('.thumb')); return; }
    if(action==='unlock-preview'){ previewLockedItem(item); return; }
    if(action==='unlock-permanent'){ unlockItemPermanently(item,ctx); return; }
    if(action==='folder-open'){ openFolder(item); return; }
    if(action==='folder-copy'){ copyFolderSummary(item); return; }
    if(action==='preview'){ openPreview(item); return; }
    if(action==='copy'){ copyItem(item); return; }
    if(action==='delete'){
      if(item.type==='folder'){
        openDestructiveConfirm('Ordner löschen?', `"${displayName(item)}" und alle ${item.itemIds.length} enthaltenen Elemente werden dauerhaft gelöscht.`, 'Löschen', ()=>deleteFolder(item.id));
      }else{
        openDestructiveConfirm('Löschen?', `"${displayName(item)}" wird entfernt.`, 'Löschen', ()=>{
          if(ctx.insideFolder) deleteItemFromFolder(item.id,ctx.folderId); else removeItem(item.id);
        });
      }
    }
  }
  function handleCardContextMenu(event){
    const resolved=cardContextFromElement(event.target);
    if(!resolved) return;
    event.preventDefault(); event.stopPropagation();
    showContextMenu(event.clientX,event.clientY,buildActionsForItem(resolved.item,resolved.card,resolved.ctx));
  }
  function handleCardHover(event){
    const resolved=cardContextFromElement(event.target);
    if(!resolved) return;
    if(event.type==='mouseover') hoveredCardItem=resolved.item;
    else if(event.type==='mouseout' && !resolved.card.contains(event.relatedTarget) && hoveredCardItem===resolved.item) hoveredCardItem=null;
  }
  function handleCardDragStart(event){
    const dragOut=event.target.closest('[data-card-action="dragout"]');
    if(!dragOut) return;
    const resolved=cardContextFromElement(dragOut);
    if(!resolved) return;
    try{
      const item=resolved.item, used=new Set();
      const filename=exportFilename(item,used);
      const mime=item.type==='text'?'text/plain':(item.mime||'application/octet-stream');
      const url=item.type==='text'?('data:text/plain,'+encodeURIComponent(item.data)):item.data;
      event.dataTransfer.setData('DownloadURL',`${mime}:${filename}:${url}`);
      event.dataTransfer.effectAllowed='copy';
    }catch(error){}
  }
  function bindDelegatedCardEvents(container){
    if(!container || container.dataset.cardDelegationBound==='1') return;
    container.dataset.cardDelegationBound='1';
    container.addEventListener('click',handleCardAction,true);
    container.addEventListener('pointerdown',event=>{ if(event.target.closest('[data-card-action]')) event.stopPropagation(); },true);
    container.addEventListener('contextmenu',handleCardContextMenu);
    container.addEventListener('mouseover',handleCardHover);
    container.addEventListener('mouseout',handleCardHover);
    container.addEventListener('dragstart',handleCardDragStart);
  }
  bindDelegatedCardEvents(grid);
  bindDelegatedCardEvents(folderGrid);

  function bindThumbDrag(thumbEl, cardEl, item, openAction){
    thumbEl.addEventListener('pointerdown', (downEv)=>{
      if(downEv.button !== undefined && downEv.button !== 0) return;
      const startX = downEv.clientX, startY = downEv.clientY;
      let moved = false;
      function onMove(ev){
        if(!moved && Math.hypot(ev.clientX-startX, ev.clientY-startY) > 6){
          moved = true;
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          startCardDrag(downEv, cardEl, item.id);
        }
      }
      function onUp(upEv){
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if(!moved){
          if(upEv && upEv.shiftKey){ toggleSelect(item.id, true); }
          else { openAction(); }
        }
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  function fillFolderThumb(folderItem, wrapEl){
    const data = dataOf(currentSpaceId);
    const cells = wrapEl.querySelectorAll('.fcell');
    const previews = folderItem.itemIds.slice(0,4).map(id=>data.items[id]);
    previews.forEach((it, i)=>{
      if(!it || !cells[i]) return;
      if(it.type==='image'){ const img=document.createElement('img'); img.src=it.data; img.draggable=false; cells[i].appendChild(img); }
      else {
        const meta = it.type==='folder' ? {fg:'#6b7280'} : extMeta(it.name);
        cells[i].style.color = meta.fg;
        cells[i].innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
      }
    });
  }


  // ---------- inline text editing ----------
  let activeInlineTextEdit = null;
  function stopInlineTextEdit(saveChanges){
    const session=activeInlineTextEdit;
    if(!session) return;
    activeInlineTextEdit=null;
    document.removeEventListener('pointerdown',session.outsideHandler,true);
    const nextValue=session.textarea.value;
    session.card.classList.remove('inline-editing');
    if(saveChanges && nextValue!==session.original){
      mutationCheckpoint('content', currentSpaceId);
      session.item.data=nextValue;
      session.item.size=new Blob([nextValue]).size;
      if(!session.item.customName){
        const clean=nextValue.trim();
        session.item.name=(clean.slice(0,40)+(clean.length>40?'…':'')) || 'Leere Textkarte';
      }
      persistState();
      markRecent(session.item,'edit',session.ctx?.insideFolder ? session.ctx.folderId : null);
      if(session.ctx?.insideFolder) renderFolderGrid(); else { refreshItems(); render(); }
      showToast('Text gespeichert');
    }else{
      session.editor.remove();
      if(saveChanges) showToast('Keine Änderungen');
    }
  }
  function startInlineTextEdit(item,ctx,card,thumb){
    if(item.type!=='text' || item.locked) return;
    if(activeInlineTextEdit) stopInlineTextEdit(true);
    const editor=document.createElement('div'); editor.className='inline-text-editor';
    const textarea=document.createElement('textarea'); textarea.value=item.data || ''; textarea.spellcheck=true;
    textarea.setAttribute('aria-label','Textkarten-Inhalt bearbeiten');
    const actions=document.createElement('div'); actions.className='inline-text-editor-actions';
    const buttons=document.createElement('div'); buttons.className='inline-text-editor-buttons';
    const cancel=document.createElement('button'); cancel.className='inline-text-cancel'; cancel.textContent='Abbrechen';
    const save=document.createElement('button'); save.className='inline-text-save'; save.textContent='Speichern';
    buttons.append(cancel,save); actions.append(buttons); editor.append(textarea,actions); thumb.appendChild(editor); card.classList.add('inline-editing');
    const outsideHandler=(event)=>{ if(activeInlineTextEdit && !editor.contains(event.target)) stopInlineTextEdit(true); };
    activeInlineTextEdit={item,ctx,card,thumb,editor,textarea,original:item.data || '',outsideHandler};
    document.addEventListener('pointerdown',outsideHandler,true);
    textarea.addEventListener('keydown',event=>{
      if(event.key==='Escape'){ event.preventDefault(); event.stopPropagation(); stopInlineTextEdit(false); }
      else if((event.metaKey||event.ctrlKey) && event.key==='Enter'){ event.preventDefault(); event.stopPropagation(); stopInlineTextEdit(true); }
    });
    cancel.addEventListener('pointerdown',e=>e.stopPropagation());
    save.addEventListener('pointerdown',e=>e.stopPropagation());
    cancel.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); stopInlineTextEdit(false); });
    save.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); stopInlineTextEdit(true); });
    requestAnimationFrame(()=>{ textarea.focus(); textarea.setSelectionRange(textarea.value.length,textarea.value.length); });
  }

  // ---------- grid render ----------
  let lastGridRenderSignature = '';
  function itemRenderFingerprint(item){
    const data = typeof item.data==='string' ? `${item.data.length}:${item.data.slice(0,32)}:${item.data.slice(-32)}` : '';
    const nested = item.type==='folder' ? (item.itemIds || []).join(',') : '';
    return [item.id,item.type,item.name,item.customName||'',item.size||0,item.timestamp||0,item.favorite?1:0,item.pinned?1:0,item.locked?1:0,nested,data].join('~');
  }
  function gridRenderSignature(){
    return [currentSpaceId,viewMode,items.map(itemRenderFingerprint).join('|')].join('::');
  }
  function renderGridChrome(){
    countPill.textContent = items.length;
    clearBtn.hidden = items.length === 0;
    emptyNote.style.display = items.length === 0 ? 'block' : 'none';
    dropzone.classList.toggle('hero',items.length===0);
    dropzone.classList.toggle('compact',items.length>0);
    dzTitle.textContent=items.length===0?'Hierher ziehen oder einfügen':'Weitere Dateien hinzufügen';
    updateFavoritesHeaderShortcut();
    updateRecentHeaderShortcut();
  }
  /**
   * Renders the active top-level grid.
   * The signature skips no-op rebuilds; force only for geometry-sensitive paths.
   */
  function render(force=false){
    renderGridChrome();
    const signature=gridRenderSignature();
    if(force || signature!==lastGridRenderSignature){
      const fragment=document.createDocumentFragment();
      items.forEach(item=>fragment.appendChild(buildCard(item,{insideFolder:false})));
      grid.replaceChildren(fragment);
      lastGridRenderSignature=signature;
    }
    updateSelectionUI();
  }
  function flipRenderGrid(){
    const before = new Map();
    grid.querySelectorAll('.card[data-id]').forEach(el=> before.set(el.dataset.id, el.getBoundingClientRect()));
    render(true);
    grid.querySelectorAll('.card[data-id]').forEach(el=>{
      const prev = before.get(el.dataset.id);
      if(!prev) return;
      const rect = el.getBoundingClientRect();
      const dx = prev.left-rect.left, dy = prev.top-rect.top;
      if(Math.abs(dx)>1 || Math.abs(dy)>1){
        el.style.transition='none'; el.style.transform=`translate(${dx}px,${dy}px)`;
        requestAnimationFrame(()=>{ el.style.transition='transform .28s cubic-bezier(.2,.8,.2,1)'; el.style.transform='translate(0,0)'; });
      }
    });
  }

  // ---------- multi-select ----------
  function toggleSelect(id, rangeMode){
    if(rangeMode && lastSelectedId && lastSelectedId !== id){
      const ids = items.map(i=>i.id);
      const a = ids.indexOf(lastSelectedId), b = ids.indexOf(id);
      if(a>-1 && b>-1){
        const [start,end] = a<b ? [a,b] : [b,a];
        for(let i=start;i<=end;i++) selectedIds.add(ids[i]);
      } else {
        selectedIds.add(id);
      }
    } else {
      if(selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
      lastSelectedId = id;
    }
    updateSelectionUI();
  }
  function currentSelectableIds(){
    return items.map(item=>item.id);
  }
  function clearSelection(){ selectedIds.clear(); lastSelectedId=null; updateSelectionUI(); }
  function toggleSelectAll(){
    const ids = currentSelectableIds();
    if(!ids.length) return;
    const allSelected = ids.every(id=>selectedIds.has(id));
    if(allSelected){
      selectedIds.clear();
      lastSelectedId = null;
    } else {
      ids.forEach(id=>selectedIds.add(id));
      lastSelectedId = ids[ids.length-1] || null;
    }
    updateSelectionUI();
  }
  function updateSelectionUI(){
    const availableIds = new Set(currentSelectableIds());
    for(const id of Array.from(selectedIds)){ if(!availableIds.has(id)) selectedIds.delete(id); }
    if(lastSelectedId && !availableIds.has(lastSelectedId)) lastSelectedId = null;

    grid.classList.toggle('selecting', selectedIds.size>0);
    grid.querySelectorAll('.card[data-id]').forEach(el=>{
      const box = el.querySelector('.card-select');
      if(box) box.classList.toggle('checked', selectedIds.has(el.dataset.id));
    });
    selectionBar.classList.toggle('show', selectedIds.size>0);
    selectionCount.textContent = selectedIds.size + ' ausgewählt';

    const selectableIds = currentSelectableIds();
    const allSelected = selectableIds.length > 0 && selectableIds.every(id=>selectedIds.has(id));
    selAllLabel.textContent = allSelected ? 'Auswahl aufheben' : 'Alle auswählen';
    selAllBtn.title = allSelected
      ? 'Auswahl im aktuellen Space vollständig aufheben'
      : 'Alle Karten im aktuellen Space auswählen';
  }
  selAllBtn.addEventListener('click', toggleSelectAll);
  selClearBtn.addEventListener('click', clearSelection);
  selDeleteBtn.addEventListener('click', ()=>{
    const ids = Array.from(selectedIds);
    if(!ids.length) return;
    openDestructiveConfirm('Auswahl löschen?', `${ids.length} Element${ids.length===1?'':'e'} werden dauerhaft gelöscht.`, 'Löschen', ()=>{
      mutationCheckpoint('content', currentSpaceId);
      const data = dataOf(currentSpaceId);
      ids.forEach(id=>{
        const it = data.items[id];
        if(it && it.type==='folder'){ for(const nid of it.itemIds){ delete data.items[nid]; } }
        delete data.items[id];
        data.itemIds = data.itemIds.filter(i=>i!==id);
      });
      clearSelection();
      refreshItems();
      flipRenderGrid();
      persistState();
      showToast('Gelöscht');
    });
  });
  selDuplicateBtn.addEventListener('click', ()=>{
    const ids = Array.from(selectedIds);
    if(!ids.length) return;
    mutationCheckpoint('content', currentSpaceId);
    const data = dataOf(currentSpaceId);
    ids.forEach(id=>{
      const item = data.items[id];
      if(item) duplicateItem(item, {}, {skipHistory:true, skipPersist:true, silent:true});
    });
    persistState();
    clearSelection();
    showToast('Dupliziert');
  });
  selMoveBtn.addEventListener('click', ()=>{
    const ids = Array.from(selectedIds);
    if(!ids.length) return;
    renderSpacePickerRows(spaceMoveList, (targetId, meta={})=>{
      spaceMoveOverlay.classList.remove('show');
      mutationCheckpoint('crossSpace');
      if(meta.createNew) targetId = createSpaceQuiet({skipPersist:true});
      const data = dataOf(currentSpaceId);
      ids.forEach(id=>{ const it = data.items[id]; if(it) moveItemToSpace(it, targetId, {skipHistory:true, skipPersist:true, silent:true}); });
      persistState();
      clearSelection();
      flipRenderGrid();
      const targetSpace = spaces.find(s=>s.id===targetId);
      showToast(`Nach "${targetSpace ? targetSpace.name : 'Space'}" verschoben`);
    });
    spaceMoveOverlay.classList.add('show');
  });
  selFolderBtn.addEventListener('click', ()=>{
    const ids = Array.from(selectedIds);
    if(ids.length < 2){ showToast('Wähle mindestens 2 Elemente aus'); return; }
    mutationCheckpoint('content', currentSpaceId);
    const data = dataOf(currentSpaceId);
    const folderAmongIds = ids.find(id=> data.items[id] && data.items[id].type==='folder');
    if(folderAmongIds){
      const folder = data.items[folderAmongIds];
      ids.filter(id=>id!==folderAmongIds).forEach(id=>{
        if(!data.items[id]) return;
        folder.itemIds.push(id);
        data.itemIds = data.itemIds.filter(i=>i!==id);
      });
    } else {
      const folder = { id:uid(), type:'folder', name:'Ordner', timestamp:Date.now(), itemIds:ids.slice() };
      data.items[folder.id] = folder;
      const firstIdx = data.itemIds.indexOf(ids[0]);
      data.itemIds.splice(firstIdx>-1?firstIdx:0, 1, folder.id);
      ids.slice(1).forEach(id=>{ data.itemIds = data.itemIds.filter(i=>i!==id); });
    }
    clearSelection();
    refreshItems();
    flipRenderGrid();
    persistState();
    showToast('Ordner erstellt');
  });


  // ---------- duplicate control ----------
  let pendingDuplicateItem = null;
  let pendingDuplicateMatches = [];

  function duplicateSignature(item){
    if(!item || item.type === 'folder' || item.data == null) return null;
    return `${item.type}::${item.mime || ''}::${item.data}`;
  }

  function collectAllItemLocations(){
    const rows = [];
    spaces.forEach(sp=>{
      const d = state.data[sp.id];
      if(!d) return;
      const nested = new Map();
      Object.values(d.items || {}).forEach(folder=>{
        if(folder?.type !== 'folder') return;
        (folder.itemIds || []).forEach(id=>nested.set(id, folder));
      });
      Object.values(d.items || {}).forEach(item=>{
        if(!item || item.type === 'folder') return;
        rows.push({item, space:sp, folder:nested.get(item.id) || null});
      });
    });
    return rows;
  }

  function findExactDuplicates(item){
    const signature = duplicateSignature(item);
    if(!signature) return [];
    return collectAllItemLocations().filter(entry=>duplicateSignature(entry.item) === signature);
  }

  function duplicateLocationLabel(entry){
    return entry.folder ? `${entry.space.name} · ${displayName(entry.folder)}` : entry.space.name;
  }

  function openLocatedItem(entry){
    if(!entry) return;
    duplicateOverlay.classList.remove('show');
    duplicateDetectedOverlay.classList.remove('show');
    switchSpace(entry.space.id);
    setTimeout(()=>{
      if(entry.folder){
        openFolder(entry.folder);
        setTimeout(()=>{
          const target = folderGrid.querySelector(`[data-id="${entry.item.id}"]`);
          if(target){
            target.scrollIntoView({block:'center'});
            target.animate(
              [{outline:'3px solid var(--accent)',outlineOffset:'3px'},{outline:'0 solid transparent',outlineOffset:'0'}],
              {duration:900,easing:'ease-out'}
            );
          }
        },80);
      } else {
        const target = grid.querySelector(`[data-id="${entry.item.id}"]`);
        if(target){
          target.scrollIntoView({block:'center'});
          target.animate(
            [{outline:'3px solid var(--accent)',outlineOffset:'3px'},{outline:'0 solid transparent',outlineOffset:'0'}],
            {duration:900,easing:'ease-out'}
          );
        }
        openPreview(entry.item);
      }
    },60);
  }

  function buildDuplicateGroups(){
    const groups = new Map();
    collectAllItemLocations().forEach(entry=>{
      const signature = duplicateSignature(entry.item);
      if(!signature) return;
      if(!groups.has(signature)) groups.set(signature, []);
      groups.get(signature).push(entry);
    });
    return Array.from(groups.values())
      .filter(group=>group.length > 1)
      .sort((a,b)=>b.length-a.length || displayName(a[0].item).localeCompare(displayName(b[0].item),'de'));
  }

  function openDuplicateAudit(){
    const groups = buildDuplicateGroups();
    duplicateList.innerHTML = '';
    if(!groups.length){
      const empty = document.createElement('div');
      empty.className = 'duplicate-empty';
      empty.textContent = 'Keine exakt identischen Inhalte gefunden.';
      duplicateList.appendChild(empty);
    } else {
      groups.forEach(group=>{
        const wrap = document.createElement('section');
        wrap.className = 'duplicate-group';

        const title = document.createElement('div');
        title.className = 'duplicate-group-title';
        const strong = document.createElement('strong');
        strong.textContent = displayName(group[0].item);
        const count = document.createElement('span');
        count.className = 'duplicate-count';
        count.textContent = `${group.length}×`;
        title.append(strong,count);
        wrap.appendChild(title);

        group.forEach(entry=>{
          const row = document.createElement('div');
          row.className = 'duplicate-row';
          const main = document.createElement('div');
          main.className = 'duplicate-row-main';
          const name = document.createElement('div');
          name.className = 'duplicate-row-name';
          name.textContent = displayName(entry.item);
          const sub = document.createElement('div');
          sub.className = 'duplicate-row-sub';
          sub.textContent = `${duplicateLocationLabel(entry)} · ${fmtSize(entry.item.size || itemStorageBytes(entry.item))}`;
          main.append(name,sub);
          const actions = document.createElement('div');
          actions.className = 'duplicate-row-actions';
          const eye = document.createElement('button');
          eye.className = 'duplicate-mini-btn';
          eye.type = 'button';
          eye.title = 'Anzeigen';
          eye.innerHTML = ICONS.preview;
          eye.addEventListener('click',()=>openLocatedItem(entry));
          actions.appendChild(eye);
          row.append(main,actions);
          wrap.appendChild(row);
        });
        duplicateList.appendChild(wrap);
      });
    }
    duplicateOverlay.classList.add('show');
  }

  function closeDuplicateDetected(){
    duplicateDetectedOverlay.classList.remove('show');
    pendingDuplicateItem = null;
    pendingDuplicateMatches = [];
  }

  function openDuplicateDetected(newItem, matches){
    pendingDuplicateItem = newItem;
    pendingDuplicateMatches = matches;
    duplicateDetectedBody.innerHTML = '';
    matches.slice(0,4).forEach(entry=>{
      const card = document.createElement('div');
      card.className = 'duplicate-detected-card';
      const strong = document.createElement('strong');
      strong.textContent = displayName(entry.item);
      const span = document.createElement('span');
      span.textContent = duplicateLocationLabel(entry);
      card.append(strong,span);
      duplicateDetectedBody.appendChild(card);
    });
    if(matches.length > 4){
      const more = document.createElement('div');
      more.className = 'duplicate-detected-card';
      more.textContent = `Weitere Treffer: ${matches.length - 4}`;
      duplicateDetectedBody.appendChild(more);
    }
    duplicateDetectedOverlay.classList.add('show');
  }

  duplicateCloseBtn.addEventListener('click',()=>duplicateOverlay.classList.remove('show'));
  duplicateOverlay.addEventListener('click',e=>{ if(e.target===duplicateOverlay) duplicateOverlay.classList.remove('show'); });
  duplicateDetectedCloseBtn.addEventListener('click',closeDuplicateDetected);
  duplicateCancelBtn.addEventListener('click',closeDuplicateDetected);
  duplicateDetectedOverlay.addEventListener('click',e=>{ if(e.target===duplicateDetectedOverlay) closeDuplicateDetected(); });
  duplicateOpenExistingBtn.addEventListener('click',()=>openLocatedItem(pendingDuplicateMatches[0]));
  duplicateAddAnywayBtn.addEventListener('click',()=>{
    const item = pendingDuplicateItem;
    closeDuplicateDetected();
    if(item) addItem(item, true);
  });


  // ---------- item actions ----------
  function addItem(newItem, allowDuplicate=false){
    const data = dataOf(currentSpaceId);
    if(!allowDuplicate){
      const duplicates = findExactDuplicates(newItem);
      if(duplicates.length){
        openDuplicateDetected(newItem, duplicates);
        return;
      }
    }
    const projectedBytes = estimateBytes(state) + itemStorageBytes(newItem);
    if(projectedBytes > MAX_TOTAL_BYTES){
      showToast('20-MB-Limit erreicht — lösche oder exportiere große Inhalte');
      return;
    }
    if(projectedBytes > MAX_TOTAL_BYTES * .9){ showToast('Speicher fast voll — mehr als 90 % belegt'); }
    mutationCheckpoint('content', currentSpaceId);
    data.items[newItem.id] = newItem;
    data.itemIds.unshift(newItem.id);
    refreshItems(); render();
    persistState();
  }
  function removeItem(id){
    const data = dataOf(currentSpaceId);
    if(!data.items[id]) return;
    mutationCheckpoint('content', currentSpaceId);
    data.itemIds = data.itemIds.filter(i=>i!==id);
    delete data.items[id];
    refreshItems(); render();
    persistState();
  }
  function clearAll(){
    if(!dataOf(currentSpaceId).itemIds.length) return;
    mutationCheckpoint('content', currentSpaceId);
    state.data[currentSpaceId] = { itemIds: [], items: {} };
    refreshItems(); render();
    persistState();
  }

  function imageDataUrlToPngBlob(dataUrl){
    return new Promise((resolve, reject)=>{
      const img = new Image();
      img.onload = ()=>{
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob(blob=>{ blob ? resolve(blob) : reject(new Error('toBlob failed')); }, 'image/png');
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }
  async function copyItem(item){
    try{
      if(item.type === 'text'){ await navigator.clipboard.writeText(item.data); markRecent(item,'copy'); showToast('Text kopiert'); }
      else if(item.type === 'image'){
        // clipboard.write() reliably only supports PNG — jpeg/webp/etc. get rejected by most browsers, so normalize first
        const pngBlob = await imageDataUrlToPngBlob(item.data);
        await navigator.clipboard.write([new ClipboardItem({'image/png': pngBlob})]);
        markRecent(item,'copy'); showToast('Bild kopiert');
      }
      else {
        try{ const blob = await (await fetch(item.data)).blob(); await navigator.clipboard.write([new ClipboardItem({[blob.type||'application/octet-stream']: blob})]); markRecent(item,'copy'); showToast('Kopiert'); }
        catch(err){ showToast('Zwischenablage unterstützt diesen Typ nicht — nutze Herunterladen in der Vorschau'); }
      }
    }catch(e){ showToast('Kopieren fehlgeschlagen — nutze Herunterladen in der Vorschau'); }
  }
  function downloadItem(item){
    if(item.type==='folder') return;
    const a = document.createElement('a');
    if(item.type==='text'){ const blob = new Blob([item.data], {type:'text/plain'}); a.href = URL.createObjectURL(blob); a.download = (displayName(item)||'text')+'.txt'; }
    else { a.href = item.data; a.download = displayName(item); }
    a.click();
  }

  function openPreview(item){
    markRecent(item,'open');
    previewName.textContent = displayName(item);
    previewBody.innerHTML = '';
    if(item.type === 'image'){
      const img = document.createElement('img'); img.src = item.data; img.draggable = false; previewBody.appendChild(img);
    } else if(item.type === 'text'){
      const pre = document.createElement('pre'); pre.textContent = item.data; previewBody.appendChild(pre);
    } else if(item.mime && item.mime.startsWith('audio/')){
      const audio = document.createElement('audio'); audio.controls = true; audio.src = item.data; audio.style.width = '100%';
      previewBody.appendChild(audio);
    } else {
      const meta = extMeta(item.name);
      const div = document.createElement('div'); div.className='preview-file';
      div.innerHTML = `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="${meta.fg}" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><span class="file-badge" style="background:${meta.bg};color:${meta.fg}">${meta.label}</span><span>${fmtSize(item.size)}</span>`;
      previewBody.appendChild(div);
    }
    previewFooter.innerHTML = '';
    const shareBtn = document.createElement('button'); shareBtn.style.background='#f4f5f7'; shareBtn.style.color='var(--ink)';
    shareBtn.innerHTML = ICONS.share+' Teilen'; shareBtn.addEventListener('click', ()=>openShareSheet(item));
    const copyBtn = document.createElement('button'); copyBtn.style.background='var(--accent)'; copyBtn.style.color='#fff';
    copyBtn.innerHTML = ICONS.copy+' Kopieren'; copyBtn.addEventListener('click', ()=>copyItem(item));
    const editBtn = document.createElement('button'); editBtn.style.background='#f4f5f7'; editBtn.style.color='var(--ink)';
    editBtn.innerHTML = ICONS.edit+' Inhalt bearbeiten'; editBtn.addEventListener('click', ()=>{
      const found = locateItem(item.id, currentSpaceId);
      const editCtx = found?.folder ? {insideFolder:true, folderId:found.folder.id} : {};
      closePreview();
      openEditContent(item, editCtx);
    });
    const dlBtn = document.createElement('button'); dlBtn.style.background='#f4f5f7'; dlBtn.style.color='var(--ink)';
    dlBtn.innerHTML = ICONS.download+' Herunterladen'; dlBtn.addEventListener('click', ()=>downloadItem(item));
    previewFooter.appendChild(shareBtn); previewFooter.appendChild(copyBtn); previewFooter.appendChild(editBtn); previewFooter.appendChild(dlBtn);
    previewOverlay.classList.add('show');
  }
  function closePreview(){
    previewOverlay.classList.remove('show');
    previewOverlay.classList.remove('storage-child-modal');
    previewBody.innerHTML='';
  }
  previewCloseBtn.addEventListener('click', closePreview);
  previewOverlay.addEventListener('click', (e)=>{ if(e.target===previewOverlay) closePreview(); });

  clearBtn.addEventListener('click', ()=>{
    openDestructiveConfirm('Space wirklich leeren?', 'Alle Einträge in diesem Space werden dauerhaft gelöscht.', 'Leeren', ()=>{ clearAll(); showToast('Geleert'); });
  });

  titleInput.addEventListener('blur', ()=>renameCurrentSpace(titleInput.value));
  titleInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') titleInput.blur(); });

  async function openTextModal(){
    editTextContext = null;
    textOverlayTitle.textContent = 'Zwischenablage einfügen';
    textArea.value = '';
    textOverlay.classList.add('show');
    try{ const clip = await navigator.clipboard.readText(); if(clip && clip.trim()){ textArea.value = clip; textArea.select(); } }catch(e){}
    setTimeout(()=>textArea.focus(), 50);
  }
  addTextBtn.addEventListener('click', openTextModal);
  dzTextLink.addEventListener('click', (e)=>{ e.stopPropagation(); openTextModal(); });
  textCancelBtn.addEventListener('click', ()=>textOverlay.classList.remove('show'));
  textOverlay.addEventListener('click', (e)=>{ if(e.target===textOverlay){ textOverlay.classList.remove('show'); editTextContext=null; textOverlayTitle.textContent='Zwischenablage einfügen'; } });

  async function ingestFiles(fileList){
    for(const file of Array.from(fileList)){
      try{
        if(file.size > MAX_FILE_BYTES){ showToast(`"${file.name}" ist zu groß (max. ${fmtSize(MAX_FILE_BYTES)})`); continue; }
        const dataUrl = await fileToDataURL(file);
        const type = file.type && file.type.startsWith('image/') ? 'image' : 'file';
        const item = { id:uid(), type, name:file.name||'Unbenannt', mime:file.type||'application/octet-stream', size:file.size, timestamp:Date.now(), data:dataUrl };
        addItem(item);
      }catch(err){ showToast(`"${file.name}" konnte nicht gelesen werden`); }
    }
  }
  function ingestText(text){
    if(!text || !text.trim()) return;
    addItem({ id:uid(), type:'text', name:text.trim().slice(0,40)+(text.trim().length>40?'…':''), mime:'text/plain', size:new Blob([text]).size, timestamp:Date.now(), data:text });
  }
  async function pasteFromClipboard(){
    try{
      const clipItems = await navigator.clipboard.read();
      for(const clipItem of clipItems){
        for(const type of clipItem.types){
          if(type.startsWith('image/')){ const blob = await clipItem.getType(type); const file = new File([blob], 'geklebt.png', {type}); await ingestFiles([file]); return; }
        }
      }
    }catch(e){}
    try{ const text = await navigator.clipboard.readText(); if(text && text.trim()){ ingestText(text); return; } }catch(e){}
    showToast('Zwischenablage ist leer oder nicht lesbar');
  }

  document.addEventListener('contextmenu', (e)=>{
    if(e.target.closest('.card') || e.target.closest('.context-menu') || e.target.closest('.overlay') ||
       e.target.closest('.tabs-wrap') || e.target.closest('.view-toggle') || e.target.closest('.actions-pill') ||
       e.target.closest('#memoryToggle') || e.target.closest('#helpToggle') || e.target.closest('#cloudToggle') || e.target.closest('.selection-bar') || e.target.closest('.logo')) return;
    e.preventDefault();
    const rows = [
      {icon:ICONS.paste, label:'Einfügen', onClick:pasteFromClipboard},
      {sep:true},
      {icon:ICONS.plus, label:'Neuer Space', onClick:addSpace},
      {sep:true},
      {label:'Ansicht', header:true},
      {icon:ICONS.grid, label:'Kachelansicht'+(viewMode==='grid'?' ✓':''), onClick:()=>setViewMode('grid')},
      {icon:ICONS.list, label:'Listenansicht'+(viewMode==='list'?' ✓':''), onClick:()=>setViewMode('list')}
    ];
    showContextMenu(e.clientX, e.clientY, rows);
  });

  let dragCounter = 0;
  document.addEventListener('dragenter', (e)=>{ e.preventDefault(); dragCounter++; dropzone.classList.add('drag'); dragFog.classList.add('active'); });
  document.addEventListener('dragover', (e)=>{ e.preventDefault(); });
  document.addEventListener('dragleave', (e)=>{ e.preventDefault(); dragCounter=Math.max(0,dragCounter-1); if(dragCounter===0){ dropzone.classList.remove('drag'); dragFog.classList.remove('active'); } });
  document.addEventListener('drop', async (e)=>{
    e.preventDefault(); dragCounter=0; dropzone.classList.remove('drag'); dragFog.classList.remove('active');
    const dt = e.dataTransfer; if(!dt) return;
    if(dt.files && dt.files.length){ await ingestFiles(dt.files); return; }
    const text = dt.getData('text/uri-list') || dt.getData('text/plain');
    if(text) ingestText(text);
  });
  dropzone.addEventListener('click', ()=> fileInput.click());
  fileInput.addEventListener('change', async (e)=>{ await ingestFiles(e.target.files); fileInput.value=''; });

  document.addEventListener('paste', async (e)=>{
    if(!pasteCaptureOn) return;
    if(document.activeElement === textArea || document.activeElement === folderTitleInput || document.activeElement === titleInput || document.activeElement === renameInput) return;
    if(document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('tab-rename-input')) return;
    const cd = e.clipboardData; if(!cd) return;
    let handledFile = false;
    for(const it of Array.from(cd.items)){ if(it.kind==='file'){ const file=it.getAsFile(); if(file){ await ingestFiles([file]); handledFile=true; } } }
    if(!handledFile){ const text = cd.getData('text/plain'); if(text) ingestText(text); }
  });

  // ---------- card drag: reorder / folder creation / move to another space (with iOS-like suck-in animation) ----------
  function startCardDrag(e, cardEl, itemId){
    e.preventDefault();
    const isStack = selectedIds.size > 1 && selectedIds.has(itemId);
    const stackIds = isStack ? items.filter(i=>selectedIds.has(i.id)).map(i=>i.id) : [itemId];
    const otherStackEls = isStack ? stackIds.filter(id=>id!==itemId).map(id=>grid.querySelector(`.card[data-id="${id}"]`)).filter(Boolean) : [];

    const originRect = cardEl.getBoundingClientRect(); // captured BEFORE any transform, since transform is always relative to this base position
    cardEl.classList.add('dragging'); cardEl.style.zIndex = 50; cardEl.style.transition='none';
    cardEl.style.opacity = '0.5';
    cardEl.style.pointerEvents = 'none'; // so elementFromPoint can "see through" it to tabs/cards underneath
    try{ cardEl.setPointerCapture(e.pointerId); }catch(err){}
    const dragHintTextNode = Array.from(dragHint.childNodes).find(n=>n.nodeType===Node.TEXT_NODE && n.textContent.trim());
    const originalDragHintText = dragHintTextNode ? dragHintTextNode.textContent : '';
    if(dragHintTextNode && currentSortMode()!=='manual') dragHintTextNode.textContent = ' Sortierung aktiv: In Ordner oder Space verschieben möglich; manuelles Einordnen ist pausiert';
    dragHint.classList.add('show');

    let stackBadge = null;
    if(isStack){
      otherStackEls.forEach(el=>{ el.style.transition='none'; el.style.opacity='0.35'; });
      stackBadge = document.createElement('div');
      stackBadge.className = 'stack-badge';
      stackBadge.textContent = stackIds.length;
      cardEl.appendChild(stackBadge);
    }

    const startX = e.clientX, startY = e.clientY;
    let hoveredTab = null;
    let mergeTargetEl = null;
    let insertTargetId = null, insertSide = null;

    function findNearestCard(px, py){
      const others = Array.from(grid.querySelectorAll('.card')).filter(el=>el!==cardEl && !otherStackEls.includes(el));
      let nearest=null, nearestDist=Infinity;
      others.forEach(el=>{
        const r = el.getBoundingClientRect();
        const cx=r.left+r.width/2, cy=r.top+r.height/2;
        const d = Math.hypot(px-cx, py-cy);
        if(d<nearestDist){ nearestDist=d; nearest=el; }
      });
      return {nearest, nearestDist};
    }
    function findTabUnder(px, py){
      const tabs = Array.from(tabsScroll.querySelectorAll('.tab'));
      for(const t of tabs){
        const r = t.getBoundingClientRect();
        if(px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) return t;
      }
      return null;
    }
    function positionDropLine(nearest, side){
      const r = nearest.getBoundingClientRect();
      const isList = grid.classList.contains('list-view');
      dropLine.classList.add('show');
      if(isList){
        dropLine.style.width = r.width+'px';
        dropLine.style.height = '3px';
        dropLine.style.left = r.left+'px';
        dropLine.style.top = (side==='before' ? r.top-6 : r.bottom+3)+'px';
      } else {
        dropLine.style.height = r.height+'px';
        dropLine.style.width = '3px';
        dropLine.style.top = r.top+'px';
        dropLine.style.left = (side==='before' ? r.left-6 : r.right+3)+'px';
      }
    }
    function hideDropLine(){ dropLine.classList.remove('show'); }
    function restoreStackEls(){ otherStackEls.forEach(el=>{ el.style.opacity=''; el.style.transition=''; }); }

    function onMove(ev){
      const dx = ev.clientX-startX, dy = ev.clientY-startY;
      cardEl.style.transform = `translate(${dx}px,${dy}px) scale(1.04)`;

      const tabEl = findTabUnder(ev.clientX, ev.clientY);
      if(tabEl !== hoveredTab){
        if(hoveredTab) hoveredTab.classList.remove('space-drop-target');
        hoveredTab = (tabEl && tabEl.dataset.id !== currentSpaceId) ? tabEl : null;
        if(hoveredTab) hoveredTab.classList.add('space-drop-target');
      }
      if(mergeTargetEl){ mergeTargetEl.classList.remove('drop-target'); mergeTargetEl=null; }
      hideDropLine(); insertTargetId=null; insertSide=null;
      if(hoveredTab) return;

      const {nearest, nearestDist} = findNearestCard(ev.clientX, ev.clientY);
      if(!nearest) return;
      const r = nearest.getBoundingClientRect();
      const mergeRadius = Math.min(r.width, r.height) * 0.38;
      if(nearestDist < mergeRadius){
        nearest.classList.add('drop-target'); mergeTargetEl = nearest;
      } else if(currentSortMode()==='manual' && nearestDist < Math.max(r.width, r.height) * 0.9) {
        const isList = grid.classList.contains('list-view');
        const side = isList ? (ev.clientY < r.top+r.height/2 ? 'before':'after') : (ev.clientX < r.left+r.width/2 ? 'before':'after');
        insertSide = side; insertTargetId = nearest.dataset.id;
        positionDropLine(nearest, side);
      }
    }
    function onUp(ev){
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      cardEl.style.pointerEvents = '';
      cardEl.classList.remove('dragging'); cardEl.style.zIndex=''; cardEl.style.opacity='';
      if(stackBadge) stackBadge.remove();
      dragHint.classList.remove('show');
      if(dragHintTextNode) dragHintTextNode.textContent = originalDragHintText;
      if(mergeTargetEl) mergeTargetEl.classList.remove('drop-target');
      hideDropLine();
      if(hoveredTab) hoveredTab.classList.remove('space-drop-target');

      const finalTab = findTabUnder(ev.clientX, ev.clientY);
      if(finalTab && finalTab.dataset.id !== currentSpaceId){
        const targetSpaceId = finalTab.dataset.id;
        const tabRect = finalTab.getBoundingClientRect();
        // relative to originRect (the card's untransformed base position) so the fly-in continues smoothly
        // from wherever it currently is, instead of jumping back through the origin first
        const dx = (tabRect.left+tabRect.width/2) - (originRect.left+originRect.width/2);
        const dy = (tabRect.top+tabRect.height/2) - (originRect.top+originRect.height/2);
        cardEl.style.transition = 'transform .32s cubic-bezier(.3,.1,.3,1), opacity .3s ease';
        cardEl.style.transform = `translate(${dx}px, ${dy}px) scale(0.12) rotate(8deg)`;
        cardEl.style.opacity = '0';
        otherStackEls.forEach(el=>{ el.style.transition='transform .32s ease, opacity .3s ease'; el.style.transform=`translate(${dx}px,${dy}px) scale(0.12)`; el.style.opacity='0'; });
        const tabLabel = finalTab.querySelector('.tab-label');
        if(tabLabel){ tabLabel.style.transition = 'transform .18s ease'; tabLabel.style.transform = 'scale(1.25)'; setTimeout(()=>{ tabLabel.style.transform=''; }, 260); }
        setTimeout(()=>{
          const data = dataOf(currentSpaceId);
          stackIds.forEach(id=>{ const it = data.items[id]; if(it) moveItemToSpace(it, targetSpaceId); });
          if(isStack) clearSelection();
          flipRenderGrid();
        }, 300);
        return;
      }

      if(mergeTargetEl && mergeTargetEl.dataset.id !== itemId){
        cardEl.style.transform=''; cardEl.style.transition=''; restoreStackEls();
        if(isStack){ mergeStackIntoFolder(stackIds, mergeTargetEl.dataset.id); clearSelection(); }
        else { mergeIntoFolder(itemId, mergeTargetEl.dataset.id); }
        return;
      }
      if(insertTargetId && insertTargetId !== itemId){
        cardEl.style.transform=''; cardEl.style.transition=''; restoreStackEls();
        if(isStack){ reorderStackAtPosition(stackIds, insertTargetId, insertSide); clearSelection(); }
        else { reorderItemAtPosition(itemId, insertTargetId, insertSide); }
        return;
      }
      restoreStackEls();
      cardEl.style.transition='transform .2s cubic-bezier(.2,.8,.2,1)'; cardEl.style.transform='translate(0,0)';
      setTimeout(()=>{ cardEl.style.transform=''; cardEl.style.transition=''; }, 220);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function reorderStackAtPosition(draggedIds, targetId, side){
    mutationCheckpoint('content', currentSpaceId);
    const data = dataOf(currentSpaceId);
    const draggedSet = new Set(draggedIds);
    const remaining = data.itemIds.filter(id=>!draggedSet.has(id));
    const orderedDragged = data.itemIds.filter(id=>draggedSet.has(id)); // preserve original relative order
    let toIdx = remaining.indexOf(targetId);
    if(toIdx===-1) toIdx = remaining.length;
    else if(side==='after') toIdx += 1;
    remaining.splice(toIdx, 0, ...orderedDragged);
    data.itemIds = remaining;
    refreshItems();
    flipRenderGrid();
    persistState();
  }
  function mergeStackIntoFolder(draggedIds, targetId){
    const data = dataOf(currentSpaceId);
    const targetItem = data.items[targetId];
    if(!targetItem) return;
    const idsToAdd = draggedIds.filter(id=>id!==targetId && data.items[id]);
    if(!idsToAdd.length) return;
    mutationCheckpoint('content', currentSpaceId);
    if(targetItem.type === 'folder'){
      idsToAdd.forEach(id=>targetItem.itemIds.push(id));
      data.itemIds = data.itemIds.filter(id=>!idsToAdd.includes(id));
    } else {
      const folder = { id:uid(), type:'folder', name:'Ordner', timestamp:Date.now(), itemIds:[targetId, ...idsToAdd] };
      data.items[folder.id] = folder;
      const idx = data.itemIds.indexOf(targetId);
      data.itemIds[idx] = folder.id;
      data.itemIds = data.itemIds.filter(id=>!idsToAdd.includes(id));
    }
    refreshItems();
    flipRenderGrid();
    persistState();
    showToast('Ordner erstellt');
  }

  function reorderItemAtPosition(draggedId, targetId, side){
    const data = dataOf(currentSpaceId);
    const fromIdx = data.itemIds.indexOf(draggedId);
    if(fromIdx===-1) return;
    mutationCheckpoint('content', currentSpaceId);
    data.itemIds.splice(fromIdx,1);
    let toIdx = data.itemIds.indexOf(targetId);
    if(toIdx===-1) toIdx = data.itemIds.length;
    else if(side==='after') toIdx += 1;
    data.itemIds.splice(toIdx,0,draggedId);
    refreshItems();
    flipRenderGrid();
    persistState();
  }

  function mergeIntoFolder(draggedId, targetId){
    if(draggedId===targetId) return;
    const data = dataOf(currentSpaceId);
    const targetItem = data.items[targetId];
    if(!targetItem || !data.items[draggedId]) return;
    mutationCheckpoint('content', currentSpaceId);
    if(targetItem.type === 'folder'){
      targetItem.itemIds.push(draggedId);
      data.itemIds = data.itemIds.filter(id=>id!==draggedId);
    } else {
      const folder = { id:uid(), type:'folder', name:'Ordner', timestamp:Date.now(), itemIds:[targetId, draggedId] };
      data.items[folder.id] = folder;
      const idx = data.itemIds.indexOf(targetId);
      data.itemIds[idx] = folder.id;
      data.itemIds = data.itemIds.filter(id=>id!==draggedId);
    }
    refreshItems();
    flipRenderGrid();
    persistState();
    showToast('Ordner erstellt');
  }
  function deleteFolder(folderId){
    const data = dataOf(currentSpaceId);
    const folder = data.items[folderId];
    if(!folder || folder.type!=='folder') return;
    mutationCheckpoint('content', currentSpaceId);
    if(folder){ for(const id of folder.itemIds){ delete data.items[id]; } }
    delete data.items[folderId];
    data.itemIds = data.itemIds.filter(id=>id!==folderId);
    refreshItems();
    if(folderContext && folderContext.id === folderId){ folderOverlay.classList.remove('show'); folderContext=null; }
    flipRenderGrid();
    persistState();
  }

  // ---------- folder view ----------
  let folderContext = null;
  function openFolder(folder){
    markRecent(folder,'open');
    folderContext = folder;
    folderTitleInput.value = displayName(folder);
    renderFolderGrid();
    folderOverlay.classList.add('show');
  }
  let lastFolderRenderSignature='';
  /**
   * Renders the open folder with the same no-op signature discipline as render().
   */
  function renderFolderGrid(force=false){
    if(!folderContext) return;
    const data=dataOf(currentSpaceId);
    const fresh=data.items[folderContext.id];
    if(fresh) folderContext=fresh;
    const inside=(folderContext.itemIds || []).map(id=>data.items[id]).filter(Boolean);
    const signature=[currentSpaceId,folderContext.id,inside.map(itemRenderFingerprint).join('|')].join('::');
    if(!force && signature===lastFolderRenderSignature) return;
    lastFolderRenderSignature=signature;
    if(!inside.length){
      const empty=document.createElement('p'); empty.className='folder-empty'; empty.textContent='Dieser Ordner ist leer.';
      folderGrid.replaceChildren(empty); return;
    }
    const fragment=document.createDocumentFragment();
    inside.forEach(item=>fragment.appendChild(buildCard(item,{insideFolder:true,folderId:folderContext.id})));
    folderGrid.replaceChildren(fragment);
  }
  function closeFolderOverlay(){
    folderOverlay.classList.remove('show');
    folderOverlay.classList.remove('storage-child-modal');
    folderContext=null;
    flipRenderGrid();
  }
  folderCloseBtn.addEventListener('click', closeFolderOverlay);
  folderOverlay.addEventListener('click', (e)=>{ if(e.target===folderOverlay) closeFolderOverlay(); });
  folderTitleInput.addEventListener('blur', ()=>{
    if(!folderContext) return;
    const val = folderTitleInput.value.trim();
    const nextCustomName = (val && val!==folderContext.name) ? val : undefined;
    if((folderContext.customName || undefined) === nextCustomName) return;
    mutationCheckpoint('content', currentSpaceId);
    folderContext.customName = nextCustomName;
    if(!folderContext.customName) delete folderContext.customName;
    persistState();
  });
  folderTitleInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') folderTitleInput.blur(); });
  folderZipBtn.addEventListener('click', ()=>{ if(folderContext) downloadFolderAsZip(folderContext); });
  folderDeleteBtn.addEventListener('click', ()=>{
    if(!folderContext) return;
    openDestructiveConfirm('Ordner löschen?', `"${displayName(folderContext)}" und alle ${folderContext.itemIds.length} enthaltenen Elemente werden dauerhaft gelöscht.`, 'Löschen', ()=>{
      deleteFolder(folderContext.id);
    });
  });
  folderDissolveBtn.addEventListener('click', ()=>{
    // dissolves immediately — no confirmation, per request
    if(!folderContext) return;
    const data = dataOf(currentSpaceId);
    const idx = data.itemIds.indexOf(folderContext.id);
    const nestedIds = folderContext.itemIds.slice();
    if(idx === -1){ showToast('Ordner nicht mehr vorhanden'); return; }
    mutationCheckpoint('content', currentSpaceId);
    data.itemIds.splice(idx, 1, ...nestedIds);
    delete data.items[folderContext.id];
    refreshItems();
    folderOverlay.classList.remove('show'); folderContext=null;
    flipRenderGrid();
    persistState();
    showToast('Ordner aufgelöst');
  });
  function removeFromFolder(itemId, folderId){
    const data = dataOf(currentSpaceId);
    const folder = data.items[folderId];
    if(!folder || !(folder.itemIds||[]).includes(itemId)) return;
    mutationCheckpoint('content', currentSpaceId);
    folder.itemIds = folder.itemIds.filter(id=>id!==itemId);
    if(folder.itemIds.length <= 1){
      const idx = data.itemIds.indexOf(folderId);
      data.itemIds.splice(idx, 1, ...folder.itemIds, itemId);
      delete data.items[folderId];
      refreshItems();
      folderOverlay.classList.remove('show'); folderContext=null;
      flipRenderGrid();
      persistState();
      showToast('Ordner aufgelöst');
    } else {
      if(!data.itemIds.includes(itemId)) data.itemIds.push(itemId);
      refreshItems();
      folderContext = folder;
      renderFolderGrid();
      persistState();
      showToast('Aus Ordner entfernt');
    }
  }
  function deleteItemFromFolder(itemId, folderId){
    const data = dataOf(currentSpaceId);
    const folder = data.items[folderId];
    if(!folder || !data.items[itemId]) return;
    mutationCheckpoint('content', currentSpaceId);
    folder.itemIds = folder.itemIds.filter(id=>id!==itemId);
    delete data.items[itemId];
    if(folder.itemIds.length === 0){
      data.itemIds = data.itemIds.filter(id=>id!==folderId);
      delete data.items[folderId];
      refreshItems();
      folderOverlay.classList.remove('show'); folderContext=null;
      flipRenderGrid();
    } else {
      renderFolderGrid();
    }
    persistState();
  }

  // ================= MUTATION POLICY + UNDO / REDO =================
  // Die Matrix trennt Nutzdaten, globale Board-Struktur, Einstellungen und passive Aktivität.
  // Nur echte Nutzdaten-/Strukturänderungen erzeugen einen Undo-Schritt.
  const MUTATION_POLICY = Object.freeze({
    content:    {history:'space',     persist:'required', recent:'optional'},
    crossSpace: {history:'boardData', persist:'required', recent:'optional'},
    board:      {history:'board',     persist:'required', recent:'none'},
    boardData:  {history:'boardData', persist:'required', recent:'none'},
    spaceMeta:  {history:'spaceMeta', persist:'required', recent:'none'},
    notes:      {history:'global',    persist:'required', recent:'none', fields:['helpNotes']},
    preference: {history:'none',      persist:'required', recent:'none'},
    activity:   {history:'none',  persist:'required', recent:'self'},
    system:     {history:'none',  persist:'managed',  recent:'none'}
  });

  const HISTORY_LIMIT = 20;
  let undoStack = [];
  let redoStack = [];

  function snapshotSpace(sid){
    return {scope:'space', sid, data:cloneJson(dataOf(sid))};
  }
  function snapshotBoard(restoreActive=true){
    const entry = {scope:restoreActive ? 'board' : 'boardData', spaces:cloneJson(state.spaces), data:cloneJson(state.data)};
    if(restoreActive) entry.activeSpaceId = state.activeSpaceId;
    return entry;
  }
  function snapshotSpaceMeta(){
    return {scope:'spaceMeta', spaces:cloneJson(state.spaces)};
  }
  function snapshotGlobal(fields){
    const values = {};
    fields.forEach(field=>{ values[field] = cloneJson(state[field]); });
    return {scope:'global', fields:[...fields], values};
  }
  function historySnapshotFor(entry){
    if(entry?.scope === 'board') return snapshotBoard(true);
    if(entry?.scope === 'boardData') return snapshotBoard(false);
    if(entry?.scope === 'spaceMeta') return snapshotSpaceMeta();
    if(entry?.scope === 'global') return snapshotGlobal(entry.fields || []);
    return snapshotSpace(entry?.sid || currentSpaceId);
  }
  function trimHistory(stack){
    if(stack.length > HISTORY_LIMIT) stack.splice(0, stack.length - HISTORY_LIMIT);
  }
  function pushUndo(target){
    let entry;
    if(target && typeof target === 'object' && target.scope === 'board') entry = snapshotBoard(true);
    else if(target && typeof target === 'object' && target.scope === 'boardData') entry = snapshotBoard(false);
    else if(target && typeof target === 'object' && target.scope === 'spaceMeta') entry = snapshotSpaceMeta();
    else if(target && typeof target === 'object' && target.scope === 'global') entry = snapshotGlobal(target.fields || []);
    else if(target && typeof target === 'object' && target.scope === 'space') entry = snapshotSpace(target.sid || currentSpaceId);
    else entry = snapshotSpace(typeof target === 'string' ? target : currentSpaceId);
    undoStack.push(entry);
    trimHistory(undoStack);
    // Jede neue Bearbeitung startet einen neuen Verlaufspfad.
    redoStack = [];
  }
  /**
   * Creates one logical Undo checkpoint according to MUTATION_POLICY.
   * Batch operations must call this once for the complete user action.
   */
  function mutationCheckpoint(kind='content', sid=currentSpaceId){
    const policy = MUTATION_POLICY[kind] || MUTATION_POLICY.content;
    if(policy.history === 'board') pushUndo({scope:'board'});
    else if(policy.history === 'boardData') pushUndo({scope:'boardData'});
    else if(policy.history === 'spaceMeta') pushUndo({scope:'spaceMeta'});
    else if(policy.history === 'global') pushUndo({scope:'global', fields:policy.fields || []});
    else if(policy.history === 'space') pushUndo({scope:'space', sid});
  }
  function refreshAfterHistoryRestore(entry){
    syncFromState();
    selectedIds.clear(); lastSelectedId = null;
    selectionBar.classList.remove('show');
    const active = currentSpace();
    if(active) titleInput.value = active.name;
    renderTabs();
    applyViewMode();
    refreshItems();
    flipRenderGrid();
    if(folderContext){
      const freshFolder = dataOf(currentSpaceId).items?.[folderContext.id];
      if(freshFolder?.type === 'folder'){ folderContext = freshFolder; renderFolderGrid(); }
      else { folderOverlay.classList.remove('show'); folderContext = null; }
    }
    if(helpOverlay.classList.contains('show')){ syncHelpSettings(); renderHelpNotes(); }
    if(favoritesOverlay.classList.contains('show')) openFavorites();
    if(recentOverlay.classList.contains('show')) renderRecentItems();
  }
  function restoreHistoryEntry(entry){
    if(entry.scope === 'board' || entry.scope === 'boardData'){
      state = normalizeState({
        ...state,
        spaces:cloneJson(entry.spaces),
        data:cloneJson(entry.data),
        activeSpaceId:entry.scope === 'board' ? entry.activeSpaceId : state.activeSpaceId
      });
    } else if(entry.scope === 'spaceMeta'){
      state = normalizeState({...state, spaces:cloneJson(entry.spaces), activeSpaceId:state.activeSpaceId});
    } else if(entry.scope === 'global'){
      (entry.fields || []).forEach(field=>{ state[field] = cloneJson(entry.values?.[field]); });
      state = normalizeState(state);
    } else {
      state.data[entry.sid] = normalizeSpaceData(cloneJson(entry.data));
    }
    refreshAfterHistoryRestore(entry);
    persistState();
  }
  function undoLast(){
    const entry = undoStack.pop();
    if(!entry){ showToast('Nichts zum Rückgängigmachen'); return; }
    redoStack.push(historySnapshotFor(entry));
    trimHistory(redoStack);
    restoreHistoryEntry(entry);
    showToast('Rückgängig gemacht');
  }
  function redoLast(){
    const entry = redoStack.pop();
    if(!entry){ showToast('Nichts zum Wiederherstellen'); return; }
    undoStack.push(historySnapshotFor(entry));
    trimHistory(undoStack);
    restoreHistoryEntry(entry);
    showToast('Wiederhergestellt');
  }

  // ================= EXPORT / IMPORT =================
  function cloneJson(value){ return JSON.parse(JSON.stringify(value)); }
  function isPlainObject(value){ return !!value && typeof value === 'object' && !Array.isArray(value); }
  function isValidSpaceData(value){
    if(!isPlainObject(value) || !Array.isArray(value.itemIds) || !isPlainObject(value.items)) return false;
    const topIds = value.itemIds;
    if(new Set(topIds).size !== topIds.length) return false;
    if(!topIds.every(id=>typeof id === 'string' && isPlainObject(value.items[id]))) return false;
    for(const [id,item] of Object.entries(value.items)){
      if(!isPlainObject(item) || typeof id !== 'string') return false;
      if(item.id != null && item.id !== id) return false;
      if(typeof item.type !== 'string') return false;
      if(item.type === 'folder'){
        if(!Array.isArray(item.itemIds) || new Set(item.itemIds).size !== item.itemIds.length) return false;
        if(item.itemIds.includes(id)) return false;
        if(!item.itemIds.every(childId=>typeof childId === 'string' && isPlainObject(value.items[childId]))) return false;
      }
    }
    return true;
  }
  function isValidBoardState(value){
    if(!isPlainObject(value) || !Array.isArray(value.spaces) || !value.spaces.length || !isPlainObject(value.data)) return false;
    if(Number.isInteger(value.schemaVersion) && value.schemaVersion > STATE_SCHEMA_VERSION) return false;
    const ids = value.spaces.map(sp=>sp && sp.id);
    if(new Set(ids).size !== ids.length) return false;
    return value.spaces.every(sp=>isPlainObject(sp) && typeof sp.id === 'string' && typeof sp.name === 'string' && isValidSpaceData(value.data[sp.id]));
  }
  function importSummary(importedState){
    let cards = 0, folders = 0;
    for(const sp of importedState.spaces || []){
      const d = importedState.data?.[sp.id];
      for(const item of Object.values(d?.items || {})){
        if(item?.type === 'folder') folders++; else if(item) cards++;
      }
    }
    return { spaces:(importedState.spaces || []).length, cards, folders, bytes:estimateBytes(importedState) };
  }
  function savePreImportRecovery(){
    if(!storageAvailable) return false;
    try{
      localStorage.setItem(PREIMPORT_RECOVERY_KEY, JSON.stringify({ savedAt:Date.now(), state:cloneJson(state) }));
      return true;
    }catch(e){ return false; }
  }
  function loadPreImportRecovery(){
    if(!storageAvailable) return null;
    try{
      const raw = localStorage.getItem(PREIMPORT_RECOVERY_KEY);
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      if(!parsed || !isValidBoardState(parsed.state)) return null;
      return {...parsed, state:normalizeState(parsed.state)};
    }catch(e){ return null; }
  }
  function clearPreImportRecovery(){
    try{ localStorage.removeItem(PREIMPORT_RECOVERY_KEY); }catch(e){}
  }
  function restorePreImportRecovery(){
    const recovery = loadPreImportRecovery();
    if(!recovery){ showToast('Kein Wiederherstellungspunkt vorhanden'); return; }
    const stamp = new Date(recovery.savedAt).toLocaleString('de-DE');
    openConfirm('Stand vor Import wiederherstellen?', `Der aktuelle Stand wird durch die lokale Sicherung vom ${stamp} ersetzt.`, 'Wiederherstellen', ()=>{
      state = normalizeState(cloneJson(recovery.state));
      syncFromState(); applyViewMode(); titleInput.value = currentSpace().name;
      renderTabs(); refreshItems(); render(); persistState({immediate:true, force:true}); clearPreImportRecovery();
      showToast('Stand vor Import wiederhergestellt');
    });
  }
  function uniqueSpaceName(baseName){
    const clean = (baseName || 'Importierter Space').trim() || 'Importierter Space';
    const existing = new Set(spaces.map(sp=>sp.name.toLowerCase()));
    if(!existing.has(clean.toLowerCase())) return clean;
    let i = 2;
    while(existing.has((clean+' ('+i+')').toLowerCase())) i++;
    return clean+' ('+i+')';
  }
  function importSpacePayload(payload){
    if(!isPlainObject(payload) || payload.format !== 'copyboard-space' || !isValidSpaceData(payload.data)){
      showToast('Ungültige Space-Datei');
      return;
    }
    const importedName = uniqueSpaceName(payload.name);
    openConfirm('Space importieren?', `„${importedName}“ wird als neuer Space ergänzt. Dein aktuelles Board bleibt erhalten.`, 'Importieren', async ()=>{
      const newId = uid();
      const importedData = normalizeSpaceData(cloneJson(payload.data));
      state.data[newId] = importedData;
      const newSpace = { id:newId, name:importedName, sortMode:defaultSortModeSetting() };
      if(typeof payload.color === 'string' && payload.color) newSpace.color = payload.color;
      spaces.push(newSpace);
      state.spaces = spaces;
      persistState();
      await switchSpace(newId);
      showToast('Space importiert');
    });
  }
  function exportBackup(){
    const payload = { format:'copyboard-backup', version:1, stateSchemaVersion:STATE_SCHEMA_VERSION, exportedAt:new Date().toISOString(), state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    a.href = url; a.download = 'copyboard-backup-'+stamp+'.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
    showToast('Backup heruntergeladen');
  }
  function importBoardState(importedState, meta={}){
    if(!isValidBoardState(importedState)){ showToast('Ungültige Backup-Datei'); return; }
    let normalizedImport;
    try{ normalizedImport = normalizeState(cloneJson(importedState)); }
    catch(e){ showToast('Nicht unterstützte State-Version'); return; }
    const summary = importSummary(normalizedImport);
    if(summary.bytes > MAX_TOTAL_BYTES){ showToast('Backup überschreitet das 20-MB-Board-Limit'); return; }
    const exported = meta.exportedAt ? ` · Export: ${new Date(meta.exportedAt).toLocaleString('de-DE')}` : '';
    const msg = `${summary.spaces} Space${summary.spaces===1?'':'s'}, ${summary.cards} Karte${summary.cards===1?'':'n'}, ${summary.folders} Ordner · ${fmtSize(summary.bytes)}${exported}. Der aktuelle Stand wird ersetzt und vorher lokal gesichert.`;
    openConfirm('Board importieren?', msg, 'Sichern & importieren', ()=>{
      const recoverySaved = savePreImportRecovery();
      state = normalizedImport;
      syncFromState();
      applyViewMode();
      titleInput.value = currentSpace().name;
      renderTabs();
      refreshItems();
      render();
      persistState();
      showToast(recoverySaved ? 'Board importiert · Rückkehr möglich' : 'Board importiert');
    });
  }
  function importBackupFile(file){
    if(!file) return;
    if(file.size > MAX_IMPORT_FILE_BYTES){ showToast('Importdatei ist zu groß'); return; }
    if(file.type && !['application/json','text/json','text/plain'].includes(file.type) && !file.name.toLowerCase().endsWith('.json')){
      showToast('Bitte eine JSON-Datei auswählen'); return;
    }
    const reader = new FileReader();
    reader.onerror = ()=>showToast('Konnte Datei nicht lesen');
    reader.onload = ()=>{
      let parsed;
      try{ parsed = JSON.parse(reader.result); }catch(e){ showToast('Ungültiges JSON'); return; }

      if(parsed && parsed.format === 'copyboard-space'){
        importSpacePayload(parsed);
        return;
      }
      if(parsed && parsed.format === 'copyboard-backup'){
        if(!Number.isFinite(parsed.version) || parsed.version < 1){ showToast('Unbekannte Backup-Version'); return; }
        importBoardState(parsed.state, parsed);
        return;
      }
      // Backward compatibility: V16–V22 exported the raw board state without a format wrapper.
      if(isValidBoardState(parsed)){
        importBoardState(parsed, {legacy:true});
        return;
      }
      showToast('Ungültiges CopyBoard-Format');
    };
    reader.readAsText(file);
  }
  importFileInput.addEventListener('change', (e)=>{ importBackupFile(e.target.files[0]); importFileInput.value=''; });

  // ================= SPACE COLOR LABELS =================
  const SPACE_COLORS = ['#4f6bff','#ff6b57','#f5a623','#22b07d','#8a76ff','#ec4899','#64748b'];
  function openColorPicker(dotEl, sp){
    const rect = dotEl.getBoundingClientRect();
    const fromDropdown = !!dotEl.closest?.('#tabsDropdown');
    const applyColor = (color)=>{
      const nextColor = color || null;
      const currentColor = sp.color || null;
      if(nextColor === currentColor) return;
      mutationCheckpoint('spaceMeta');
      if(color) sp.color = color; else delete sp.color;
      persistState(); renderTabs();
      if(fromDropdown){
        dropdownOpen = true;
        tabsDropdown.classList.add('show');
        tabOverflowBtn.classList.add('open');
      }
    };
    const rows = SPACE_COLORS.map(c=>({
      icon:`<span style="width:14px;height:14px;border-radius:50%;background:${c};display:inline-block;"></span>`,
      label:'Farbe',
      onClick:()=>applyColor(c)
    }));
    rows.push({sep:true});
    rows.push({icon:'<span style="width:14px;height:14px;border-radius:50%;border:2px solid #c7cbd3;display:inline-block;"></span>', label:'Kein Label', onClick:()=>applyColor(null)});
    showContextMenu(rect.left, rect.bottom+6, rows);
  }

  // ================= COMMAND PALETTE (search + actions) =================
  let paletteItems = [], paletteActiveIndex = 0;
  function buildPaletteActions(){
    const acts = [];
    const add = (group, item)=>acts.push({...item, group});

    // Frequently used: fast creation and history controls first.
    add('Häufig verwendet', {icon:ICONS.paste, label:'Zwischenablage einfügen', keywords:'einfügen paste text', onClick:()=>{ closePalette(); openTextModal(); }});
    add('Häufig verwendet', {icon:ICONS.star, label:'Favoriten öffnen', keywords:'favoriten stern wichtig gespeichert', onClick:()=>{ closePalette(); openFavorites(); }});
    add('Häufig verwendet', {icon:'◷', label:'Zuletzt verwendet', keywords:'verlauf zuletzt geöffnet kopiert bearbeitet recent history', onClick:()=>{ closePalette(); openRecentItems(); }});
    add('Häufig verwendet', {icon:ICONS.plus, label:'Neuer Space', keywords:'board bereich erstellen', onClick:()=>{ closePalette(); addSpace(); }});
    add('Häufig verwendet', {icon:'↩︎', label:'Rückgängig', sub:'⌘/Strg+Z', keywords:'undo zurück', onClick:()=>{ closePalette(); undoLast(); }});
    add('Häufig verwendet', {icon:'↪︎', label:'Wiederherstellen', sub:'⌘/Strg+Umschalt+Z', keywords:'redo wiederholen', onClick:()=>{ closePalette(); redoLast(); }});

    spaces.forEach(s=>{
      if(s.id!==currentSpaceId) add('Navigation', {icon:ICONS.move, label:'Wechseln zu: '+s.name, keywords:'space board öffnen navigation', onClick:()=>{ closePalette(); switchSpace(s.id); }});
    });

    Object.entries(SORT_MODES).forEach(([mode,label])=>{
      add('Organisieren', {icon:'↕', label:'Sortieren: '+label+(currentSortMode()===mode?' ✓':''), keywords:'reihenfolge ordnen', onClick:()=>{ closePalette(); setSortMode(mode); }});
    });
    add('Organisieren', {icon:ICONS.trash, label:'Space leeren', keywords:'alles löschen board', onClick:()=>{ closePalette(); clearBtn.click(); }});

    add('Ansicht', {icon:ICONS.grid, label:'Kachelansicht', keywords:'grid raster ansicht', onClick:()=>{ closePalette(); setViewMode('grid'); }});
    add('Ansicht', {icon:ICONS.list, label:'Listenansicht', keywords:'liste ansicht', onClick:()=>{ closePalette(); setViewMode('list'); }});

    add('Organisieren', {icon:ICONS.duplicate, label:'Duplikate prüfen', keywords:'doppelt identisch mehrfach duplicate', onClick:()=>{ closePalette(); openDuplicateAudit(); }});

    add('Sichern & Verwalten', {icon:'◔', label:'Speicherstatus', keywords:'speicher verwaltung größe', onClick:()=>{ closePalette(); openStorageStatus(); }});
    add('Sichern & Verwalten', {icon:'💾', label:'Board exportieren (Backup)', keywords:'sichern backup herunterladen export', onClick:()=>{ closePalette(); exportBackup(); }});
    add('Sichern & Verwalten', {icon:'📥', label:'Board importieren', keywords:'backup laden import wiederherstellen', onClick:()=>{ closePalette(); importFileInput.click(); }});
    if(loadPreImportRecovery()) add('Sichern & Verwalten', {icon:'↶', label:'Stand vor letztem Import wiederherstellen', keywords:'recovery rückweg import', onClick:()=>{ closePalette(); restorePreImportRecovery(); }});
    add('Sichern & Verwalten', {icon:'🧠', label:'AutoSave '+(memoryProtectionOn?'ausschalten':'einschalten'), keywords:'speichern lokal temporär', onClick:()=>{ closePalette(); memoryToggle.click(); }});

    add('Hilfe', {icon:'❔', label:'Hilfe öffnen', keywords:'anleitung shortcuts einstellungen', onClick:()=>{ closePalette(); openHelp('start'); }});
    return acts;
  }
  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, ch=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }
  function normalizeSearchValue(value){
    return String(value ?? '').toLocaleLowerCase('de-DE');
  }
  function compactSearchSnippet(value, query, maxLength=92){
    const raw = String(value ?? '').replace(/\s+/g,' ').trim();
    if(!raw) return '';
    const lower = normalizeSearchValue(raw);
    const q = normalizeSearchValue(query);
    const hit = lower.indexOf(q);
    if(hit < 0) return raw.length > maxLength ? raw.slice(0,maxLength-1)+'…' : raw;
    const flank = Math.max(18, Math.floor((maxLength-q.length)/2));
    const start = Math.max(0, hit-flank);
    const end = Math.min(raw.length, hit+q.length+flank);
    return (start>0?'…':'') + raw.slice(start,end) + (end<raw.length?'…':'');
  }
  function searchableItemFields(item, sp, folder){
    const fields = [
      {key:'name', label:'Name', value:displayName(item)},
      {key:'space', label:'Space', value:sp.name},
      {key:'folder', label:'Ordner', value:folder ? displayName(folder) : ''},
      {key:'type', label:'Typ', value:[item.type, item.mime, item.name].filter(Boolean).join(' ')},
      {key:'favorite', label:'Status', value:item.favorite ? 'Favorit Favoriten Stern wichtig' : ''},
    ];
    if(item.type === 'text') fields.push({key:'content', label:'Inhalt', value:item.data || ''});
    if(item.customName && item.customName !== item.name) fields.push({key:'original', label:'Dateiname', value:item.name || ''});
    return fields;
  }
  function scoreSearchField(field, query){
    const value = normalizeSearchValue(field.value);
    const q = normalizeSearchValue(query);
    if(!value || !q) return 0;
    if(value === q) return field.key==='name' ? 120 : 95;
    if(value.startsWith(q)) return field.key==='name' ? 100 : 78;
    if(value.includes(q)) return field.key==='name' ? 82 : (field.key==='content' ? 62 : 68);
    const words = q.split(/\s+/).filter(Boolean);
    if(words.length > 1 && words.every(word=>value.includes(word))) return field.key==='content' ? 48 : 54;
    return 0;
  }
  function buildPaletteCardResults(query){
    if(!query) return [];
    const results = [];
    spaces.forEach(sp=>{
      const d = state.data[sp.id];
      if(!d) return;
      const nestedIn = new Map();
      Object.values(d.items || {}).forEach(candidate=>{
        if(candidate?.type !== 'folder') return;
        (candidate.itemIds || []).forEach(childId=>nestedIn.set(childId, candidate));
      });
      Object.values(d.items || {}).forEach(it=>{
        if(!it) return;
        const folder = nestedIn.get(it.id) || null;
        const fields = searchableItemFields(it, sp, folder);
        const matches = fields.map(field=>({field, score:scoreSearchField(field, query)})).filter(match=>match.score>0).sort((a,b)=>b.score-a.score);
        if(!matches.length) return;
        const best = matches[0];
        const location = folder ? `${sp.name} · ${displayName(folder)}` : sp.name;
        const matchText = best.field.key==='name' ? '' : `${best.field.label}: ${compactSearchSnippet(best.field.value, query)}`;
        results.push({
          icon: it.type==='folder' ? ICONS.folderOpen : ICONS.preview,
          label: displayName(it), sub: location, match:matchText, score:best.score,
          onClick: ()=>{
            closePalette();
            switchSpace(sp.id);
            setTimeout(()=>{
              if(folder){
                openFolder(folder);
                setTimeout(()=>{
                  const target = folderGrid.querySelector(`[data-id="${it.id}"]`);
                  if(target){ target.scrollIntoView({block:'center'}); target.animate([{outline:'3px solid var(--accent)',outlineOffset:'3px'},{outline:'0 solid transparent',outlineOffset:'0'}],{duration:900,easing:'ease-out'}); }
                },80);
              } else {
                it.type==='folder' ? openFolder(it) : openPreview(it);
              }
            }, 60);
          }
        });
      });
    });
    return results.sort((a,b)=>b.score-a.score || a.label.localeCompare(b.label,'de')).slice(0,50);
  }
  function renderPalette(){
    const q = paletteInput.value.trim();
    const normalizedQuery = normalizeSearchValue(q);
    const actions = buildPaletteActions().filter(a=> !q || normalizeSearchValue([a.label,a.keywords,a.group].filter(Boolean).join(' ')).includes(normalizedQuery));
    const cards = buildPaletteCardResults(q);
    paletteItems = q ? [...cards, ...actions] : actions;
    paletteActiveIndex = 0;
    paletteResults.innerHTML = '';
    if(!paletteItems.length){
      const p = document.createElement('div'); p.className='palette-empty'; p.textContent='Keine Treffer'; paletteResults.appendChild(p); return;
    }
    let lastGroup = null;
    paletteItems.forEach((it,i)=>{
      if(!q && it.group && it.group !== lastGroup){
        const heading = document.createElement('div');
        heading.className = 'palette-group-label';
        heading.textContent = it.group;
        paletteResults.appendChild(heading);
        lastGroup = it.group;
      }
      const row = document.createElement('div');
      row.className = 'palette-row' + (i===paletteActiveIndex?' active':'');
      row.dataset.paletteIndex = String(i);
      row.innerHTML = `<span class="p-icon">${it.icon}</span><span class="p-main"><span class="p-label">${escapeHtml(it.label)}</span>${it.match?`<span class="p-match">${escapeHtml(it.match)}</span>`:''}</span>${it.sub?`<span class="p-sub">${escapeHtml(it.sub)}</span>`:''}`;
      row.addEventListener('click', it.onClick);
      row.addEventListener('mouseenter', ()=>{ paletteActiveIndex=i; updatePaletteActive(); });
      paletteResults.appendChild(row);
    });
  }
  function updatePaletteActive(){ paletteResults.querySelectorAll('.palette-row').forEach(el=>el.classList.toggle('active', Number(el.dataset.paletteIndex)===paletteActiveIndex)); }
  function scrollActiveIntoView(){ const el = paletteResults.querySelector(`.palette-row[data-palette-index="${paletteActiveIndex}"]`); if(el) el.scrollIntoView({block:'nearest'}); }
  function openPalette(){ paletteInput.value=''; paletteOverlay.classList.add('show'); renderPalette(); setTimeout(()=>paletteInput.focus(), 30); }
  function closePalette(){ paletteOverlay.classList.remove('show'); }
  function togglePalette(){ paletteOverlay.classList.contains('show') ? closePalette() : openPalette(); }
  paletteInput.addEventListener('input', renderPalette);
  paletteInput.addEventListener('keydown', (e)=>{
    if(e.key==='ArrowDown'){ e.preventDefault(); paletteActiveIndex=Math.min(paletteActiveIndex+1, paletteItems.length-1); updatePaletteActive(); scrollActiveIntoView(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); paletteActiveIndex=Math.max(paletteActiveIndex-1,0); updatePaletteActive(); scrollActiveIntoView(); }
    else if(e.key==='Enter'){ e.preventDefault(); const it=paletteItems[paletteActiveIndex]; if(it) it.onClick(); }
  });
  paletteOverlay.addEventListener('click', (e)=>{ if(e.target===paletteOverlay) closePalette(); });
  searchOpenBtn.addEventListener('click', openPalette);
  paletteHelpBtn.addEventListener('click', ()=>{
    closePalette();
    openHelp('start');
  });

  // ================= QUICK LOOK (spacebar) =================
  let hoveredCardItem = null;

  // ================= GLOBAL SHORTCUTS =================
  document.addEventListener('keydown', (e)=>{
    const tag = document.activeElement && document.activeElement.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';
    if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); togglePalette(); return; }
    if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='z' && e.shiftKey && !typing){ e.preventDefault(); redoLast(); return; }
    if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='y' && !typing){ e.preventDefault(); redoLast(); return; }
    if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='z' && !typing){ e.preventDefault(); undoLast(); return; }
    if(e.code === 'Space' && !typing && hoveredCardItem && !paletteOverlay.classList.contains('show')){
      e.preventDefault();
      hoveredCardItem.type==='folder' ? openFolder(hoveredCardItem) : openPreview(hoveredCardItem);
    }
  });

  // ================= PIN =================
  function togglePin(item){
    mutationCheckpoint('content', currentSpaceId);
    item.pinned = !item.pinned;
    persistState();
    refreshItems();
    flipRenderGrid();
    showToast(item.pinned ? 'Angeheftet' : 'Gelöst');
  }

  // ================= EDIT CONTENT =================
  let editTextContext = null;
  let editImageContext = null;
  let editImageState = { rotation:0, flipH:false, flipV:false, img:null };

  function openEditContent(item, ctx){
    if(item.type === 'text'){
      editTextContext = { item, ctx };
      textOverlayTitle.textContent = 'Inhalt bearbeiten';
      textArea.value = item.data;
      textOverlay.classList.add('show');
      setTimeout(()=>{ textArea.focus(); }, 50);
    } else if(item.type === 'image'){
      editImageContext = { item, ctx };
      editImageState = { rotation:0, flipH:false, flipV:false, img:null };
      const img = new Image();
      img.onload = ()=>{ editImageState.img = img; drawImageEditCanvas(); imageEditOverlay.classList.add('show'); };
      img.src = item.data;
    } else {
      editContextForReplace = { item, ctx };
      replaceFileInput.click();
    }
  }

  // ---- text edit (shares the textOverlay with "add text") ----
  textOkBtn.addEventListener('click', ()=>{
    const val = textArea.value;
    textOverlay.classList.remove('show');
    if(editTextContext){
      const { item, ctx } = editTextContext;
      mutationCheckpoint('content', currentSpaceId);
      item.data = val;
      item.size = new Blob([val]).size;
      if(!item.customName) item.name = val.trim().slice(0,40) + (val.trim().length>40 ? '…' : '');
      editTextContext = null;
      textOverlayTitle.textContent = 'Zwischenablage einfügen';
      persistState();
      markRecent(item,'edit',ctx && ctx.insideFolder ? ctx.folderId : null);
      if(ctx && ctx.insideFolder){ renderFolderGrid(); } else { refreshItems(); render(); }
      showToast('Gespeichert');
    } else {
      ingestText(val);
    }
  });
  textCancelBtn.addEventListener('click', ()=>{ editTextContext = null; textOverlayTitle.textContent = 'Zwischenablage einfügen'; });

  // ---- image edit (canvas rotate/flip) ----
  function drawImageEditCanvas(){
    const { img, rotation, flipH, flipV } = editImageState;
    const rad = rotation * Math.PI/180;
    const swapped = rotation % 180 !== 0;
    const w = swapped ? img.height : img.width;
    const h = swapped ? img.width : img.height;
    imageEditCanvas.width = w; imageEditCanvas.height = h;
    const ctx2d = imageEditCanvas.getContext('2d');
    ctx2d.save();
    ctx2d.translate(w/2, h/2);
    ctx2d.rotate(rad);
    ctx2d.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx2d.drawImage(img, -img.width/2, -img.height/2);
    ctx2d.restore();
  }
  rotateLeftBtn.addEventListener('click', ()=>{ editImageState.rotation = (editImageState.rotation - 90 + 360) % 360; drawImageEditCanvas(); });
  rotateRightBtn.addEventListener('click', ()=>{ editImageState.rotation = (editImageState.rotation + 90) % 360; drawImageEditCanvas(); });
  flipHBtn.addEventListener('click', ()=>{ editImageState.flipH = !editImageState.flipH; drawImageEditCanvas(); });
  flipVBtn.addEventListener('click', ()=>{ editImageState.flipV = !editImageState.flipV; drawImageEditCanvas(); });
  imageEditCancelBtn.addEventListener('click', ()=>{ imageEditOverlay.classList.remove('show'); editImageContext=null; });
  imageEditOverlay.addEventListener('click', (e)=>{ if(e.target===imageEditOverlay){ imageEditOverlay.classList.remove('show'); editImageContext=null; } });
  imageEditSaveBtn.addEventListener('click', ()=>{
    if(!editImageContext) return;
    const { item, ctx } = editImageContext;
    mutationCheckpoint('content', currentSpaceId);
    const dataUrl = imageEditCanvas.toDataURL(item.mime && item.mime.includes('png') ? 'image/png' : 'image/jpeg', 0.92);
    item.data = dataUrl;
    item.size = Math.round(dataUrl.length * 0.75);
    imageEditOverlay.classList.remove('show');
    editImageContext = null;
    markRecent(item,'edit');
    if(ctx && ctx.insideFolder){ renderFolderGrid(); } else { refreshItems(); render(); }
    showToast('Bild gespeichert');
  });

  // ---- file replace (re-upload swaps content in place) ----
  let editContextForReplace = null;
  replaceFileInput.addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    replaceFileInput.value = '';
    if(!file || !editContextForReplace) return;
    if(file.size > MAX_FILE_BYTES){ showToast(`"${file.name}" ist zu groß (max. ${fmtSize(MAX_FILE_BYTES)})`); return; }
    const { item, ctx } = editContextForReplace;
    editContextForReplace = null;
    try{
      const dataUrl = await fileToDataURL(file);
      mutationCheckpoint('content', currentSpaceId);
      item.data = dataUrl;
      item.name = file.name || item.name;
      item.mime = file.type || item.mime;
      item.size = file.size;
      item.type = file.type && file.type.startsWith('image/') ? 'image' : 'file';
      markRecent(item,'edit');
      if(ctx && ctx.insideFolder){ renderFolderGrid(); } else { refreshItems(); render(); }
      showToast('Datei ersetzt');
    }catch(err){ showToast('Konnte Datei nicht lesen'); }
  });

  // ================= VOICE MEMO =================
  let mediaRecorder = null, recordedChunks = [];
  function blobToDataURL(blob){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(blob); }); }
  async function startRecording(){
    try{
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e=>{ if(e.data.size>0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = async ()=>{
        stream.getTracks().forEach(t=>t.stop());
        const blob = new Blob(recordedChunks, {type:'audio/webm'});
        const dataUrl = await blobToDataURL(blob);
        addItem({ id:uid(), type:'file', name:'Sprachmemo '+new Date().toLocaleTimeString('de-DE').slice(0,5).replace(':','-')+'.webm', mime:'audio/webm', size:blob.size, timestamp:Date.now(), data:dataUrl });
        showToast('Sprachmemo gespeichert');
      };
      mediaRecorder.start();
      micBtn.classList.add('recording');
      showToast('Aufnahme läuft — nochmal klicken zum Stoppen');
    }catch(e){ showToast('Mikrofonzugriff nicht möglich'); }
  }
  function stopRecording(){ if(mediaRecorder && mediaRecorder.state!=='inactive'){ mediaRecorder.stop(); } micBtn.classList.remove('recording'); }
  micBtn.addEventListener('click', ()=>{
    if(mediaRecorder && mediaRecorder.state==='recording'){ stopRecording(); } else { startRecording(); }
  });

  // ================= COLOR PALETTE EXTRACTION =================
  function hexToRgb(hex){ const v=parseInt(hex.slice(1),16); return {r:(v>>16)&255,g:(v>>8)&255,b:v&255}; }
  function colorDist(hex1,hex2){
    const a=hexToRgb(hex1), b=hexToRgb(hex2);
    return Math.sqrt((a.r-b.r)**2 + (a.g-b.g)**2 + (a.b-b.b)**2);
  }
  function extractPalette(item, n){
    n = n || 6;
    return new Promise((resolve, reject)=>{
      const img = new Image();
      img.onload = ()=>{
        const size = 80;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const cctx = canvas.getContext('2d');
        cctx.drawImage(img, 0, 0, size, size);
        let data;
        try{ data = cctx.getImageData(0,0,size,size).data; }catch(e){ reject(e); return; }
        const buckets = {};
        for(let i=0;i<data.length;i+=4){
          const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
          if(a<125) continue;
          const key = [Math.round(r/24)*24, Math.round(g/24)*24, Math.round(b/24)*24].join(',');
          buckets[key] = (buckets[key]||0)+1;
        }
        const sorted = Object.entries(buckets).sort((a,b)=>b[1]-a[1]);
        const colors = [];
        for(const [key] of sorted){
          const [r,g,b] = key.split(',').map(Number);
          const hex = '#'+[r,g,b].map(v=>Math.min(255,v).toString(16).padStart(2,'0')).join('');
          if(!colors.some(c=>colorDist(c,hex)<28)) colors.push(hex);
          if(colors.length >= n) break;
        }
        resolve(colors);
      };
      img.onerror = reject;
      img.src = item.data;
    });
  }
  let currentPaletteColors = [];
  async function openPaletteExtract(item){
    let colors;
    try{ colors = await extractPalette(item, 6); }catch(e){ showToast('Farbpalette konnte nicht erstellt werden'); return; }
    currentPaletteColors = colors;
    paletteSwatches.innerHTML = '';
    colors.forEach(hex=>{
      const sw = document.createElement('div'); sw.className='swatch';
      sw.innerHTML = `<div class="sw-color" style="background:${hex}"></div><div class="sw-hex">${hex}</div>`;
      sw.addEventListener('click', ()=>{ navigator.clipboard.writeText(hex).then(()=>showToast(hex+' kopiert')).catch(()=>showToast('Kopieren fehlgeschlagen')); });
      paletteSwatches.appendChild(sw);
    });
    paletteExtractOverlay.classList.add('show');
  }
  paletteExtractCloseBtn.addEventListener('click', ()=>paletteExtractOverlay.classList.remove('show'));
  paletteExtractOverlay.addEventListener('click', (e)=>{ if(e.target===paletteExtractOverlay) paletteExtractOverlay.classList.remove('show'); });
  paletteExtractSaveBtn.addEventListener('click', ()=>{
    paletteExtractOverlay.classList.remove('show');
    if(currentPaletteColors.length) ingestText(currentPaletteColors.join('\n'));
  });

  // ================= OCR =================
  async function runOcr(item){
    if(typeof Tesseract === 'undefined'){ showToast('OCR nicht verfügbar (kein Internet?)'); return; }
    showToast('Texterkennung läuft…');
    try{
      const result = await Tesseract.recognize(item.data, 'deu+eng');
      const text = (result && result.data && result.data.text || '').trim();
      if(!text){ showToast('Kein Text erkannt'); return; }
      addItem({ id:uid(), type:'text', name:text.slice(0,40)+(text.length>40?'…':''), mime:'text/plain', size:new Blob([text]).size, timestamp:Date.now(), data:text });
      showToast('Text erkannt und abgelegt');
    }catch(e){ showToast('Texterkennung fehlgeschlagen'); }
  }

  // ================= PIN PROMPT (generic) =================
  let pinResolve = null;
  function askPin(title){
    return new Promise((resolve)=>{
      pinResolve = resolve;
      pinOverlayTitle.textContent = title;
      pinInput.value = '';
      pinError.style.display = 'none';
      pinOverlay.classList.add('show');
      setTimeout(()=>pinInput.focus(), 60);
    });
  }
  function resolvePin(val){ pinOverlay.classList.remove('show'); const r=pinResolve; pinResolve=null; if(r) r(val); }
  pinOkBtn.addEventListener('click', ()=> resolvePin(pinInput.value));
  pinCancelBtn.addEventListener('click', ()=> resolvePin(null));
  pinInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') resolvePin(pinInput.value); });
  pinOverlay.addEventListener('click', (e)=>{ if(e.target===pinOverlay) resolvePin(null); });

  // ================= PIN-PROTECTED CARDS (Web Crypto AES-GCM) =================
  function bufToBase64(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))); }
  function base64ToBuf(b64){ const bin=atob(b64); const arr=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i); return arr.buffer; }
  async function deriveKey(pin, saltBytes){
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name:'PBKDF2', salt:saltBytes, iterations:150000, hash:'SHA-256' },
      keyMaterial, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']
    );
  }
  async function encryptItemWithPin(item, pin){
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pin, salt);
    const plainBuf = new TextEncoder().encode(item.data);
    const cipherBuf = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, plainBuf);
    item.encData = { cipher:bufToBase64(cipherBuf), iv:bufToBase64(iv), salt:bufToBase64(salt) };
    item.lockedType = item.type;
    item.data = null;
    item.locked = true;
  }
  async function decryptItemWithPin(item, pin){
    const salt = new Uint8Array(base64ToBuf(item.encData.salt));
    const iv = new Uint8Array(base64ToBuf(item.encData.iv));
    const key = await deriveKey(pin, salt);
    const cipherBuf = base64ToBuf(item.encData.cipher);
    const plainBuf = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, cipherBuf);
    return new TextDecoder().decode(plainBuf);
  }
  async function lockItemWithPin(item, ctx){
    if(typeof crypto === 'undefined' || !crypto.subtle){ showToast('PIN-Schutz hier nicht verfügbar'); return; }
    const pin = await askPin('PIN festlegen');
    if(!pin){ return; }
    const confirmPin = await askPin('PIN bestätigen');
    if(confirmPin !== pin){ showToast('PINs stimmen nicht überein'); return; }
    mutationCheckpoint('content', currentSpaceId);
    await encryptItemWithPin(item, pin);
    persistState();
    if(ctx && ctx.insideFolder){ renderFolderGrid(); } else { refreshItems(); render(); }
    showToast('Karte gesperrt');
  }
  async function previewLockedItem(item){
    const pin = await askPin('PIN eingeben');
    if(!pin) return;
    try{
      const plain = await decryptItemWithPin(item, pin);
      const virtual = { ...item, type:item.lockedType, data:plain, locked:false };
      openPreview(virtual);
    }catch(e){ showToast('Falscher PIN'); }
  }
  async function unlockItemPermanently(item, ctx){
    const pin = await askPin('PIN zum Entsperren eingeben');
    if(!pin) return;
    try{
      const plain = await decryptItemWithPin(item, pin);
      mutationCheckpoint('content', currentSpaceId);
      item.type = item.lockedType;
      item.data = plain;
      delete item.locked; delete item.encData; delete item.lockedType;
      persistState();
      if(ctx && ctx.insideFolder){ renderFolderGrid(); } else { refreshItems(); render(); }
      showToast('Entsperrt');
    }catch(e){ showToast('Falscher PIN'); }
  }

  // ================= BURN-AFTER-READING LINK =================
  function createBurnLink(item){
    try{
      const encoded = btoa(unescape(encodeURIComponent(item.data)));
      const url = location.href.split('#')[0] + '#burn=' + encoded;
      navigator.clipboard.writeText(url).then(()=>{
        showToast('Link kopiert — funktioniert nur, wenn diese Datei online/lokal für den Empfänger erreichbar ist');
      }).catch(()=> showToast('Konnte Link nicht kopieren'));
    }catch(e){ showToast('Link konnte nicht erstellt werden'); }
  }
  function checkBurnHash(){
    const hash = location.hash;
    if(!hash.startsWith('#burn=')) return;
    const encoded = hash.slice(6);
    history.replaceState(null, '', location.href.split('#')[0]); // strip immediately so back/refresh can't re-open it
    try{
      const text = decodeURIComponent(escape(atob(encoded)));
      burnContent.textContent = text;
      burnOverlay.classList.add('show');
    }catch(e){ /* malformed link, ignore silently */ }
  }
  burnCloseBtn.addEventListener('click', ()=>{ burnOverlay.classList.remove('show'); burnContent.textContent=''; });

  // ================= PASTE CAPTURE =================
  // Browser pages cannot reliably monitor the clipboard in the background.
  // This mode only reacts to an explicit paste gesture and therefore causes no permission polling.
  let pasteCaptureOn = true;
  function syncPasteCaptureUI(){
    watchBtn.classList.toggle('active', pasteCaptureOn);
    watchBtn.setAttribute('aria-pressed', pasteCaptureOn ? 'true' : 'false');
    watchBtn.title = pasteCaptureOn
      ? 'Paste Capture aktiv: ⌘/Strg+V legt Inhalte direkt in CopyBoard ab'
      : 'Paste Capture aus: ⌘/Strg+V wird von CopyBoard nicht automatisch übernommen';
  }
  function setPasteCapture(enabled, announce=true){
    pasteCaptureOn = !!enabled;
    setSetting('device.pasteCapture', pasteCaptureOn, {persist:false});
    syncPasteCaptureUI();
    if(announce) showToast(pasteCaptureOn ? 'Paste Capture aktiviert' : 'Paste Capture deaktiviert');
  }
  watchBtn.addEventListener('click', ()=> setPasteCapture(!pasteCaptureOn));


  menuDecorationObserver.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('click',()=>queueMicrotask(()=>decorateMenuIcons()),true);
  queueMicrotask(()=>decorateMenuIcons());
  queueMicrotask(()=>decorateHelpUtilities(helpOverlay));

  // ================= MODAL STACK & ESCAPE RELIABILITY =================
  // Existing feature functions may keep adding/removing the "show" class.
  // This layer records the real opening order and turns it into one modal stack.
  const MODAL_STACK_BASE_Z = 100;
  const modalStack = [];
  const modalRegistry = new Map();
  const modalFocusReturn = new WeakMap();

  function modalIsOpen(overlay){
    return !!overlay && overlay.classList.contains('show');
  }

  function focusTargetIsUsable(target){
    if(!target?.isConnected) return false;
    const hiddenOverlay = target.closest?.('.overlay:not(.show)');
    return !hiddenOverlay;
  }

  function compactModalStack(){
    for(let i=modalStack.length-1;i>=0;i--){
      if(!modalIsOpen(modalStack[i])) modalStack.splice(i,1);
    }
  }

  function updateModalStackPresentation(){
    compactModalStack();
    modalStack.forEach((overlay,index)=>{
      overlay.style.setProperty('z-index', String(MODAL_STACK_BASE_Z + index * 4), 'important');
      overlay.dataset.modalStackIndex = String(index);
      overlay.setAttribute('aria-hidden','false');
      const dialog = overlay.querySelector(':scope > .modal');
      if(dialog){
        dialog.setAttribute('role','dialog');
        dialog.setAttribute('aria-modal', index === modalStack.length - 1 ? 'true' : 'false');
      }
    });
    document.querySelectorAll('.overlay:not(.show)').forEach(overlay=>{
      overlay.setAttribute('aria-hidden','true');
      delete overlay.dataset.modalStackIndex;
      const dialog = overlay.querySelector(':scope > .modal');
      if(dialog) dialog.removeAttribute('aria-modal');
    });
  }

  /**
   * Synchronizes real overlay visibility with opening order and focus return.
   */
  function syncModalInStack(overlay){
    const existingIndex = modalStack.indexOf(overlay);
    if(modalIsOpen(overlay)){
      if(existingIndex === -1){
        const active = document.activeElement;
        if(active && active !== document.body && !overlay.contains(active) && focusTargetIsUsable(active)){
          modalFocusReturn.set(overlay, active);
        }
        modalStack.push(overlay);
      }else if(existingIndex !== modalStack.length - 1){
        modalStack.splice(existingIndex,1);
        modalStack.push(overlay);
      }
    }else if(existingIndex !== -1){
      const wasTop = existingIndex === modalStack.length - 1;
      modalStack.splice(existingIndex,1);
      if(wasTop){
        const returnTarget = modalFocusReturn.get(overlay);
        modalFocusReturn.delete(overlay);
        queueMicrotask(()=>{
          const top = getTopModal();
          if(focusTargetIsUsable(returnTarget) && (!top || top.contains(returnTarget))){
            returnTarget.focus({preventScroll:true});
            return;
          }
          if(top){
            const preferred = top.querySelector('[autofocus], input:not([type="hidden"]), textarea, button, [tabindex]:not([tabindex="-1"])');
            if(preferred) preferred.focus({preventScroll:true});
          }
        });
      }
    }
    updateModalStackPresentation();
  }

  function getTopModal(){
    compactModalStack();
    return modalStack[modalStack.length - 1] || null;
  }

  /**
   * Registers an overlay with the central stack and its close contract.
   */
  function registerModal(overlay, options={}){
    if(!overlay) return;
    modalRegistry.set(overlay, {
      escape: options.escape !== false,
      backdrop: options.backdrop !== false,
      close: typeof options.close === 'function'
        ? options.close
        : ()=>overlay.classList.remove('show')
    });
    overlay.setAttribute('aria-hidden', modalIsOpen(overlay) ? 'false' : 'true');
    new MutationObserver(()=>syncModalInStack(overlay))
      .observe(overlay,{attributes:true,attributeFilter:['class']});
    syncModalInStack(overlay);
  }

  function requestModalClose(overlay, reason='programmatic'){
    if(!modalIsOpen(overlay)) return false;
    const config = modalRegistry.get(overlay);
    if(!config) return false;
    if(reason === 'escape' && !config.escape) return false;
    if(reason === 'backdrop' && !config.backdrop) return false;
    config.close(reason);
    if(modalIsOpen(overlay)) overlay.classList.remove('show');
    queueMicrotask(()=>syncModalInStack(overlay));
    return true;
  }

  function closeTextOverlayReliably(){
    textOverlay.classList.remove('show');
    editTextContext = null;
    textOverlayTitle.textContent = 'Zwischenablage einfügen';
  }
  function closeRenameOverlayReliably(){
    renameOverlay.classList.remove('show');
    renameContext = null;
  }
  function closeImageEditOverlayReliably(){
    imageEditOverlay.classList.remove('show');
    editImageContext = null;
  }
  function closeBurnOverlayReliably(){
    burnOverlay.classList.remove('show');
    burnContent.textContent = '';
  }

  registerModal(confirmOverlay);
  registerModal(textOverlay,{close:closeTextOverlayReliably});
  registerModal(folderOverlay,{close:closeFolderOverlay});
  registerModal(previewOverlay,{close:closePreview});
  registerModal(inspectorOverlay,{close:closeInspector});
  registerModal(spaceMoveOverlay);
  registerModal(shareOverlay,{close:closeShare});
  registerModal(renameOverlay,{close:closeRenameOverlayReliably});
  registerModal(pinOverlay,{close:()=>resolvePin(null)});
  registerModal(burnOverlay,{escape:false,backdrop:false,close:closeBurnOverlayReliably});
  registerModal(paletteExtractOverlay);
  registerModal(imageEditOverlay,{close:closeImageEditOverlayReliably});
  registerModal(favoritesOverlay);
  registerModal(recentOverlay);
  registerModal(duplicateOverlay);
  registerModal(duplicateDetectedOverlay,{close:closeDuplicateDetected});
  registerModal(paletteOverlay,{close:closePalette});
  registerModal(storageOverlay);
  registerModal(helpOverlay);
  registerModal(cloudOverlay,{close:()=>cloudOverlay.classList.remove('show')});

  // Only the topmost visible overlay may react to an outside click.
  document.addEventListener('click', event=>{
    const overlay = event.target instanceof Element ? event.target.closest('.overlay.show') : null;
    if(!overlay || event.target !== overlay || overlay !== getTopModal()) return;
    const config = modalRegistry.get(overlay);
    if(!config || !config.backdrop) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requestModalClose(overlay,'backdrop');
  }, true);

  // Escape is resolved once, in capture phase. This prevents a single keypress
  // from closing both a child overlay and the parent below it.
  document.addEventListener('keydown', event=>{
    if(event.key !== 'Escape') return;
    const top = getTopModal();
    if(!top) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requestModalClose(top,'escape');
  }, true);


  // ---------- init ----------
  (async function init(){
    checkBurnHash();
    deviceSettings = loadDeviceSettings();
    pasteCaptureOn = getSetting('device.pasteCapture');
    syncPasteCaptureUI();
    try{
      const savedTs = storageAvailable ? Number(localStorage.getItem(AUTOSAVE_LAST_SAVED_KEY)) : 0;
      lastSavedAt = Number.isFinite(savedTs) && savedTs > 0 ? savedTs : null;
    }catch(e){}
    memoryProtectionOn = storageAvailable ? getSetting('device.autoSave') : false;

    // Always restore the last persisted snapshot when available. In temporary mode,
    // changes from the current session are deliberately not written back.
    state = loadPersistedState();
    if(!state){ state = await migrateFromLegacyWindowStorage(); }
    if(!state){ state = defaultState(); }
    state = normalizeState(state);

    if(getPathValue(state.settings,'behavior.startSpace') === 'first' && state.spaces.length){
      state.activeSpaceId = state.spaces[0].id;
    }

    syncFromState();
    applyViewMode();
    titleInput.value = currentSpace().name;
    renderTabs();
    refreshItems();
    render();
    applyMemoryToggle();
    if(memoryProtectionOn) persistState({immediate:true}); // write the (possibly migrated/defaulted) baseline once
    await initCloudSync();
  })();
})();
