// Minimal in-memory stand-in for the supabase-js query builder, covering only
// the call chains the payment server code uses. Await-able at any point in
// the chain (thenable), like the real client.

class Builder {
  constructor(tables, name, genId) {
    this.tables = tables;
    this.name = name;
    this.genId = genId;
    this.filters = [];
    this.op = { type: "select" };
    this.singleMode = null;
    this.countMode = null;
    this.headMode = false;
  }

  select(_cols, opts = {}) {
    if (opts.count) {
      this.countMode = opts.count;
      this.headMode = Boolean(opts.head);
    }
    return this;
  }

  insert(rows) {
    this.op = { type: "insert", rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }

  update(patch) {
    this.op = { type: "update", patch };
    return this;
  }

  upsert(row, opts = {}) {
    this.op = { type: "upsert", row, opts };
    return this;
  }

  delete() {
    this.op = { type: "delete" };
    return this;
  }

  eq(column, value) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  gte(column, value) {
    this.filters.push((row) => row[column] >= value);
    return this;
  }

  in(column, values) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  order() { return this; }
  limit() { return this; }

  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  single() {
    this.singleMode = "must";
    return this;
  }

  then(resolve) {
    resolve(this.run());
  }

  run() {
    if (!this.tables.has(this.name)) this.tables.set(this.name, []);
    const rows = this.tables.get(this.name);
    const match = (row) => this.filters.every((filter) => filter(row));
    let result;

    switch (this.op.type) {
      case "select": {
        result = rows.filter(match);
        if (this.countMode) {
          return { count: result.length, data: this.headMode ? null : result, error: null };
        }
        break;
      }
      case "insert": {
        result = this.op.rows.map((row) => ({ id: this.genId(), ...row }));
        rows.push(...result);
        break;
      }
      case "update": {
        result = rows.filter(match);
        for (const row of result) Object.assign(row, this.op.patch);
        break;
      }
      case "upsert": {
        const conflictColumns = (this.op.opts.onConflict || "").split(",").map((s) => s.trim()).filter(Boolean);
        const incoming = this.op.row;
        const existing = rows.find(
          (row) => conflictColumns.length > 0 && conflictColumns.every((col) => row[col] === incoming[col])
        );
        if (existing) {
          if (this.op.opts.ignoreDuplicates) {
            result = [];
          } else {
            Object.assign(existing, incoming);
            result = [existing];
          }
        } else {
          const inserted = { id: this.genId(), ...incoming };
          rows.push(inserted);
          result = [inserted];
        }
        break;
      }
      case "delete": {
        result = rows.filter(match);
        this.tables.set(this.name, rows.filter((row) => !match(row)));
        break;
      }
      default:
        result = [];
    }

    if (this.singleMode) {
      const data = result.length > 0 ? result[0] : null;
      if (this.singleMode === "must" && !data) return { data: null, error: { message: "no rows returned" } };
      return { data, error: null };
    }
    return { data: result, error: null };
  }
}

export function createFakeDb(seed = {}) {
  const tables = new Map(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  let counter = 0;
  return {
    tables,
    table: (name) => tables.get(name) || [],
    from(name) {
      counter += 1;
      const id = counter;
      return new Builder(tables, name, () => `fake-id-${id}-${tables.get(name)?.length ?? 0}-${Math.abs(name.length)}`);
    }
  };
}
