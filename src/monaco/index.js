import * as monaco from 'monaco-editor'
import { requestResponse } from '../utils/workers'
import { CommandsRegistry } from 'monaco-editor/esm/vs/platform/commands/common/commands'
import { setupHtmlMode } from './html'
import { setupCssMode } from './css'
import { setupJavaScriptMode } from './javascript'
import { getTheme } from '../utils/theme'
import colors from 'tailwindcss/colors'
import dlv from 'dlv'

function toHex(d) {
  return Number(d).toString(16).padStart(2, '0')
}

function getColor(path) {
  let [key, opacity = 1] = path.split('/')
  return (
    dlv(colors, key).replace('#', '') +
    toHex(Math.round(parseFloat(opacity) * 255))
  )
}

function makeTheme(themeColors) {
  return Object.entries(themeColors).map(([token, colorPath]) => ({
    token,
    foreground: getColor(colorPath),
  }))
}

export function createMonacoEditor({
  container,
  initialContent,
  onChange,
  worker,
  tailwindVersion,
}) {
  let editor
  let onChangeCallback = onChange
  const disposables = []
  let shouldTriggerOnChange = true

  window.MonacoEnvironment = {
    getWorkerUrl: (_moduleId, label) => {
      const v = `?v=${
        require('monaco-editor/package.json?fields=version').version
      }`
      if (label === 'css' || label === 'tailwindcss')
        return `_next/static/chunks/css.worker.js${v}`
      if (label === 'html') return `_next/static/chunks/html.worker.js${v}`
      if (label === 'typescript' || label === 'javascript')
        return `_next/static/chunks/ts.worker.js${v}`
      return `_next/static/chunks/editor.worker.js${v}`
    },
  }

  disposables.push(registerDocumentFormattingEditProviders(worker))

  const html = setupHtmlMode(
    initialContent.html,
    (newContent, options) => {
      triggerOnChange('html', newContent, options)
    },
    worker,
    () => editor
  )
  disposables.push(html)

  const css = setupCssMode(
    initialContent.css,
    () => {
      triggerOnChange('css')
    },
    worker,
    () => editor
  )
  disposables.push(css)

  const config = setupJavaScriptMode(
    initialContent.config,
    () => {
      triggerOnChange('config')
    },
    () => editor,
    tailwindVersion
  )
  disposables.push(config)

  monaco.editor.defineTheme('tw-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { foreground: getColor('gray.800') },
      ...makeTheme({
        comment: 'gray.400',
        string: 'indigo.600',
        number: 'gray.800',
        tag: 'sky.600',
        delimiter: 'gray.400',
        // HTML
        'attribute.name.html': 'sky.500',
        'attribute.value.html': 'indigo.600',
        'delimiter.html': 'gray.400',
        // JS
        'keyword.js': 'sky.600',
        'identifier.js': 'gray.800',
        // CSS
        'attribute.name.css': 'indigo.600',
        'attribute.value.unit.css': 'teal.600',
        'attribute.value.number.css': 'gray.800',
        'attribute.value.css': 'gray.800',
        'attribute.value.hex.css': 'gray.800',
        'keyword.css': 'sky.600',
        'function.css': 'teal.600',
        'pseudo.css': 'sky.600',
        'variable.css': 'gray.800',
      }),
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.selectionBackground': '#' + getColor('slate.200'),
      'editor.inactiveSelectionBackground': '#' + getColor('slate.200/0.4'),
      'editorLineNumber.foreground': '#' + getColor('gray.400'),
      'editor.lineHighlightBorder': '#' + getColor('slate.100'),
      'editorBracketMatch.background': '#00000000',
      'editorBracketMatch.border': '#' + getColor('slate.300'),
      'editorSuggestWidget.background': '#' + getColor('slate.50'),
      'editorSuggestWidget.selectedBackground': '#' + getColor('slate.400/0.1'),
      'editorSuggestWidget.selectedForeground': '#' + getColor('slate.700'),
      'editorSuggestWidget.foreground': '#' + getColor('slate.700'),
      'editorSuggestWidget.highlightForeground': '#' + getColor('indigo.500'),
      'editorSuggestWidget.focusHighlightForeground':
        '#' + getColor('indigo.500'),
      'editorHoverWidget.background': '#' + getColor('slate.50'),
      'editorError.foreground': '#' + getColor('red.500'),
      'editorWarning.foreground': '#' + getColor('yellow.500'),
    },
  })

  monaco.editor.defineTheme('tw-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { foreground: getColor('slate.50') },
      ...makeTheme({
        comment: 'slate.400',
        string: 'sky.300',
        number: 'slate.50',
        tag: 'pink.400',
        delimiter: 'slate.500',
        // HTML
        'attribute.name.html': 'slate.300',
        'attribute.value.html': 'sky.300',
        'delimiter.html': 'slate.500',
        // JS
        'keyword.js': 'slate.300',
        'identifier.js': 'slate.50',
        // CSS
        'attribute.name.css': 'sky.300',
        'attribute.value.unit.css': 'teal.200',
        'attribute.value.number.css': 'slate.50',
        'attribute.value.css': 'slate.50',
        'attribute.value.hex.css': 'slate.50',
        'keyword.css': 'slate.300',
        'function.css': 'teal.200',
        'pseudo.css': 'slate.300',
        'variable.css': 'slate.50',
      }),
    ],
    colors: {
      'editor.background': '#' + getColor('slate.800'),
      'editor.selectionBackground': '#' + getColor('slate.700'),
      'editor.inactiveSelectionBackground': '#' + getColor('slate.700/0.6'),
      'editorLineNumber.foreground': '#' + getColor('slate.600'),
      'editor.lineHighlightBorder': '#' + getColor('slate.700'),
      'editorBracketMatch.background': '#00000000',
      'editorBracketMatch.border': '#' + getColor('slate.500'),
      'editorSuggestWidget.background': '#' + getColor('slate.700'),
      'editorSuggestWidget.selectedBackground':
        '#' + getColor('slate.400/0.12'),
      'editorSuggestWidget.foreground': '#' + getColor('slate.300'),
      'editorSuggestWidget.selectedForeground': '#' + getColor('slate.300'),
      'editorSuggestWidget.highlightForeground': '#' + getColor('sky.400'),
      'editorSuggestWidget.focusHighlightForeground': '#' + getColor('sky.400'),
      'editorHoverWidget.background': '#' + getColor('slate.700'),
      'editorError.foreground': '#' + getColor('red.400'),
      'editorWarning.foreground': '#' + getColor('yellow.400'),
    },
  })

  editor = monaco.editor.create(container, {
    fontFamily:
      'Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: 14,
    lineHeight: 21,
    minimap: { enabled: false },
    theme: getTheme() === 'dark' ? 'tw-dark' : 'tw-light',
    fixedOverflowWidgets: true,
    scrollbar: {
      horizontalScrollbarSize: 21,
    },
    quickSuggestions: {
      strings: true,
    },
  })
  window.MonacoEditor = editor
  disposables.push(editor)

  setupKeybindings(editor)

  function triggerOnChange(id, newContent, options) {
    if (onChangeCallback && shouldTriggerOnChange) {
      onChangeCallback(
        id,
        {
          html:
            id === 'html' && typeof newContent !== 'undefined'
              ? newContent
              : html.getModel()?.getValue() ?? initialContent.html,
          css:
            id === 'css' && typeof newContent !== 'undefined'
              ? newContent
              : css.getValue() ?? initialContent.css,
          config:
            id === 'config' && typeof newContent !== 'undefined'
              ? newContent
              : config.getModel()?.getValue() ?? initialContent.config,
        },
        options
      )
    }
  }

  worker.current.addEventListener('message', (event) => {
    if (event.data.css) {
      const currentModel = editor.getModel()
      if (currentModel === html.getModel()) {
        html.updateDecorations()
      } else if (currentModel === css.getModel()) {
        css.updateDecorations()
      }
    }
  })

  let isInitialChange = true
  editor.onDidChangeModel(() => {
    if (isInitialChange) {
      isInitialChange = false
      return
    }
    const currentModel = editor.getModel()
    if (currentModel === html.getModel()) {
      html.updateDecorations()
    } else if (currentModel === css.getModel()) {
      css.updateDecorations()
    }
  })

  const documents = { html, css, config }

  return {
    editor,
    documents,
    getValue(doc) {
      return documents[doc].getModel()?.getValue() ?? initialContent[doc]
    },
    reset(content) {
      shouldTriggerOnChange = false
      initialContent = content
      if (documents.html.getModel()) {
        documents.html.getModel().setValue(content.html)
      }
      if (documents.css.getModel()) {
        documents.css.getModel().setValue(content.css)
      }
      if (documents.config.getModel()) {
        documents.config.getModel().setValue(content.config)
      }
      window.setTimeout(() => {
        shouldTriggerOnChange = true
      }, 0)
    },
    setTailwindVersion(tailwindVersion) {
      config.setTailwindVersion(tailwindVersion)
    },
    dispose() {
      disposables.forEach((disposable) => disposable.dispose())
    },
    setOnChange(fn) {
      onChangeCallback = fn
    },
  }
}

function setupKeybindings(editor) {
  let formatCommandId = 'editor.action.formatDocument'
  editor._standaloneKeybindingService.addDynamicKeybinding(
    `-${formatCommandId}`,
    null,
    () => {}
  )
  const { handler, when } = CommandsRegistry.getCommand(formatCommandId)
  editor._standaloneKeybindingService.addDynamicKeybinding(
    formatCommandId,
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
    handler,
    when
  )
}

function registerDocumentFormattingEditProviders(worker) {
  const disposables = []

  const formattingEditProvider = {
    async provideDocumentFormattingEdits(model, _options, _token) {
      const { result, error } = await requestResponse(worker.current, {
        prettier: {
          text: model.getValue(),
          language: model.getLanguageId(),
        },
      })
      if (error) return []
      return [
        {
          range: model.getFullModelRange(),
          text: result,
        },
      ]
    },
  }

  // override the built-in HTML formatter
  const _registerDocumentFormattingEditProvider =
    monaco.languages.registerDocumentFormattingEditProvider
  monaco.languages.registerDocumentFormattingEditProvider = (id, provider) => {
    if (id !== 'html') {
      return _registerDocumentFormattingEditProvider(id, provider)
    }
    return _registerDocumentFormattingEditProvider(
      'html',
      formattingEditProvider
    )
  }
  disposables.push(
    monaco.languages.registerDocumentFormattingEditProvider(
      'tailwindcss',
      formattingEditProvider
    )
  )
  disposables.push(
    monaco.languages.registerDocumentFormattingEditProvider(
      'javascript',
      formattingEditProvider
    )
  )

  return {
    dispose() {
      disposables.forEach((disposable) => disposable.dispose())
    },
  }
}
