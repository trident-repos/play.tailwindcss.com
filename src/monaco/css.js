import * as monaco from 'monaco-editor'
import {
  setupMode,
  DiagnosticsAdapter,
  CompletionAdapter,
  DocumentColorAdapter,
  HoverAdapter,
} from 'monaco-editor/esm/vs/language/css/cssMode'
import { cssDefaults } from 'monaco-editor/esm/vs/language/css/monaco.contribution'
import { supplementMarkers } from './supplementMarkers'
import { renderColorDecorators } from './renderColorDecorators'
import { requestResponse } from '../utils/workers'
import { debounce } from 'debounce'

cssDefaults._languageId = 'tailwindcss'

const CSS_URI = 'file:///CSS'
const CSS_PROXY_URI = 'file:///CSS.proxy'

export function setupCssMode(content, onChange, worker, getEditor) {
  const disposables = []
  let model
  let updateDecorations

  monaco.languages.register({ id: 'tailwindcss' })

  disposables.push(
    monaco.languages.setMonarchTokensProvider('tailwindcss', language)
  )

  return {
    getModel: () => model,
    getValue: () =>
      model
        ?.getValue()
        .replace(/@config\s*('[^']*'|"[^"]*")(\s*;)?/g, (m) =>
          m.replace(/./g, ' ')
        ),
    updateDecorations: () => updateDecorations(),
    activate: () => {
      if (!model) {
        disposables.push(
          monaco.languages.setLanguageConfiguration(
            'tailwindcss',
            languageConfiguration
          )
        )

        disposables.push(setupMode(cssDefaults))

        const _provideCompletionItems =
          CompletionAdapter.prototype.provideCompletionItems
        CompletionAdapter.prototype.provideCompletionItems = async function (
          originalModel,
          ...rest
        ) {
          if (!this._provideCompletionItems) {
            this._provideCompletionItems = _provideCompletionItems.bind(this)
          }
          let result = await this._provideCompletionItems(
            originalModel === model ? proxyModel : originalModel,
            ...rest
          )
          if (!result?.suggestions) {
            return result
          }
          return {
            ...result,
            suggestions: result.suggestions.flatMap((suggestion) => {
              if (suggestion.kind === 1 && suggestion.label === 'calc()') {
                return [
                  suggestion,
                  {
                    ...suggestion,
                    label: 'theme()',
                    sortText: 'theme()',
                    filterText: 'theme',
                    insertText: 'theme($1)',
                    documentation:
                      'Use the `theme()` function to access your Tailwind config values using dot notation.',
                    command: { title: '', id: 'editor.action.triggerSuggest' },
                  },
                ]
              }
              return [suggestion]
            }),
          }
        }
        disposables.push({
          dispose() {
            CompletionAdapter.prototype.provideCompletionItems =
              _provideCompletionItems
          },
        })

        const _provideDocumentColors =
          DocumentColorAdapter.prototype.provideDocumentColors
        DocumentColorAdapter.prototype.provideDocumentColors = function (
          originalModel,
          ...rest
        ) {
          if (!this._provideDocumentColors) {
            this._provideDocumentColors = _provideDocumentColors.bind(this)
          }
          return this._provideDocumentColors(
            originalModel === model ? proxyModel : originalModel,
            ...rest
          )
        }
        disposables.push({
          dispose() {
            DocumentColorAdapter.prototype.provideDocumentColors =
              _provideDocumentColors
          },
        })

        const _provideHover = HoverAdapter.prototype.provideHover
        HoverAdapter.prototype.provideHover = function (
          originalModel,
          ...rest
        ) {
          if (!this._provideHover) {
            this._provideHover = _provideHover.bind(this)
          }
          return this._provideHover(
            originalModel === model ? proxyModel : originalModel,
            ...rest
          )
        }
        disposables.push({
          dispose() {
            HoverAdapter.prototype.provideHover = _provideHover
          },
        })

        DiagnosticsAdapter.prototype._doValidate = function (
          resource,
          languageId
        ) {
          this._worker(resource)
            .then(function (worker) {
              return worker.doValidation(
                resource.toString() === CSS_URI
                  ? CSS_PROXY_URI
                  : resource.toString()
              )
            })
            .then(function (diagnostics) {
              var markers = diagnostics.map(function (d) {
                return toDiagnostics(resource, d)
              })
              var model = monaco.editor.getModel(resource)
              if (model.getLanguageId() === languageId) {
                monaco.editor.setModelMarkers(
                  model,
                  languageId,
                  markers.filter(
                    (marker) =>
                      marker.code !== 'unknownAtRules' ||
                      !/@(tailwind|screen|responsive|variants|layer|config|___)$/.test(
                        marker.message
                      )
                  )
                )
              }
            })
            .then(undefined, function (err) {
              console.error(err)
            })
        }

        disposables.push(
          monaco.languages.registerCompletionItemProvider('tailwindcss', {
            triggerCharacters: [' ', '"', "'", '.', '('],
            provideCompletionItems: async function (model, position) {
              if (!worker.current) return { suggestions: [] }
              const { result } = await requestResponse(worker.current, {
                lsp: {
                  type: 'complete',
                  text: model.getValue(),
                  language: 'css',
                  uri: CSS_URI,
                  position,
                },
              })
              return result ? result : { suggestions: [] }
            },
          })
        )

        disposables.push(
          monaco.languages.registerHoverProvider('tailwindcss', {
            provideHover: async (model, position) => {
              let { result } = await requestResponse(worker.current, {
                lsp: {
                  type: 'hover',
                  text: model.getValue(),
                  language: 'css',
                  uri: CSS_URI,
                  position,
                },
              })
              return result
            },
          })
        )

        model = monaco.editor.createModel(
          content || '',
          'tailwindcss',
          monaco.Uri.parse(CSS_URI)
        )
        model.updateOptions({ indentSize: 2, tabSize: 2 })
        disposables.push(model)

        const proxyModel = monaco.editor.createModel(
          augmentCss(content || ''),
          'tailwindcss',
          CSS_PROXY_URI
        )
        proxyModel.updateOptions({ indentSize: 2, tabSize: 2 })
        disposables.push(proxyModel)

        updateDecorations = debounce(async () => {
          let { result: colors } = await requestResponse(worker.current, {
            lsp: {
              type: 'documentColors',
              text: model.getValue(),
              language: 'css',
              uri: CSS_URI,
            },
          })
          renderColorDecorators(getEditor(), model, colors)

          let { result } = await requestResponse(worker.current, {
            lsp: {
              type: 'validate',
              text: model.getValue(),
              language: 'css',
              uri: CSS_URI,
            },
          })

          if (model.isDisposed()) return

          if (result) {
            monaco.editor.setModelMarkers(
              model,
              'default',
              supplementMarkers(result)
            )
          } else {
            monaco.editor.setModelMarkers(model, 'default', [])
          }
        }, 100)

        updateDecorations()

        disposables.push(
          model.onDidChangeContent(async () => {
            onChange()
            proxyModel.setValue(augmentCss(model.getValue()))

            updateDecorations()
          })
        )
      }
      getEditor().setModel(model)
    },
    dispose() {
      disposables.forEach((disposable) => disposable.dispose())
    },
  }
}

const languageConfiguration = {
  wordPattern: /(#?-?\d*\.\d\w*%?)|((::|[@#.!:])?[\w-?]+%?)|::|[@#.!:]/g,

  comments: {
    blockComment: ['/*', '*/'],
  },

  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],

  autoClosingPairs: [
    { open: '{', close: '}', notIn: ['string', 'comment'] },
    { open: '[', close: ']', notIn: ['string', 'comment'] },
    { open: '(', close: ')', notIn: ['string', 'comment'] },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
  ],

  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],

  folding: {
    markers: {
      start: new RegExp('^\\s*\\/\\*\\s*#region\\b\\s*(.*?)\\s*\\*\\/'),
      end: new RegExp('^\\s*\\/\\*\\s*#endregion\\b.*\\*\\/'),
    },
  },
}

const language = {
  defaultToken: '',
  tokenPostfix: '.css',

  ws: '[ \t\n\r\f]*', // whitespaces (referenced in several rules)
  identifier:
    '-?-?([a-zA-Z]|(\\\\(([0-9a-fA-F]{1,6}\\s?)|[^[0-9a-fA-F])))([\\w\\-]|(\\\\(([0-9a-fA-F]{1,6}\\s?)|[^[0-9a-fA-F])))*',

  brackets: [
    { open: '{', close: '}', token: 'delimiter.bracket' },
    { open: '[', close: ']', token: 'delimiter.bracket' },
    { open: '(', close: ')', token: 'delimiter.parenthesis' },
    { open: '<', close: '>', token: 'delimiter.angle' },
  ],

  tokenizer: {
    root: [{ include: '@selector' }],

    selector: [
      { include: '@comments' },
      { include: '@import' },
      { include: '@strings' },
      [
        '[@](keyframes|-webkit-keyframes|-moz-keyframes|-o-keyframes)',
        { token: 'keyword', next: '@keyframedeclaration' },
      ],
      [
        '[@](media)',
        {
          token: 'keyword',
          next: '@mediadeclaration',
        },
      ],
      [
        '[@](supports)',
        {
          token: 'keyword',
          next: '@mediadeclaration',
        },
      ],
      ['[@](tailwind)', { token: 'keyword', next: '@tailwinddirective' }],
      ['[@](screen)', { token: 'keyword', next: '@screenheader' }],
      ['[@](variants)', { token: 'keyword', next: '@variantsheader' }],
      ['[@](responsive)', { token: 'keyword', next: '@responsiveheader' }],
      ['[@](layer)', { token: 'keyword', next: '@layerheader' }],
      ['[@](page|content|font-face|-moz-document)', { token: 'keyword' }],
      [
        '[@](charset|namespace|config)',
        { token: 'keyword', next: '@declarationbody' },
      ],
      [
        '(url-prefix)(\\()',
        [
          'attribute.value',
          { token: 'delimiter.parenthesis', next: '@urldeclaration' },
        ],
      ],
      [
        '(url)(\\()',
        [
          'attribute.value',
          { token: 'delimiter.parenthesis', next: '@urldeclaration' },
        ],
      ],
      { include: '@selectorname' },
      ['[\\*]', 'tag'], // selector symbols
      ['[>\\+,]', 'delimiter'], // selector operators
      ['\\[', { token: 'delimiter.bracket', next: '@selectorattribute' }],
      ['{', { token: 'delimiter.bracket', next: '@selectorbody' }],
    ],

    selectorbody: [
      { include: '@comments' },
      [
        '--@identifier@ws(?=:(\\s|\\d|[^{;}]*[;}]))',
        'variable',
        '@rulevaluestart',
      ],
      [
        '[*_]?@identifier@ws(?=:(\\s|\\d|[^{;}]*[;}]))',
        'attribute.name',
        '@rulevaluestart',
      ], // rule definition: to distinguish from a nested selector check for whitespace, number or a semicolon
      ['}', { token: 'delimiter.bracket', next: '@pop' }],

      ['[@]apply', { token: 'keyword', next: '@applybody' }],
    ],

    applybody: [
      { include: '@comments' },
      ['!important', 'keyword'],
      [';', 'delimiter', '@pop'],
    ],

    selectorname: [
      ['::?(@identifier)', 'pseudo'],
      ['(\\.|#(?=[^{])|%|(@identifier))+', 'tag'], // selector (.foo, div, ...)
      ['\\\\', { token: 'tag', next: 'selectorescape' }],
    ],

    selectorescape: [[/./, { token: 'tag', next: '@pop' }]],

    selectorattribute: [
      { include: '@term' },
      [']', { token: 'delimiter.bracket', next: '@pop' }],
    ],

    term: [
      { include: '@comments' },
      [
        '(url-prefix)(\\()',
        [
          'function',
          { token: 'delimiter.parenthesis', next: '@urldeclaration' },
        ],
      ],
      [
        '(url)(\\()',
        [
          'function',
          { token: 'delimiter.parenthesis', next: '@urldeclaration' },
        ],
      ],
      [
        '(theme)(\\()',
        [
          'function',
          { token: 'delimiter.parenthesis', next: '@urldeclaration' },
        ],
      ],
      { include: '@functioninvocation' },
      { include: '@numbers' },
      { include: '@name' },
      ['([<>=\\+\\-\\*\\/\\^\\|\\~,])', 'delimiter'],
      [',', 'delimiter'],
    ],

    rulevaluestart: [[':', { token: 'delimiter', switchTo: '@rulevalue' }]],
    rulevalue: [
      { include: '@comments' },
      { include: '@strings' },
      { include: '@term' },
      ['!important', 'keyword'],
      [';', 'delimiter', '@pop'],
      ['(?=})', { token: '', next: '@pop' }], // missing semicolon
    ],

    warndebug: [
      ['[@](warn|debug)', { token: 'keyword', next: '@declarationbody' }],
    ],

    import: [['[@](import)', { token: 'keyword', next: '@declarationbody' }]],

    urldeclaration: [
      { include: '@strings' },
      ['[^)\r\n]+', 'string'],
      ['\\)', { token: 'delimiter.parenthesis', next: '@pop' }],
    ],

    parenthizedterm: [
      { include: '@term' },
      ['\\)', { token: 'delimiter.parenthesis', next: '@pop' }],
    ],

    declarationbody: [
      { include: '@term' },
      [';', 'delimiter', '@pop'],
      ['(?=})', { token: '', next: '@pop' }], // missing semicolon
    ],

    comments: [
      ['\\/\\*', 'comment', '@comment'],
      ['\\/\\/+.*', 'comment'],
    ],

    comment: [
      ['\\*\\/', 'comment', '@pop'],
      [/[^*/]+/, 'comment'],
      [/./, 'comment'],
    ],

    name: [['@identifier', 'attribute.value']],

    numbers: [
      [
        '-?(\\d*\\.)?\\d+([eE][\\-+]?\\d+)?',
        { token: 'attribute.value.number', next: '@units' },
      ],
      ['#[0-9a-fA-F_]+(?!\\w)', 'attribute.value.hex'],
    ],

    units: [
      [
        '(em|ex|ch|rem|vmin|vmax|vw|vh|vm|cm|mm|in|px|pt|pc|deg|grad|rad|turn|s|ms|Hz|kHz|%)?',
        'attribute.value.unit',
        '@pop',
      ],
    ],

    keyframedeclaration: [
      { include: '@comments' },
      ['@identifier', 'attribute.value'],
      ['{', { token: 'delimiter.bracket', switchTo: '@keyframebody' }],
    ],

    mediadeclaration: [
      { include: '@comments' },
      [',', { token: 'delimiter' }],
      ['\\(', { token: 'delimiter.bracket', next: '@mediaparam' }],
      ['{', { token: 'delimiter.bracket', switchTo: '@mediabody' }],
    ],
    mediaparam: [
      { include: '@comments' },
      { include: '@numbers' },
      ['@identifier@ws:', 'attribute.name'],
      ['\\)', 'delimiter.bracket', '@pop'],
    ],
    mediabody: [
      { include: '@selector' },
      ['}', { token: 'delimiter.bracket', next: '@pop' }],
    ],

    tailwinddirective: [
      { include: '@comments' },
      ['@identifier', 'attribute.value'],
      [';', 'delimiter', '@pop'],
    ],
    screenheader: [
      { include: '@comments' },
      ['@identifier', 'attribute.value'],
      ['{', { token: 'delimiter.bracket', switchTo: '@mediabody' }],
    ],
    layerheader: [
      { include: '@comments' },
      ['@identifier', 'attribute.value'],
      ['{', { token: 'delimiter.bracket', switchTo: '@mediabody' }],
    ],
    variantsheader: [
      { include: '@comments' },
      ['@identifier', 'attribute.value'],
      [',', 'delimiter'],
      ['{', { token: 'delimiter.bracket', switchTo: '@mediabody' }],
    ],
    responsiveheader: [
      { include: '@comments' },
      ['{', { token: 'delimiter.bracket', switchTo: '@mediabody' }],
    ],

    keyframebody: [
      { include: '@term' },
      ['{', { token: 'delimiter.bracket', next: '@selectorbody' }],
      ['}', { token: 'delimiter.bracket', next: '@pop' }],
    ],

    functioninvocation: [
      ['@identifier(?=\\()', { token: 'function', next: '@functionarguments' }],
    ],

    functionarguments: [
      ['\\(', 'delimiter.parenthesis'],
      ['\\$@identifier@ws:', 'attribute.name'],
      ['[,]', 'delimiter'],
      { include: '@term' },
      { include: '@strings' },
      ['\\)', { token: 'delimiter.parenthesis', next: '@pop' }],
    ],

    strings: [
      ['~?"', { token: 'string', next: '@stringenddoublequote' }],
      ["~?'", { token: 'string', next: '@stringendquote' }],
    ],

    stringenddoublequote: [
      ['\\\\.', 'string'],
      ['"', { token: 'string', next: '@pop' }],
      [/[^\\"]+/, 'string'],
      ['.', 'string'],
    ],

    stringendquote: [
      ['\\\\.', 'string'],
      ["'", { token: 'string', next: '@pop' }],
      [/[^\\']+/, 'string'],
      ['.', 'string'],
    ],
  },
}

function toSeverity(lsSeverity) {
  switch (lsSeverity) {
    case 1: // DiagnosticSeverity.Error
      return monaco.MarkerSeverity.Error
    case 2: // DiagnosticSeverity.Warning
      return monaco.MarkerSeverity.Warning
    case 3: // DiagnosticSeverity.Information
      return monaco.MarkerSeverity.Info
    case 4: // DiagnosticSeverity.Hint
      return monaco.MarkerSeverity.Hint
    default:
      return monaco.MarkerSeverity.Info
  }
}

function toDiagnostics(resource, diag) {
  var code = typeof diag.code === 'number' ? String(diag.code) : diag.code
  return {
    severity: toSeverity(diag.severity),
    startLineNumber: diag.range.start.line + 1,
    startColumn: diag.range.start.character + 1,
    endLineNumber: diag.range.end.line + 1,
    endColumn: diag.range.end.character + 1,
    message: diag.message,
    code: code,
    source: diag.source,
  }
}

function augmentCss(css) {
  return css
    .replace(
      /@apply[^;}]+[;}]/g,
      (m) =>
        '@___{}' + m.substr(6).replace(/./g, (m) => (m === '}' ? '}' : ' '))
    )
    .replace(/@screen([^{]{2,})\{/g, (_m, p1) => {
      return `@media(_)${' '.repeat(p1.length - 2)}{`
    })
    .replace(/@variants(\s[^{]+)\{/g, (_m, p1) => {
      return `@media(_)${' '.repeat(p1.length)}{`
    })
    .replace(/@responsive(\s*)\{/g, (_m, p1) => {
      return `@media(_)  ${' '.repeat(p1.length)}{`
    })
    .replace(/@layer([^{]{3,})\{/g, (_m, p1) => {
      return `@media(_)${' '.repeat(p1.length - 3)}{`
    })
    .replace(/@config\s*('[^']*'|"[^"]*")(\s*;)?/g, (m) => m.replace(/./g, ' '))
    .replace(
      /(\b(?:theme|config)\()([^)]*)/g,
      (_match, prefix, inner) => `${prefix}${inner.replace(/[.[\]]/g, '_')}`
    )
}
