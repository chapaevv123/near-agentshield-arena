// Browser equivalents used by transitive near-api-js modules.
export function inherits(child, parent) {
  child.super_ = parent;
  Object.setPrototypeOf(child.prototype, parent.prototype);
}

export function format(template, ...values) {
  let index = 0;
  const rendered = String(template).replace(/%[sdjifoO%]/g, (token) => {
    if (token === '%%') return '%';
    const value = values[index++];
    if (token === '%j') { try { return JSON.stringify(value); } catch { return '[Circular]'; } }
    if (token === '%d' || token === '%i' || token === '%f') return String(Number(value));
    return String(value);
  });
  return [rendered, ...values.slice(index)].join(' ');
}

export default { inherits, format };
