// Only application records cross origins. Authentication storage is never read.
export const MAX_BACKUP_BYTES = 4 * 1024 * 1024;
export const MAX_BACKUP_ENTRIES = 500;

function validIdentity(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
    value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

export function isAllowedLocalDataKey(key) {
  if (typeof key !== 'string' || key.length > 1024) return false;
  if (key === 'ur-smart-fields') return true;
  const operation = /^ur-smart-operations-v1:([^:]+):([^:]+)$/.exec(key);
  if (operation) return validIdentity(operation[1]) && validIdentity(operation[2]);
  const account = /^(?:ur-smart-field-map-v1|ur-smart-satellite-history-v1):account:(.+)$/.exec(key);
  if (!account) return false;
  try {
    const owner = decodeURIComponent(account[1]);
    return validIdentity(owner) && encodeURIComponent(owner) === account[1];
  } catch {
    return false;
  }
}

// Count UTF-8 bytes without depending on a browser API or Node-specific module.
function byteLength(value) {
  let size = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) size++;
    else if (code < 0x800) size += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length &&
      value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) {
      size += 4;
      i++;
    } else size += 3;
    if (size > MAX_BACKUP_BYTES) return size;
  }
  return size;
}

function validateValue(value) {
  if (typeof value !== 'string' || byteLength(value) > MAX_BACKUP_BYTES)
    throw Error('حجم السجل أو تنسيقه غير صالح. الحد الأقصى للنسخة 4 ميبيبايت.');
  // Preserve app records byte-for-byte, including damaged legacy JSON. The app's
  // normal readers retain their validation and account-owner checks after import.
}

function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup) ||
      backup.format !== 'ur-smart-local-backup' || backup.version !== 1 ||
      typeof backup.created_at !== 'string' || !Number.isFinite(new Date(backup.created_at).getTime()) ||
      !Array.isArray(backup.entries) || backup.entries.length > MAX_BACKUP_ENTRIES ||
      Object.keys(backup).some(key => !['format', 'version', 'created_at', 'entries'].includes(key)))
    throw Error('صيغة النسخة غير مدعومة أو تجاوزت حد 500 سجل.');
  const seen = new Set();
  const entries = backup.entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).length !== 2 || !Object.hasOwn(entry, 'key') || !Object.hasOwn(entry, 'value') ||
        !isAllowedLocalDataKey(entry.key) || seen.has(entry.key))
      throw Error('تحتوي النسخة على مفتاح غير مسموح أو سجل مكرر. لم تُستعد أي بيانات.');
    seen.add(entry.key);
    validateValue(entry.value);
    return {key: entry.key, value: entry.value};
  });
  const result = {format: 'ur-smart-local-backup', version: 1, created_at: backup.created_at, entries};
  if (byteLength(JSON.stringify(result)) > MAX_BACKUP_BYTES)
    throw Error('حجم النسخة أكبر من الحد الأقصى: 4 ميبيبايت.');
  return result;
}

export function createLocalDataBackup(storage, {createdAt} = {}) {
  const keys = [];
  // Enumerate names first; getItem is never called for a key outside the allowlist.
  const length = storage.length;
  for (let i = 0; i < length; i++) {
    const key = storage.key(i);
    if (isAllowedLocalDataKey(key) && !keys.includes(key)) {
      keys.push(key);
      if (keys.length > MAX_BACKUP_ENTRIES)
        throw Error('تجاوزت البيانات المحلية حد 500 سجل. لم تتغير البيانات القديمة.');
    }
  }
  const entries = [];
  let bytes = 0;
  for (const key of keys) {
    const value = storage.getItem(key);
    if (value === null) continue;
    validateValue(value);
    bytes += byteLength(key) + byteLength(value);
    if (bytes > MAX_BACKUP_BYTES) throw Error('حجم النسخة أكبر من الحد الأقصى: 4 ميبيبايت.');
    entries.push({key, value});
  }
  return validateBackup({format: 'ur-smart-local-backup', version: 1,
    created_at: createdAt === undefined ? new Date().toISOString() : createdAt, entries});
}

export function parseLocalDataBackup(text) {
  if (typeof text !== 'string' || byteLength(text) > MAX_BACKUP_BYTES)
    throw Error('حجم الملف أكبر من الحد الأقصى: 4 ميبيبايت.');
  let backup;
  try { backup = JSON.parse(text); }
  catch { throw Error('الملف ليس نسخة JSON صالحة.'); }
  return validateBackup(backup);
}

export function restoreLocalDataBackup(storage, backup) {
  // Revalidate the whole file before the first storage read or write.
  const validated = validateBackup(backup);
  let restored = 0, skipped = 0, stopped = false;
  for (const entry of validated.entries) {
    try {
      if (storage.getItem(entry.key) !== null) { skipped++; continue; }
      storage.setItem(entry.key, entry.value);
      restored++;
    } catch {
      stopped = true;
      break;
    }
  }
  const total = validated.entries.length;
  return {restored, skipped, failed: total - restored - skipped, total, stopped};
}
