'use strict'

const crypto = require('crypto')
const fs = require('fs')
const fsp = fs.promises
const os = require('os')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const CURRENT_PATH = 'memory/CURRENT.md'
const STATE_NAMESPACE = 'codex-current-memory-guard'

function gitExecutable() {
  const argumentIndex = process.argv.indexOf('--git')
  if (argumentIndex !== -1 && process.argv[argumentIndex + 1]) {
    return process.argv[argumentIndex + 1]
  }
  return process.env.CODEX_CURRENT_GUARD_GIT || 'git'
}

async function readInput() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) {
    throw new Error('Hook input is empty')
  }
  return JSON.parse(raw)
}

function git(repoRoot, args) {
  const result = spawnSync(gitExecutable(), args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'Git command failed').trim())
  }
  return result.stdout
}

function findRepoRoot(cwd) {
  const result = spawnSync(gitExecutable(), ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || 'Not inside a Git repository').trim())
  }
  return path.resolve(result.stdout.trim())
}

function normalizeRepoPath(filePath) {
  return filePath.split(path.sep).join('/')
}

function stateFilePath(repoRoot, input) {
  const sessionId = input.session_id || 'unknown-session'
  const turnId = input.turn_id || 'unknown-turn'
  const key = crypto
    .createHash('sha256')
    .update(`${normalizeRepoPath(repoRoot)}\0${sessionId}\0${turnId}`)
    .digest('hex')
  const root = process.env.CODEX_CURRENT_GUARD_STATE_DIR
    || path.join(os.tmpdir(), STATE_NAMESPACE)
  return path.join(root, `${key}.json`)
}

async function hashGitDiff(repoRoot, hash) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      gitExecutable(),
      [
        'diff',
        '--binary',
        '--no-ext-diff',
        'HEAD',
        '--',
        '.',
        `:(exclude)${CURRENT_PATH}`
      ],
      {
        cwd: repoRoot,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    const errors = []

    child.stdout.on('data', (chunk) => hash.update(chunk))
    child.stderr.on('data', (chunk) => errors.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(Buffer.concat(errors).toString('utf8').trim() || 'git diff failed'))
    })
  })
}

async function hashFile(hash, absolutePath, relativePath) {
  const stat = await fsp.lstat(absolutePath)
  hash.update(`path\0${relativePath}\0mode\0${stat.mode}\0`)

  if (stat.isSymbolicLink()) {
    hash.update(`link\0${await fsp.readlink(absolutePath)}\0`)
    return
  }
  if (!stat.isFile()) {
    hash.update('non-file\0')
    return
  }

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(absolutePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  hash.update('\0')
}

async function workspaceFingerprint(repoRoot) {
  const hash = crypto.createHash('sha256')

  // Git diff 覆盖所有已跟踪、已暂存和未暂存改动，并明确排除 CURRENT.md。
  await hashGitDiff(repoRoot, hash)

  // Git diff 不包含未跟踪文件，因此单独加入路径和文件内容。
  const untracked = git(
    repoRoot,
    ['ls-files', '--others', '--exclude-standard', '-z']
  )
    .split('\0')
    .filter(Boolean)
    .map(normalizeRepoPath)
    .filter((item) => item !== CURRENT_PATH)
    .sort()

  for (const relativePath of untracked) {
    await hashFile(hash, path.join(repoRoot, relativePath), relativePath)
  }

  return hash.digest('hex')
}

async function currentFingerprint(repoRoot) {
  const currentFile = path.join(repoRoot, ...CURRENT_PATH.split('/'))
  try {
    const content = await fsp.readFile(currentFile)
    return crypto.createHash('sha256').update(content).digest('hex')
  } catch (error) {
    if (error.code === 'ENOENT') {
      return 'missing'
    }
    throw error
  }
}

async function writeState(filePath, state) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await fsp.writeFile(temporaryPath, JSON.stringify(state), 'utf8')
  await fsp.rename(temporaryPath, filePath)
}

async function removeState(filePath) {
  try {
    await fsp.unlink(filePath)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function warning(message) {
  emit({
    continue: true,
    systemMessage: `CURRENT.md Hook 检查未完成，已放行：${message}`
  })
}

async function handleUserPromptSubmit(input, repoRoot, filePath) {
  const state = {
    repoRoot,
    workspace: await workspaceFingerprint(repoRoot),
    current: await currentFingerprint(repoRoot)
  }
  await writeState(filePath, state)

  emit({
    systemMessage: '本项目启用了 CURRENT.md 更新守卫。如本轮会修改项目，请先更新 memory/CURRENT.md 的任务、目标、验收标准、影响区域和下一步。'
  })
}

async function handleStop(repoRoot, filePath) {
  let baseline
  try {
    baseline = JSON.parse(await fsp.readFile(filePath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      warning('没有找到本轮开始基线')
      return
    }
    throw error
  }

  if (path.resolve(baseline.repoRoot) !== repoRoot) {
    warning('基线所属仓库与当前仓库不一致')
    return
  }

  const [workspace, current] = await Promise.all([
    workspaceFingerprint(repoRoot),
    currentFingerprint(repoRoot)
  ])

  if (workspace === baseline.workspace || current !== baseline.current) {
    await removeState(filePath)
    return
  }

  const message = '本轮修改了项目文件，但 memory/CURRENT.md 未更新。请先记录当前进度、验证结果、剩余风险或下一步。'
  emit({
    continue: false,
    stopReason: message,
    systemMessage: message
  })
}

async function main() {
  try {
    const input = await readInput()
    const repoRoot = findRepoRoot(input.cwd || process.cwd())
    const filePath = stateFilePath(repoRoot, input)

    if (input.hook_event_name === 'UserPromptSubmit') {
      await handleUserPromptSubmit(input, repoRoot, filePath)
      return
    }
    if (input.hook_event_name === 'Stop') {
      await handleStop(repoRoot, filePath)
    }
  } catch (error) {
    warning(error && error.message ? error.message : String(error))
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  CURRENT_PATH,
  currentFingerprint,
  findRepoRoot,
  stateFilePath,
  workspaceFingerprint
}
