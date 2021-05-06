import autoprefixer from 'autoprefixer'
import { klona } from 'klona/full'
import extractClasses from './extractClasses'
import { removeFunctions } from '../utils/object'
import { getVariants } from '../utils/getVariants'

const VIRTUAL_HTML_FILENAME = '/htmlInput'

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

export async function processCss(
  configInput,
  htmlInput,
  cssInput,
  tailwindVersion = '2',
  skipIntelliSense = false
) {
  let jit = false
  const config = klona(configInput)
  const [tailwindcss, postcss, resolveConfig, featureFlags] = (
    await Promise.all(deps[tailwindVersion].map((x) => x()))
  ).map((x) => x.default || x)

  self[VIRTUAL_HTML_FILENAME] = htmlInput

  const separator = config.separator || ':'

  config.purge = false

  if (config.mode === 'jit') {
    config.variants = []
    delete config.mode
    jit = true
  } else {
    config.separator = `__TWSEP__${separator}__TWSEP__`
  }

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
    let layers = new Set()
    let result = await postcss([
      (root) => {
        root.walkAtRules('tailwind', (rule) => {
          if (
            ['base', 'components', 'utilities', 'screens'].includes(rule.params)
          ) {
            rule.before(postcss.comment({ text: '__start_layer__' }))
            rule.after(postcss.comment({ text: '__end_layer__' }))
            layers.add(rule.params)
          }
        })
        if (!layers.has('screens')) {
          root.append([
            postcss.comment({ text: '__start_layer__' }),
            postcss.atRule({ name: 'tailwind', params: 'screens' }),
            postcss.comment({ text: '__end_layer__' }),
          ])
        }
      },
      tailwindcss({
        ...config,
        mode: 'jit',
        separator,
        purge: [VIRTUAL_HTML_FILENAME],
      }),
      autoprefixer(),
    ]).process(cssInput, {
      from: undefined,
    })

    css = result.css

    if (!skipIntelliSense) {
      let layersRoot = (
        await postcss([tailwindcss(config), autoprefixer()]).process(
          Array.from(layers)
            .map((layer) => `@tailwind ${layer};`)
            .join('\n'),
          {
            from: undefined,
          }
        )
      ).root

      let insideLayer = false
      result.root.walk((node) => {
        if (node.type === 'comment') {
          if (node.text === '__start_layer__') {
            insideLayer = true
            node.remove()
          } else if (node.text === '__end_layer__') {
            insideLayer = false
            node.remove()
          }
        } else if (insideLayer) {
          node.remove()
        }
      })

      result.root.prepend(layersRoot.nodes)

      lspRoot = result.root
    }
  }

  let state

  config.separator = separator

  if (lspRoot) {
    state = {}
    state.enabled = true
    state.classNames = await extractClasses(lspRoot)
    state.separator = separator
    state.config = resolveConfig(klona(configInput))
    state.variants = getVariants({ config: state.config, postcss })
    removeFunctions(state.config)
    state.version =
      tailwindVersion === '1'
        ? require('tailwindcss-v1/package.json?version').version
        : require('tailwindcss/package.json?version').version
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
