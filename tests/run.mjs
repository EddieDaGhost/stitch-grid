#!/usr/bin/env node
/**
 * The whole test runner. No framework, no assertion library, no browser download.
 *
 *   npm run check              everything
 *   npm run check -- gauge     one suite
 *   TEST_URL=https://... npm run check    against a deployed build
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createChecker, launchBrowser, newTabletPage, BASE_URL } from './harness.mjs'

const SUITES = [
  { name: 'color', file: './color.mjs', browser: false },
  { name: 'gauge', file: './gauge.mjs', browser: false },
  { name: 'layout', file: './layout.mjs', browser: false },
  { name: 'quantize', file: './quantize.mjs', browser: false },
  { name: 'chart', file: './chart.mjs', browser: false },
  { name: 'pattern', file: './pattern.mjs', browser: false },
  { name: 'progress', file: './progress.mjs', browser: false },
  { name: 'draw', file: './draw.mjs', browser: false },
  { name: 'pdf', file: './pdf.mjs', browser: false },
  { name: 'history', file: './history.mjs', browser: false },
  { name: 'walkthrough', file: './walkthrough.mjs', browser: true },
  { name: 'export', file: './export.mjs', browser: true, clipboard: true },
  { name: 'tablet', file: './tablet.mjs', browser: true, ownContexts: true },
]

const filter = process.argv[2]
const selected = filter ? SUITES.filter((s) => s.name === filter) : SUITES
if (!selected.length) {
  console.error(`No suite called "${filter}". Known: ${SUITES.map((s) => s.name).join(', ')}`)
  process.exit(1)
}

const needsBrowser = selected.some((s) => s.browser)
const root = fileURLToPath(new URL('..', import.meta.url))

let server = null
let browser = null
let failed = 0
let total = 0
const summary = []

try {
  if (needsBrowser && !process.env.TEST_URL) {
    if (!existsSync(join(root, 'dist', 'index.html'))) {
      console.log('Building first...')
      await run('npm', ['run', 'build'])
    }
    server = spawn('npx', ['vite', 'preview', '--port', '4173', '--host', '127.0.0.1'], {
      cwd: root,
      stdio: 'ignore',
    })
    await waitForServer(BASE_URL, 30000)
  }

  if (needsBrowser) browser = await launchBrowser()
  const tmp = mkdtempSync(join(tmpdir(), 'stitch-grid-'))

  for (const suite of selected) {
    console.log(`\n${suite.name}`)
    const check = createChecker(suite.name)
    const module = await import(suite.file)

    if (suite.browser) {
      const { context, page, errors } = await newTabletPage(browser, suite)
      try {
        await module.default({ browser, context, page, check, errors, URL: BASE_URL, tmp })
      } finally {
        await context.close()
      }
    } else {
      await module.default({ check, tmp })
    }

    const bad = check.results.filter((r) => !r.ok).length
    failed += bad
    total += check.results.length
    summary.push({ name: suite.name, count: check.results.length, bad })
  }
} catch (error) {
  console.error(`\nRunner failed: ${error?.stack ?? error}`)
  failed += 1
} finally {
  await browser?.close?.()
  server?.kill?.()
}

console.log('')
for (const row of summary) {
  const label = row.name.padEnd(14)
  console.log(`  ${label} ${String(row.count).padStart(4)} checks  ${row.bad ? `${row.bad} FAILED` : 'ok'}`)
}
console.log(failed === 0 ? `\nAll ${total} checks passed.` : `\n${failed} of ${total} checks FAILED.`)
process.exit(failed === 0 ? 0 : 1)

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit' })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
  })
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Preview server never came up at ${url}`)
}
