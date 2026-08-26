/**
 * Add-in settings.
 *
 * Deliberately stored in localStorage rather than Office document settings:
 * document settings are saved *inside the .docx*, which would carry the access
 * token to anyone the letter is later shared with.
 */

const BASE_URL_KEY = 'rooneyLawMail.baseUrl';
const TOKEN_KEY = 'rooneyLawMail.token';

function read(key) {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key, value) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function loadSettings() {
  // When the task pane is served by the mail service itself, its own origin is
  // the right default — the user only has to paste a token.
  const fallbackBaseUrl = window.location.origin.startsWith('http') ? window.location.origin : '';
  return {
    baseUrl: read(BASE_URL_KEY) || fallbackBaseUrl,
    token: read(TOKEN_KEY),
  };
}

export function saveSettings({ baseUrl, token }) {
  const cleanedUrl = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  const okUrl = write(BASE_URL_KEY, cleanedUrl);
  const okToken = write(TOKEN_KEY, String(token ?? '').trim());
  return okUrl && okToken;
}

export function clearToken() {
  write(TOKEN_KEY, '');
}

export function hasSettings(settings) {
  return Boolean(settings.baseUrl && settings.token);
}
