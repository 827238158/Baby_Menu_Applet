const { spawnSync } = require('child_process')
const path = require('path')

const scriptPath = path.join(__dirname, 'generate-menu-data.py')
const codexPython = process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe')
  : null
const candidates = [
  process.env.PYTHON ? { command: process.env.PYTHON, args: [] } : null,
  codexPython ? { command: codexPython, args: [] } : null,
  { command: 'python', args: [] },
  { command: 'py', args: ['-3'] },
  { command: 'python3', args: [] }
].filter(Boolean)

const missingOpenpyxl = []
const failedCommands = []

for (const candidate of candidates) {
  const result = spawnSync(candidate.command, candidate.args.concat(scriptPath), {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  })

  if (result.error && result.error.code === 'ENOENT') {
    continue
  }

  if (result.stdout) {
    process.stdout.write(result.stdout)
  }

  if (result.status === 0) {
    process.exit(0)
  }

  if (result.stderr) {
    process.stderr.write(result.stderr)
  }

  if (result.stderr && result.stderr.includes('Missing Python dependency: openpyxl')) {
    missingOpenpyxl.push(candidate.command)
    continue
  }

  if (!result.stdout && !result.stderr) {
    failedCommands.push(candidate.command + ' exited with status ' + result.status)
    continue
  }

  process.exit(result.status || 1)
}

if (missingOpenpyxl.length) {
  console.error('Python was found, but openpyxl is not installed for: ' + missingOpenpyxl.join(', '))
  console.error('Install it with: python -m pip install openpyxl')
} else {
  console.error('Python was not found. Install Python 3, then run: python -m pip install openpyxl')
}

if (failedCommands.length) {
  console.error('Silent Python failures:')
  failedCommands.forEach((item) => console.error('- ' + item))
  console.error('You can point to a working Python with: $env:PYTHON="C:\\Path\\To\\python.exe"')
}

process.exit(1)
