import { readFile } from 'node:fs/promises'

const workflowPaths = process.argv.slice(2)
if (workflowPaths.length === 0) {
  throw new Error('Usage: node ops/ci/check-action-pins.mjs <workflow.yml> [...]')
}

const commitPinnedAction =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.@/-]+)?@[0-9a-f]{40}$/u
const digestPinnedContainer = /^docker:\/\/[A-Za-z0-9._:/-]+@sha256:[0-9a-f]{64}$/u
const failures = []
let checked = 0

for (const workflowPath of workflowPaths) {
  const lines = (await readFile(workflowPath, 'utf8')).split(/\r?\n/u)
  lines.forEach((line, index) => {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('#') || !/\buses\s*:/u.test(line)) return

    const match = line.match(/^\s*(?:-\s*)?uses\s*:\s*(.+?)\s*$/u)
    if (match === null) {
      failures.push(`${workflowPath}:${index + 1}: unsupported uses syntax`)
      return
    }

    let reference = match[1].replace(/\s+#.*$/u, '').trim()
    if (
      (reference.startsWith("'") && reference.endsWith("'")) ||
      (reference.startsWith('"') && reference.endsWith('"'))
    ) {
      reference = reference.slice(1, -1)
    }
    checked += 1

    if (reference.startsWith('./')) return
    if (commitPinnedAction.test(reference) || digestPinnedContainer.test(reference)) return
    failures.push(
      `${workflowPath}:${index + 1}: ${reference} must use a full commit SHA or container digest`,
    )
  })
}

if (checked === 0) throw new Error('No action reference was found')
if (failures.length > 0) throw new Error(failures.join('\n'))

process.stdout.write(`Validated ${checked} immutable action reference(s).\n`)
