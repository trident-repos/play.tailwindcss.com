import { runPlugin } from './runPlugin'
import dlv from 'dlv'

export function getVariants(state) {
  if (state.jit) {
    function escape(className) {
      let node = state.modules.postcssSelectorParser.module.className()
      node.value = className
      return dlv(node, 'raws.value', node.value)
    }

    return Array.from(state.jitContext.variantMap).reduce(
      (acc, [variant, [, applyVariant]]) => {
        let placeholder = '__variant_placeholder__'

        let root = state.modules.postcss.module.root({
          nodes: [
            state.modules.postcss.module.rule({
              selector: `.${escape(placeholder)}`,
              nodes: [],
            }),
          ],
        })

        let classNameParser = state.modules.postcssSelectorParser.module(
          (selectors) => {
            return selectors.first.filter(({ type }) => type === 'class').pop()
              .value
          }
        )

        function getClassNameFromSelector(selector) {
          return classNameParser.transformSync(selector)
        }

        function modifySelectors(modifierFunction) {
          root.each((rule) => {
            if (rule.type !== 'rule') {
              return
            }

            rule.selectors = rule.selectors.map((selector) => {
              return modifierFunction({
                get className() {
                  return getClassNameFromSelector(selector)
                },
                selector,
              })
            })
          })
          return root
        }

        applyVariant({
          container: root,
          separator: state.separator,
          modifySelectors,
        })

        let definition = root
          .toString()
          .replace(`.${escape(`${variant}:${placeholder}`)}`, '&')
          .replace(/[{}]/g, '')
          .replace(/\s*\n\s*/g, ' ')
          .trim()

        return {
          ...acc,
          [variant]: definition.includes(placeholder) ? null : definition,
        }
      },
      {}
    )
  }

  let config = state.config

  let variants = [
    'responsive',
    'hover',
    'focus',
    'group-hover',
    'active',
    'focus-within',
    'default',
    'first',
    'last',
    'odd',
    'even',
    'disabled',
    'visited',
    'group-focus',
    'focus-visible',
    'checked',
    'motion-safe',
    'motion-reduce',
    'dark',
  ]

  let plugins = Array.isArray(config.plugins) ? config.plugins : []

  plugins.forEach((plugin) => {
    runPlugin(plugin, state, {
      addVariant: (name) => {
        variants.push(name)
      },
    })
  })

  return variants.reduce((obj, variant) => ({ ...obj, [variant]: null }), {})
}
