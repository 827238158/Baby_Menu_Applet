'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { spawnSync } = require('child_process')

const hookScript = path.resolve(__dirname, 'current-memory-guard.cjs')
const windowsLauncher = path.resolve(__dirname, 'invoke-current-memory-guard.ps1')

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

function createRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'current-memory-hook-test-'))
  fs.mkdirSync(path.join(root, 'memory'), { recursive: true })
  fs.writeFileSync(path.join(root, 'memory', 'CURRENT.md'), '# Current\n\nInitial\n')
  fs.writeFileSync(path.join(root, 'source.txt'), 'initial\n')
  fs.writeFileSync(path.join(root, 'delete-me.txt'), 'delete me\n')

  run('git', ['init', '--quiet'], root)
  run('git', ['config', 'user.email', 'hook-test@example.invalid'], root)
  run('git', ['config', 'user.name', 'Hook Test'], root)
  run('git', ['add', '.'], root)
  run('git', ['commit', '--quiet', '-m', 'initial'], root)

  return {
    root,
    stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'current-memory-hook-state-'))
  }
}

function invokeHook(repo, event, turnId, cwd = repo.root) {
  const input = {
    hook_event_name: event,
    session_id: 'test-session',
    turn_id: turnId,
    cwd
  }
  const result = spawnSync(process.execPath, [hookScript], {
    cwd,
    encoding: 'utf8',
    input: JSON.stringify(input),
    env: {
      ...process.env,
      CODEX_CURRENT_GUARD_STATE_DIR: repo.stateDir
    },
    windowsHide: true
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout.trim() ? JSON.parse(result.stdout) : null
}

function invokeWindowsLauncher(repo, event, turnId) {
  const hookDirectory = path.join(repo.root, '.codex', 'hooks')
  fs.mkdirSync(hookDirectory, { recursive: true })
  fs.copyFileSync(hookScript, path.join(hookDirectory, 'current-memory-guard.cjs'))
  fs.copyFileSync(
    windowsLauncher,
    path.join(hookDirectory, 'invoke-current-memory-guard.ps1')
  )

  const input = {
    hook_event_name: event,
    session_id: 'windows-launcher-session',
    turn_id: turnId,
    cwd: repo.root
  }
  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "& ((git rev-parse --show-toplevel) + '/.codex/hooks/invoke-current-memory-guard.ps1')"
    ],
    {
      cwd: repo.root,
      encoding: 'utf8',
      input: JSON.stringify(input),
      env: {
        ...process.env,
        CODEX_CURRENT_GUARD_STATE_DIR: repo.stateDir
      },
      windowsHide: true
    }
  )
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout.trim() ? JSON.parse(result.stdout) : null
}

function cleanup(repo) {
  fs.rmSync(repo.root, { recursive: true, force: true })
  fs.rmSync(repo.stateDir, { recursive: true, force: true })
}

test('无项目变化时允许结束', () => {
  const repo = createRepo()
  try {
    const start = invokeHook(repo, 'UserPromptSubmit', 'no-change')
    assert.match(start.systemMessage, /CURRENT\.md/)
    assert.equal(invokeHook(repo, 'Stop', 'no-change'), null)
  } finally {
    cleanup(repo)
  }
})

test('只修改 CURRENT.md 时允许结束', () => {
  const repo = createRepo()
  try {
    invokeHook(repo, 'UserPromptSubmit', 'current-only')
    fs.appendFileSync(path.join(repo.root, 'memory', 'CURRENT.md'), '\nUpdated\n')
    assert.equal(invokeHook(repo, 'Stop', 'current-only'), null)
  } finally {
    cleanup(repo)
  }
})

test('修改项目但未更新 CURRENT.md 时阻止，补写后允许结束', () => {
  const repo = createRepo()
  try {
    invokeHook(repo, 'UserPromptSubmit', 'block-then-pass')
    fs.appendFileSync(path.join(repo.root, 'source.txt'), 'changed\n')

    const blocked = invokeHook(repo, 'Stop', 'block-then-pass')
    assert.equal(blocked.continue, false)
    assert.match(blocked.stopReason, /CURRENT\.md 未更新/)

    fs.appendFileSync(path.join(repo.root, 'memory', 'CURRENT.md'), '\nProgress updated\n')
    assert.equal(invokeHook(repo, 'Stop', 'block-then-pass'), null)
  } finally {
    cleanup(repo)
  }
})

test('能识别本轮对既有脏文件的继续修改', () => {
  const repo = createRepo()
  try {
    fs.appendFileSync(path.join(repo.root, 'source.txt'), 'dirty before turn\n')
    invokeHook(repo, 'UserPromptSubmit', 'dirty-worktree')
    fs.appendFileSync(path.join(repo.root, 'source.txt'), 'changed during turn\n')

    const blocked = invokeHook(repo, 'Stop', 'dirty-worktree')
    assert.equal(blocked.continue, false)
  } finally {
    cleanup(repo)
  }
})

test('未跟踪文件的新增和后续修改都纳入检测', () => {
  const repo = createRepo()
  try {
    invokeHook(repo, 'UserPromptSubmit', 'new-untracked')
    fs.writeFileSync(path.join(repo.root, 'new.txt'), 'new\n')
    assert.equal(invokeHook(repo, 'Stop', 'new-untracked').continue, false)

    invokeHook(repo, 'UserPromptSubmit', 'existing-untracked')
    fs.appendFileSync(path.join(repo.root, 'new.txt'), 'changed\n')
    assert.equal(invokeHook(repo, 'Stop', 'existing-untracked').continue, false)
  } finally {
    cleanup(repo)
  }
})

test('删除、重命名以及从子目录启动都能识别', () => {
  const repo = createRepo()
  try {
    const subdir = path.join(repo.root, 'nested')
    fs.mkdirSync(subdir)
    invokeHook(repo, 'UserPromptSubmit', 'rename-delete', subdir)
    fs.renameSync(
      path.join(repo.root, 'source.txt'),
      path.join(repo.root, 'renamed.txt')
    )
    fs.unlinkSync(path.join(repo.root, 'delete-me.txt'))

    const blocked = invokeHook(repo, 'Stop', 'rename-delete', subdir)
    assert.equal(blocked.continue, false)
  } finally {
    cleanup(repo)
  }
})

test('缺少基线或不在 Git 仓库时告警并放行', () => {
  const repo = createRepo()
  const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'current-memory-hook-nonrepo-'))
  try {
    const missing = invokeHook(repo, 'Stop', 'missing-state')
    assert.equal(missing.continue, true)
    assert.match(missing.systemMessage, /已放行/)

    const invalid = invokeHook(
      { root: nonRepo, stateDir: repo.stateDir },
      'Stop',
      'not-a-repo',
      nonRepo
    )
    assert.equal(invalid.continue, true)
    assert.match(invalid.systemMessage, /已放行/)
  } finally {
    cleanup(repo)
    fs.rmSync(nonRepo, { recursive: true, force: true })
  }
})

test('Windows 启动入口能转发标准输入并调用 Git', () => {
  const repo = createRepo()
  try {
    const start = invokeWindowsLauncher(repo, 'UserPromptSubmit', 'windows-entry')
    assert.match(start.systemMessage, /CURRENT\.md/)

    fs.appendFileSync(path.join(repo.root, 'source.txt'), 'windows changed\n')
    const blocked = invokeWindowsLauncher(repo, 'Stop', 'windows-entry')
    assert.equal(blocked.continue, false)
  } finally {
    cleanup(repo)
  }
})
