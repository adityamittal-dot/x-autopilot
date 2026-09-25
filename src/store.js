import path from 'node:path';
import { ROOT, readJSON, writeJSON } from './util.js';

const FILE = path.join(ROOT, 'data', 'history.json');

export function loadHistory() {
  return readJSON(FILE, { posts: [] });
}
export function saveHistory(h) {
  writeJSON(FILE, h);
}
export function recentTexts(h, n = 20) {
  return h.posts.slice(-n).map((p) => p.text);
}
/** URLs of news items already covered, so the same story isn't posted twice. */
export function recentSourceUrls(h, n = 30) {
  return new Set(h.posts.slice(-n).flatMap((p) => p.sourceUrls || []));
}
/** True if a post of this type was already created today (UTC), to make re-runs safe. */
export function postedToday(h, type) {
  const day = new Date().toISOString().slice(0, 10);
  return h.posts.some((p) => (p.type || 'recap') === type && String(p.createdAt).startsWith(day));
}
export function appendPost(h, entry) {
  h.posts.push(entry);
  if (h.posts.length > 500) h.posts = h.posts.slice(-500);
  saveHistory(h);
  return entry;
}
