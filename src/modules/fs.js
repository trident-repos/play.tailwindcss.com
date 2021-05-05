let i = 0

module.exports = {
  statSync: () => ({
    mtimeMs: ++i,
  }),
  readFileSync: (id) => self[id] || '',
}
