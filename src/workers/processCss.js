import autoprefixer from 'autoprefixer'
import { klona } from 'klona/full'
import { VIRTUAL_SOURCE_PATH, VIRTUAL_HTML_FILENAME } from '../constants'
import extractClasses from './extractClasses'

const deps = {
  1: [
    () => import('tailwindcss-v1'),
    () => import('postcss-v7'),
    () => import('tailwindcss-v1/lib/featureFlags'),
  ],
  2: [
    () => import('tailwindcss'),
    () => import('postcss'),
    () => import('tailwindcss/lib/featureFlags'),
  ],
}

export async function processCss(
  configInput,
  htmlInput,
  cssInput,
  tailwindVersion = '2',
  skipIntelliSense = false
) {
  let jit = false
  const config = klona(configInput)
  const [tailwindcss, postcss, featureFlags] = (
    await Promise.all(deps[tailwindVersion].map((x) => x()))
  ).map((x) => x.default || x)

  self[VIRTUAL_HTML_FILENAME] = htmlInput

  let separator =
    typeof config.separator === 'undefined' ? ':' : config.separator
  separator = `${separator}`

  if (tailwindVersion === '2' && config.mode === 'jit') {
    config.purge = [VIRTUAL_HTML_FILENAME]
    jit = true
  } else {
    config.separator = `__TWSEP__${separator}__TWSEP__`
    config.purge = false
  }

  let jitContext
  if (jit && !skipIntelliSense) {
    jitContext = require('tailwindcss/jit/lib/setupContext')(config)(
      { opts: { from: VIRTUAL_SOURCE_PATH }, messages: [] },
      postcss.parse(cssInput)
    )
  }

  const applyComplexClasses =
    tailwindVersion === '1'
      ? require('tailwindcss-v1/lib/flagged/applyComplexClasses')
      : require('tailwindcss/lib/lib/substituteClassApplyAtRules')

  if (!applyComplexClasses.default.__patched) {
    let _applyComplexClasses = applyComplexClasses.default
    applyComplexClasses.default = (config, ...args) => {
      if (jit) {
        return require('tailwindcss/jit/lib/expandApplyAtRules')(jitContext)
      }

      let configClone = klona(config)
      configClone.separator = separator

      let fn = _applyComplexClasses(configClone, ...args)

      return async (css) => {
        css.walkRules((rule) => {
          const newSelector = rule.selector.replace(
            /__TWSEP__(.*?)__TWSEP__/g,
            '$1'
          )
          if (newSelector !== rule.selector) {
            rule.before(
              postcss.comment({
                text: '__ORIGINAL_SELECTOR__:' + rule.selector,
              })
            )
            rule.selector = newSelector
          }
        })

        await fn(css)

        css.walkComments((comment) => {
          if (comment.text.startsWith('__ORIGINAL_SELECTOR__:')) {
            comment.next().selector = comment.text.replace(
              /^__ORIGINAL_SELECTOR__:/,
              ''
            )
            comment.remove()
          }
        })

        return css
      }
    }
    applyComplexClasses.default.__patched = true
  }

  let css
  let lspRoot

  if (!jit) {
    let result = await postcss([tailwindcss(config), autoprefixer()]).process(
      cssInput,
      {
        from: undefined,
      }
    )
    css = result.css
    lspRoot = result.root
  } else {
    css = (
      await postcss([tailwindcss(config), autoprefixer()]).process(cssInput, {
        from: VIRTUAL_SOURCE_PATH,
      })
    ).css

    if (!skipIntelliSense) {
      lspRoot = (
        await postcss([
          tailwindcss({ ...config, mode: 'aot', purge: false, variants: [] }),
          autoprefixer(),
        ]).process(cssInput, {
          from: undefined,
        })
      ).root
    }
  }

  let state

  if (lspRoot) {
    state = {}
    state.jit = jit
    state.classNames = await extractClasses(lspRoot)
    state.separator = separator
    state.version =
      tailwindVersion === '1'
        ? require('tailwindcss-v1/package.json?version').version
        : require('tailwindcss/package.json?version').version
    state.editor = {
      userLanguages: {},
      capabilities: {},
    }
    state.featureFlags = featureFlags
  }

  const escapedSeparator = separator.replace(/./g, (m) =>
    /[a-z0-9-_]/i.test(m) ? m : `\\${m}`
  )

  return {
    state,
    css: css.replace(/__TWSEP__.*?__TWSEP__/g, escapedSeparator),
    jit,
    ...(jit ? { html: htmlInput } : {}),
  }
}
