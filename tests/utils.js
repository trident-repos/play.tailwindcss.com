const { expect } = require('@playwright/test')

module.exports.initialBuild = async function initialBuild(
  page,
  expectedVersion
) {
  let iframe = page.frameLocator('iframe')
  let stylesheet = iframe.locator('#_style')
  let expectedText = '/* ! tailwindcss v'
  if (expectedVersion) {
    expectedText += expectedVersion
  }
  await expect(stylesheet).toContainText(expectedText, {
    timeout: 12000,
  })
  return { iframe }
}

module.exports.editTab = async function editTab(page, tab, content) {
  await page.locator(`button:text-is("${tab}")`).click()
  await page.waitForFunction(
    (tab) => window.MonacoEditor.getModel().uri.path === `/${tab}`,
    tab
  )
  await page.evaluate(
    (content) => window.MonacoEditor.getModel().setValue(content),
    content
  )
}
