export function withoutLogs(callback) {
  let fns = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  }
  for (let key in fns) {
    console[key] = () => {}
  }
  let result = callback()
  for (let key in fns) {
    console[key] = fns[key]
  }
  return result
}
