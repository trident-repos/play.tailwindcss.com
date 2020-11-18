import versions from '../preval/versions'
import { toValidTailwindVersion } from '../utils/toValidTailwindVersion'
import { processCss } from './processCss'

let current

let lastCss
let lastConfig
let tailwindVersion = '2'

addEventListener('message', async (event) => {
  if (event.data._current) {
    current = event.data._current
    return
  }

  const css = event.data._recompile ? lastCss : event.data.css
  const config = event.data._recompile ? lastConfig : event.data.config
  if ('tailwindVersion' in event.data) {
    tailwindVersion = toValidTailwindVersion(event.data.tailwindVersion)
  }

  lastCss = css
  lastConfig = config

  function respond(data) {
    setTimeout(() => {
      if (event.data._id === current) {
        postMessage({ _id: event.data._id, ...data })
      } else {
        postMessage({ _id: event.data._id, canceled: true })
      }
    }, 0)
  }

  let mod = {}

  try {
    await (0, eval)('import("")')
  } catch (error) {
    if (error instanceof TypeError) {
      self.importShim = (0, eval)('u=>import(u)')
    } else {
      importScripts('https://unpkg.com/shimport@2.0.4/index.js')
      self.importShim = __shimport__.load
    }
  }

  class RequireError extends Error {
    constructor(message, line) {
      super(message)
      this.name = 'RequireError'
      this.line = line
    }
  }

  const builtinPlugins = {
    _builderVersion: versions.pluginBuilder,
    _tailwindVersion: tailwindVersion,
    '@tailwindcss/custom-forms': versions['@tailwindcss/custom-forms'],
    '@tailwindcss/forms': versions['@tailwindcss/forms'],
    '@tailwindcss/typography': versions['@tailwindcss/typography'],
    '@tailwindcss/ui': versions['@tailwindcss/ui'],
  }

  const before = `(async function(module){
    const require = async (m, line, builtinPlugins) => {
      if (typeof m !== 'string') {
        throw new RequireError('The "id" argument must be of type string. Received ' + typeof m, line)
      }
      if (m === '') {
        throw new RequireError("The argument 'id' must be a non-empty string. Received ''", line)
      }
      let result
      try {
        const href = builtinPlugins[m]
          ? '/plugins/' + builtinPlugins._builderVersion + '/v' + builtinPlugins._tailwindVersion + '/' + m + '@' + builtinPlugins[m] + '.js'
          : 'https://cdn.skypack.dev/' + m + '?min'
        result = await self.importShim(href)
      } catch (error) {
        throw new RequireError("Cannot find module '" + m + "'", line)
      }
      return result.default || result
    }`
  const after = `})(mod)`

  try {
    await eval(
      before +
        '\n' +
        config
          .split('\n')
          .map((line, i) =>
            line.replace(
              /\brequire\(([^(]*)\)/g,
              (_m, id) =>
                `(await require(${id.trim() === '' ? 'undefined' : id}, ${
                  i + 1
                }, ${JSON.stringify(builtinPlugins)}))`
            )
          )
          .join('\n') +
        '\n' +
        after
    )
  } catch (error) {
    let line

    if (error instanceof RequireError) {
      line = error.line
    } else if (typeof error.line !== 'undefined') {
      line = error.line - 1 - before.split('\n').length
    } else {
      const lines = error.stack.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const re = /:([0-9]+):([0-9]+)/g
        const matches = []
        let match
        while ((match = re.exec(lines[i])) !== null) {
          matches.push(match)
        }
        if (matches.length > 0) {
          line =
            parseInt(matches[matches.length - 1][1], 10) -
            before.split('\n').length
          break
        }
      }
    }

    return respond({
      error: {
        message: error.message,
        file: 'Config',
        line: typeof line === 'undefined' ? undefined : line,
      },
    })
  }

  try {
    const { css: compiledCss, state } = await processCss(
      mod.exports,
      css,
      tailwindVersion
    )
    respond({ state, css: compiledCss })
  } catch (error) {
    console.log(error)
    if (error.toString().startsWith('CssSyntaxError')) {
      const match = error.message.match(
        /^<css input>:([0-9]+):([0-9]+): (.*?)$/
      )
      respond({ error: { message: match[3], file: 'CSS', line: match[1] } })
    } else {
      respond({ error: { message: error.message } })
    }
  }
})
