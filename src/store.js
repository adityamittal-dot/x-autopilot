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
export function daysSinceLastPost(h) {
  const last = h.posts[h.posts.length - 1];
  if (!last) return null;
  return (Date.now() - new Date(last.createdAt).getTime()) / 864e5;
}
export function appendPost(h, entry) {
  h.posts.push(entry);
  if (h.posts.length > 500) h.posts = h.posts.slice(-500);
  saveHistory(h);
  return entry;
}
