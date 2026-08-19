/**
 * Central CopyBoard configuration, limits, storage keys and settings schema.
 */

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const STORAGE_KEY = 'copyboard_state_v1';
export const STATE_SCHEMA_VERSION = 1;
export const AUTOSAVE_PREF_KEY = 'copyboard_autosave_pref';
export const AUTOSAVE_LAST_SAVED_KEY = 'copyboard_autosave_last_saved';
export const PASTE_CAPTURE_PREF_KEY = 'copyboard_paste_capture_pref';
export const CLOUD_DEVICE_KEY = 'copyboard_cloud_device_id_v1';
export const CLOUD_META_KEY_PREFIX = 'copyboard_cloud_meta_v1:';
export const CLOUD_PUSH_DEBOUNCE_MS = 900;
export const CLOUD_CONFIG = Object.freeze({
  supabaseUrl:'https://nfltixnoopjjpkbbpfus.supabase.co',
  supabasePublishableKey:'sb_publishable_R7b6EuUsfvcMJGFqZD8mRg_patfwPRO',
  bucket:'copyboard-snapshots'
});
// Device storage keys must be initialized before SETTINGS_REGISTRY references them.
export const SETTINGS_SCHEMA_VERSION = 1;
export const SETTINGS_REGISTRY = Object.freeze({
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
export const PREIMPORT_RECOVERY_KEY = 'copyboard_preimport_recovery_v1';
export const MAX_IMPORT_FILE_BYTES = 30 * 1024 * 1024;
export const PERSIST_DEBOUNCE_MS = 140;
