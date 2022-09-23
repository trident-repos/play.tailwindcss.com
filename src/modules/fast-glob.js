module.exports = {
  sync: (patterns) => [].concat(patterns),
  generateTasks: (patterns) => [
    {
      dynamic: false,
      base: '.',
      negative: [],
      positive: [].concat(patterns),
      patterns: [].concat(patterns),
    },
  ],
}
