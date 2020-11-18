// @preval
module.exports = {
  pluginBuilder: '3',
  '@tailwindcss/custom-forms': require('@tailwindcss/custom-forms/package.json')
    .version,
  '@tailwindcss/forms': require('@tailwindcss/forms/package.json').version,
  '@tailwindcss/typography': require('@tailwindcss/typography/package.json')
    .version,
  '@tailwindcss/ui': require('@tailwindcss/ui/package.json').version,
  'monaco-editor': require('monaco-editor/package.json').version,
  tailwindcss: require('tailwindcss/package.json').version,
  'tailwindcss-v1': require('tailwindcss-v1/package.json').version,
}
