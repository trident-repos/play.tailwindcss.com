import { runPlugin } from './runPlugin'
import dlv from 'dlv'
import { withoutLogs } from './withoutLogs'

export function getVariants(state) {
  if (state.jitContext?.getVariants) {
    return state.jitContext.getVariants()
  }

  if (state.jit) {
    let result = []
    // [name, [sort, fn]]
    // [name, [[sort, fn]]]
    Array.from(state.jitContext.variantMap).forEach(
      ([variantName, variantFnOrFns]) => {
        if (variantName.startsWith('[') && variantName.endsWith(']')) {
          return
        }

        result.push({
          name: variantName,
          values: [],
          isArbitrary: false,
          selectors: () => {
            function escape(className) {
              let node = state.modules.postcssSelectorParser.module.className()
              node.value = className
              return dlv(node, 'raws.value', node.value)
            }

            let fns = (
              Array.isArray(variantFnOrFns[0])
                ? variantFnOrFns
                : [variantFnOrFns]
            ).map(([_sort, fn]) => fn)

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
                return selectors.first
                  .filter(({ type }) => type === 'class')
                  .pop().value
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

            let definitions = []

            for (let fn of fns) {
              let definition
              let container = root.clone()
              let returnValue = withoutLogs(() =>
                fn({
                  container,
                  separator: state.separator,
                  modifySelectors,
                  format: (def) => {
                    definition = def.replace(/:merge\(([^)]+)\)/g, '$1')
                  },
                  wrap: (rule) => {
                    if (rule.type === 'atrule') {
                      definition = `@${rule.name} ${rule.params}`
                    }
                  },
                })
              )

              if (!definition) {
                definition = returnValue
              }

              if (definition) {
                definitions.push(definition)
                continue
              }

              container.walkDecls((decl) => {
                decl.remove()
              })

              definition = removeBrackets(
                container
                  .toString()
                  .replace(`.${escape(`${variantName}:${placeholder}`)}`, '&')
              )
                .replace(/\s*\n\s*/g, ' ')
                .trim()

              if (!definition.includes(placeholder)) {
                definitions.push(definition)
              }
            }

            return definitions
          },
        })
      }
    )

    return result
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

  return variants.map((variant) => ({
    name: variant,
    values: [],
    isArbitrary: false,
    selectors: () => [],
  }))
}

function removeBrackets(str) {
  let result = ''
  for (let i = 0; i < str.length; i++) {
    let isBracket = (str[i] === '{' || str[i] === '}') && str[i - 1] !== '\\'
    if (!isBracket) {
      result += str[i]
    }
  }
  return result
}
