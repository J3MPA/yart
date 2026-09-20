import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * A throwaway git repository for tests.
 *
 * Exercising the git adapter against real git output is the whole point — a
 * mocked `git` would only prove the mock matches our assumptions about a format
 * we do not control.
 */
export class TestRepo {
  readonly path: string

  constructor() {
    this.path = mkdtempSync(join(tmpdir(), 'yart-test-'))
    this.git('init', '--quiet', '--initial-branch=main')
    this.git('config', 'user.email', 'test@example.com')
    this.git('config', 'user.name', 'Test')
    this.git('config', 'commit.gpgsign', 'false')
  }

  git(...args: string[]): string {
    return execFileSync('git', args, { cwd: this.path, encoding: 'utf8' })
  }

  write(relative_path: string, content: string): void {
    const full_path = join(this.path, relative_path)
    mkdirSync(dirname(full_path), { recursive: true })
    writeFileSync(full_path, content)
  }

  remove(relative_path: string): void {
    this.git('rm', '--quiet', relative_path)
  }

  move(from: string, to: string): void {
    this.git('mv', from, to)
  }

  commit(message: string): string {
    this.git('add', '-A')
    this.git('commit', '--quiet', '--no-gpg-sign', '-m', message)
    return this.git('rev-parse', 'HEAD').trim()
  }

  blobSha(rev: string, relative_path: string): string {
    return this.git('rev-parse', `${rev}:${relative_path}`).trim()
  }

  dispose(): void {
    rmSync(this.path, { recursive: true, force: true })
  }
}
