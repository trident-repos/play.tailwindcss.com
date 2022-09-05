import * as monaco from 'monaco-editor'
import {
  DiagnosticsAdapter,
  SuggestAdapter,
  QuickInfoAdapter,
} from 'monaco-editor/esm/vs/language/typescript/tsMode'
import types1 from '!!raw-loader!../monaco/types.d.ts'
import types2 from '!!raw-loader!../monaco/types-v2.d.ts'
import postcssTypes from '!!raw-loader!string-replace-loader?search=\\/\\*.*?\\*\\/&replace=&flags=sg!../../node_modules/postcss/lib/postcss.d.ts'
import sourcemapTypes from '!!raw-loader!source-map-js/source-map.d.ts'

function importAll(r) {
  return r.keys().map((path) => ({ path, mod: r(path).default }))
}

function collectTypes(rootFolder, typesFolder) {
  return {
    'index.d.ts': 'export * from "./types/config"',
    ...Object.fromEntries(
      importAll(rootFolder).map(({ path, mod }) => [
        path.replace('./', ''),
        mod,
      ])
    ),
    ...Object.fromEntries(
      importAll(typesFolder).map(({ path, mod }) => [
        path.replace('./', 'types/'),
        // Remove the `content` field
        mod.replace(
          /interface RequiredConfig \{.*?\}/s,
          'interface RequiredConfig {}'
        ),
      ])
    ),
  }
}

const CONFIG_URI = 'file:///Config'
const CONFIG_PROXY_URI = 'file:///Config.proxy'

const types = {
  1: { 'index.d.ts': types1 },
  2: { 'index.d.ts': types2 },
  3: collectTypes(
    require.context('!!raw-loader!tailwindcss/', false, /\.d\.ts$/),
    require.context('!!raw-loader!tailwindcss/types/', true, /\.d\.ts$/)
  ),
  insiders: collectTypes(
    require.context('!!raw-loader!tailwindcss-insiders/', false, /\.d\.ts$/),
    require.context(
      '!!raw-loader!tailwindcss-insiders/types/',
      true,
      /\.d\.ts$/
    )
  ),
}

export function setupJavaScriptMode(
  content,
  onChange,
  getEditor,
  initialTailwindVersion
) {
  const disposables = []
  const typeDisposables = []
  let model
  let tailwindVersion = initialTailwindVersion

  function registerTypes(version) {
    typeDisposables.forEach((disposable) => disposable.dispose())
    typeDisposables.length = 0

    for (let file in types[version]) {
      typeDisposables.push(
        monaco.languages.typescript.javascriptDefaults.addExtraLib(
          types[version][file],
          `file:///node_modules/@types/tailwindcss/${file}`
        )
      )
    }
  }

  return {
    getModel: () => model,
    activate: () => {
      if (!model) {
        const _doValidate = DiagnosticsAdapter.prototype._doValidate
        DiagnosticsAdapter.prototype._doValidate = function (originalModel) {
          return _doValidate.bind(this)(
            originalModel === model ? proxyModel : originalModel
          )
        }
        disposables.push({
          dispose() {
            DiagnosticsAdapter.prototype._doValidate = _doValidate
          },
        })

        const _setModelMarkers = monaco.editor.setModelMarkers
        monaco.editor.setModelMarkers = (originalModel, owner, markers) => {
          return _setModelMarkers(
            originalModel === proxyModel ? model : originalModel,
            owner,
            originalModel === proxyModel
              ? markers.map((marker) => {
                  const lineDelta = getLineDelta(model, {
                    lineNumber: marker.startLineNumber,
                  })
                  return {
                    ...marker,
                    startLineNumber: marker.startLineNumber - lineDelta,
                    endLineNumber: marker.endLineNumber - lineDelta,
                    relatedInformation: [],
                  }
                })
              : markers
          )
        }
        disposables.push({
          dispose() {
            monaco.editor.setModelMarkers = _setModelMarkers
          },
        })

        monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
          noSemanticValidation: false,
          noSyntaxValidation: false,
          noSuggestionDiagnostics: false,
          diagnosticCodesToIgnore: [
            80001, // "File is a CommonJS module; it may be converted to an ES6 module."
            2307, // "Cannot find module 'x'."
          ],
        })

        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
          allowJs: true,
          allowNonTsExtensions: true,
          module: 1,
          target: 99,
          checkJs: true,
          moduleResolution:
            monaco.languages.typescript.ModuleResolutionKind.NodeJs,
          typeRoots: ['node_modules/@types'],
        })

        disposables.push(
          monaco.languages.typescript.javascriptDefaults.addExtraLib(
            sourcemapTypes,
            'file:///node_modules/@types/source-map-js/index.d.ts'
          )
        )

        disposables.push(
          monaco.languages.typescript.javascriptDefaults.addExtraLib(
            postcssTypes,
            'file:///node_modules/@types/postcss/index.d.ts'
          )
        )

        registerTypes(tailwindVersion)

        model = monaco.editor.createModel(
          content || '',
          'javascript',
          monaco.Uri.parse(CONFIG_URI)
        )
        model.updateOptions({ indentSize: 2, tabSize: 2 })
        disposables.push(model)

        const proxyModel = monaco.editor.createModel(
          addTypeAnnotationToJs(content || ''),
          'javascript',
          CONFIG_PROXY_URI
        )
        proxyModel.updateOptions({ indentSize: 2, tabSize: 2 })
        disposables.push(proxyModel)

        disposables.push(
          model.onDidChangeContent(() => {
            onChange()
            proxyModel.setValue(addTypeAnnotationToJs(model.getValue()))
          })
        )

        const _provideHover = QuickInfoAdapter.prototype.provideHover
        QuickInfoAdapter.prototype.provideHover = function (
          originalModel,
          position,
          ...rest
        ) {
          if (!this._provideHover) {
            this._provideHover = _provideHover.bind(this)
          }
          const lineDelta =
            originalModel === model ? getLineDelta(model, position) : 0
          return this._provideHover(
            originalModel === model ? proxyModel : originalModel,
            originalModel === model ? position.delta(lineDelta) : position,
            ...rest
          ).then((result) => {
            if (!result) return
            if (
              result.contents[result.contents.length - 1].value
                ?.trim()
                .startsWith('*@type* — {import("tailwindcss')
            ) {
              return
            }
            return {
              ...result,
              range: new monaco.Range(
                result.range.startLineNumber - lineDelta,
                result.range.startColumn,
                result.range.endLineNumber - lineDelta,
                result.range.endColumn
              ),
            }
          })
        }
        disposables.push({
          dispose() {
            QuickInfoAdapter.prototype.provideHover = _provideHover
          },
        })

        const _provideCompletionItems =
          SuggestAdapter.prototype.provideCompletionItems
        SuggestAdapter.prototype.provideCompletionItems = function (
          originalModel,
          position,
          ...rest
        ) {
          if (!this._provideCompletionItems) {
            this._provideCompletionItems = _provideCompletionItems.bind(this)
          }
          const lineDelta =
            originalModel === model ? getLineDelta(model, position) : 0
          return this._provideCompletionItems(
            originalModel === model ? proxyModel : originalModel,
            originalModel === model ? position.delta(lineDelta) : position,
            ...rest
          ).then((result) => {
            if (!result) return result
            return {
              suggestions:
                originalModel === model
                  ? result.suggestions.map((suggestion) => ({
                      ...suggestion,
                      uri: model.uri,
                      range: new monaco.Range(
                        suggestion.range.startLineNumber - lineDelta,
                        suggestion.range.startColumn,
                        suggestion.range.endLineNumber - lineDelta,
                        suggestion.range.endColumn
                      ),
                    }))
                  : result.suggestions,
            }
          })
        }
        disposables.push({
          dispose() {
            SuggestAdapter.prototype.provideCompletionItems =
              _provideCompletionItems
          },
        })
      }
      getEditor().setModel(model)
    },
    dispose() {
      disposables.forEach((disposable) => disposable.dispose())
      disposables.length = 0
      typeDisposables.forEach((disposable) => disposable.dispose())
      typeDisposables.length = 0
    },
    setTailwindVersion(newTailwindVersion) {
      tailwindVersion = newTailwindVersion
      if (model) {
        registerTypes(tailwindVersion)
      }
    },
  }
}

function getLineDelta(modelOrValue, position) {
  const value =
    typeof modelOrValue === 'string' ? modelOrValue : modelOrValue.getValue()
  const lines = value.split('\n')
  let exportLine
  for (let i = 0; i < lines.length; i++) {
    if (/^(\s*)module\.exports(\s*=)/.test(lines[i])) {
      exportLine = i + 1
      break
    }
  }
  if (typeof exportLine === 'undefined') return 0
  return position.lineNumber < exportLine ? 0 : 1
}

function addTypeAnnotationToJs(js) {
  return (
    js.replace(
      /^(\s*)module\.exports(\s*=)/m,
      '$1/** @type {import("tailwindcss").Config} */\nconst _exports$2'
    ) + '\n;_exports' // prevent "_exports is declared but its value is never read."
  )
}
