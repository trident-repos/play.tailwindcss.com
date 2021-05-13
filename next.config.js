const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin')
const withTM = require('next-transpile-modules')(['monaco-editor'])
const { createLoader } = require('simple-functional-loader')
const path = require('path')
const fs = require('fs')

const externals = {
  'fs-extra': 'self.fsextra',
  resolve: 'self.resolve',
  'fs.realpath': 'self.fsrealpath',
  purgecss: 'self.purgecss',
  chokidar: 'self.chokidar',
  'vscode-emmet-helper-bundled': 'null',
}

const moduleOverrides = {
  colorette: path.resolve(__dirname, 'src/modules/colorette.js'),
  fs: path.resolve(__dirname, 'src/modules/fs.js'),
}

function getExternal(context, request, callback) {
  if (/node_modules/.test(context) && externals[request]) {
    return callback(null, externals[request])
  }
  callback()
}

const files = [
  {
    pattern: /modern-noramlize/,
    file: require.resolve('modern-normalize'),
  },
  {
    pattern: /normalize/,
    file: require.resolve('normalize.css'),
  },
  {
    pattern: /preflight/,
    tailwindVersion: 1,
    file: path.resolve(
      __dirname,
      'node_modules/tailwindcss-v1/lib/plugins/css/preflight.css'
    ),
  },
  {
    pattern: /preflight/,
    tailwindVersion: 2,
    file: path.resolve(
      __dirname,
      'node_modules/tailwindcss/lib/plugins/css/preflight.css'
    ),
  },
]

function createReadFileReplaceLoader(tailwindVersion) {
  return createLoader(function (source) {
    return source.replace(/_fs\.default\.readFileSync\(.*?'utf8'\)/g, (m) => {
      for (let i = 0; i < files.length; i++) {
        if (
          files[i].pattern.test(m) &&
          (!files[i].tailwindVersion ||
            files[i].tailwindVersion === tailwindVersion)
        ) {
          return (
            '`' +
            fs.readFileSync(files[i].file, 'utf8').replace(/`/g, '\\`') +
            '`'
          )
        }
      }
      return m
    })
  })
}

module.exports = withTM({
  async headers() {
    return [
      {
        source: '/plugins/:path*',
        headers: [
          {
            key: 'cache-control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ]
  },
  webpack: (config, { isServer, webpack }) => {
    config.resolve.alias = { ...config.resolve.alias, ...moduleOverrides }

    config.module.rules
      .filter((rule) => rule.oneOf)
      .forEach((rule) => {
        rule.oneOf.forEach((r) => {
          if (
            r.issuer &&
            r.issuer.and &&
            r.issuer.and.length === 1 &&
            r.issuer.and[0] ===
              require('path').resolve(process.cwd(), 'src/pages/_app.js')
          ) {
            r.issuer.or = [
              ...r.issuer.and,
              /[\\/]node_modules[\\/]monaco-editor[\\/]/,
            ]
            delete r.issuer.and
          }
        })
      })

    config.plugins.push(
      new MonacoWebpackPlugin({
        languages: ['css', 'typescript', 'javascript', 'html'],
        filename: 'static/chunks/[name].worker.js',
      })
    )

    if (!isServer) {
      if (config.externals) {
        config.externals.push(getExternal)
      } else {
        config.externals = [getExternal]
      }
    }

    config.module.rules.push({
      test: {
        or: [
          require.resolve('monaco-editor/esm/vs/language/css/cssWorker.js'),
          require.resolve('monaco-editor/dev/vs/language/css/cssWorker.js'),
        ],
      },
      use: [
        createLoader(function (source) {
          return source.replace(
            "case 'css':",
            "case 'css':\ncase 'tailwindcss':"
          )
        }),
      ],
    })

    config.module.rules.push({
      test: require.resolve('tailwindcss-v1/lib/plugins/preflight.js'),
      use: [createReadFileReplaceLoader(1)],
    })

    config.module.rules.push({
      test: require.resolve('tailwindcss/lib/plugins/preflight.js'),
      use: [createReadFileReplaceLoader(2)],
    })

    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.TAILWIND_MODE': JSON.stringify('build'),
        'process.env.TAILWIND_DISABLE_TOUCH': true,
      })
    )

    // there's some node-specific stuff in parse-glob
    // we don't use globs though so this can be overridden
    config.module.rules.push({
      test: require.resolve('parse-glob'),
      use: [
        createLoader(function (_source) {
          return `module.exports = () => ({
            is: { glob: false },
          })`
        }),
      ],
    })

    // avoids node-specific stuff
    // this essentially makes fast-glob return whatever it is passed
    config.module.rules.push({
      test: require.resolve('fast-glob'),
      use: [
        createLoader(function (_source) {
          return `module.exports = {
            sync: (patterns) => [].concat(patterns)
          }`
        }),
      ],
    })

    config.module.rules.push({
      resourceQuery: /version/,
      use: createLoader(function (source) {
        return `{ "version": "${JSON.parse(source).version}" }`
      }),
    })

    // https://github.com/tailwindlabs/tailwindcss/pull/4005
    config.module.rules.push({
      test: require.resolve('tailwindcss/jit/pluginUtils.js'),
      use: createLoader(function (source) {
        return source.replace(
          `return transform(value).replace(/(?<=^calc\\(.+?)(?<![-+*/(])([-+*/])/g, ' $1 ')`,
          `
            value = transform(value)

            if (value.startsWith('calc(')) {
              // add spaces around operators inside calc() that do not follow an operator or (
              return value.replace(/[-+*/(]+/g, (match) =>
                match[0] === '(' ? match : [' ', match[0], ' ', ...match.slice(1)].join('')
              )
            }

            return value
          `
        )
      }),
    })

    // mock `fileURLToPath` and `pathToFileURL` functions
    // from the `url` module
    config.module.rules.push({
      test: {
        or: [
          require.resolve('postcss/lib/input.js'),
          require.resolve('postcss/lib/map-generator.js'),
        ],
      },
      use: [
        createLoader(function (source) {
          return source.replace(
            /let {\s*([^}]+)\s*} = require\('url'\)/,
            (_, names) =>
              names
                .split(/\s*,\s*/)
                .reduce((acc, cur) => `${acc}let ${cur} = x => x;`, '')
          )
        }),
      ],
    })

    config.output.globalObject = 'self'

    return config
  },
})
