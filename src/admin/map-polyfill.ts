function patch(proto: Map<unknown, unknown> | WeakMap<object, unknown>) {
  const map = proto as Map<unknown, unknown> & {
    getOrInsert?: (key: unknown, value: unknown) => unknown;
    getOrInsertComputed?: (key: unknown, compute: (key: unknown) => unknown) => unknown;
  };
  if (typeof map.getOrInsert !== "function") {
    map.getOrInsert = function getOrInsert(key, value) {
      if (this.has(key)) return this.get(key);
      this.set(key, value);
      return value;
    };
  }
  if (typeof map.getOrInsertComputed !== "function") {
    map.getOrInsertComputed = function getOrInsertComputed(key, compute) {
      if (this.has(key)) return this.get(key);
      const value = compute(key);
      this.set(key, value);
      return value;
    };
  }
}

patch(Map.prototype);
patch(WeakMap.prototype);
