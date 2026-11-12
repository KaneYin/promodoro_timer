export class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(i) { return [...this.values.keys()][i] ?? null; }
  getItem(k) { return this.values.get(k) ?? null; }
  setItem(k,v) { this.values.set(k,String(v)); }
  removeItem(k) { this.values.delete(k); }
}
