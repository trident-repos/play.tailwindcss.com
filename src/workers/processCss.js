import autoprefixer from 'autoprefixer'
import versions from '../preval/versions'
import { klona } from 'klona/full'
import extractClasses from './extractClasses'
import { removeFunctions } from '../utils/object'
import { getVariants } from '../utils/getVariants'

const deps = {
  1: [
    () => import('tailwindcss-v1'),
    () => import('postcss-v7'),
    () => import('tailwindcss-v1/resolveConfig'),
    () => import('tailwindcss-v1/lib/featureFlags'),
  ],
  2: [
    () => import('tailwindcss'),
    () => import('postcss'),
    () => import('tailwindcss/resolveConfig'),
    () => import('tailwindcss/lib/featureFlags'),
  ],
}

export async function processCss(configInput, cssInput, tailwindVersion = '2') {
  const config = klona(configInput)
  const [tailwindcss, postcss, resolveConfig, featureFlags] = (
    await Promise.all(deps[tailwindVersion].map((x) => x()))
  ).map((x) => x.default || x)

  const separator = config.separator || ':'
  config.separator = `__TWSEP__${separator}__TWSEP__`
  config.purge = false
  delete config.mode

  const applyComplexClasses =
    tailwindVersion === '1'
      ? require('tailwindcss-v1/lib/flagged/applyComplexClasses')
      : require('tailwindcss/lib/lib/substituteClassApplyAtRules')

  if (!applyComplexClasses.default.__patched) {
    let _applyComplexClasses = applyComplexClasses.default
    applyComplexClasses.default = (config, ...args) => {
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

  const { css, root } = await postcss([
    tailwindcss(config),
    autoprefixer(),
  ]).process(cssInput, {
    from: undefined,
  })

  const state = {}

  config.separator = separator
  state.enabled = true
  state.classNames = await extractClasses(root)
  state.separator = separator
  state.config = resolveConfig(klona(configInput))
  state.variants = getVariants({ config: state.config, postcss })
  removeFunctions(state.config)
  state.version =
    tailwindVersion === '1' ? versions['tailwindcss-v1'] : versions.tailwindcss
  state.editor = {
    userLanguages: {},
    capabilities: {},
    globalSettings: {
      tabSize: 2,
      validate: true,
      lint: {
        cssConflict: 'warning',
        invalidApply: 'error',
        invalidScreen: 'error',
        invalidVariant: 'error',
        invalidConfigPath: 'error',
        invalidTailwindDirective: 'error',
      },
    },
  }
  state.featureFlags = featureFlags
  const escapedSeparator = separator.replace(/./g, (m) =>
    /[a-z0-9-_]/i.test(m) ? m : `\\${m}`
  )

  return {
    state,
    css: css.replace(/__TWSEP__.*?__TWSEP__/g, escapedSeparator),
  }
}
