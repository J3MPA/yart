import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findGitCommonDir, findRepoRoot, GitError } from './git.ts'
import { ReviewError, ReviewService } from './review.ts'

/**
 * Where a daemon keeps what it knows beyond any one repository.
 *
 * `YART_HOME` wins so that a second installation — a development checkout
 * beside an installed yart — can keep its own.
 */
export const defaultStateDir = (): string => process.env.YART_HOME ?? join(homedir(), '.yart')

interface RegistryFile {
  repositories: string[]
}

export interface RepositoriesOptions {
  /**
   * Used for a request that does not say which repository it is for, or null
   * to require every request to say — as a daemon the desktop app starts must,
   * belonging to no repository in particular.
   */
  default_repo: string | null
  /**
   * Where the repositories seen are remembered across restarts, or null to
   * remember them only for this process — which is what a test wants, so that
   * running the suite never writes into the home directory of whoever runs it.
   */
  state_dir: string | null
}

/**
 * Every repository this daemon has served, one review service each.
 *
 * A daemon used to be fixed to the repository it was started in, and every
 * client reused whichever daemon was listening — so a review asked for in one
 * repository while another's daemon was running reviewed the wrong working
 * tree, silently. Now a request names its repository and is routed to it.
 *
 * Services are keyed by the shared git directory rather than by path, so that
 * the worktrees of one repository share one service and one list of reviews,
 * as they already share one store.
 */
export class Repositories {
  private readonly default_repo: string | null
  private readonly registry_path: string | null
  private readonly services = new Map<string, ReviewService>()
  /** Which service holds a review, learned on first lookup; reviews never move. */
  private readonly owners = new Map<string, ReviewService>()
  private known: Set<string> | null = null

  constructor({ default_repo, state_dir }: RepositoriesOptions) {
    this.default_repo = default_repo
    this.registry_path = state_dir === null ? null : join(state_dir, 'repositories.json')
  }

  private async readRegistry(): Promise<Set<string>> {
    if (this.registry_path === null) return new Set()
    try {
      const parsed = JSON.parse(await readFile(this.registry_path, 'utf8')) as RegistryFile
      return new Set(Array.isArray(parsed.repositories) ? parsed.repositories : [])
    } catch {
      // Missing or unreadable: start empty rather than refuse to serve.
      return new Set()
    }
  }

  private async knownRepositories(): Promise<Set<string>> {
    if (this.known === null) {
      this.known = await this.readRegistry()
      if (this.default_repo !== null) this.known.add(this.default_repo)
    }
    return this.known
  }

  /**
   * Adds a repository to the file, merged with what is on disk.
   *
   * Merged rather than overwritten because another daemon — a development one
   * on another port — may share the directory, and written to a temporary
   * file first so that a crash mid-write cannot leave the list half there.
   */
  private async remember(repo_root: string): Promise<void> {
    const known = await this.knownRepositories()
    if (known.has(repo_root)) return
    known.add(repo_root)
    if (this.registry_path === null) return

    const on_disk = await this.readRegistry()
    const merged: RegistryFile = { repositories: [...new Set([...on_disk, ...known])].sort() }
    await mkdir(join(this.registry_path, '..'), { recursive: true })
    const temporary = `${this.registry_path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
    await rename(temporary, this.registry_path)
  }

  private async serviceAt(repo_root: string): Promise<ReviewService> {
    const key = await findGitCommonDir(repo_root)
    let service = this.services.get(key)
    if (service === undefined) {
      service = new ReviewService(repo_root)
      this.services.set(key, service)
    }
    return service
  }

  /**
   * The service for the repository containing a path, and that repository's
   * root — the root of the worktree asked about, which is what a review of
   * uncommitted work has to snapshot.
   */
  async resolve(path: string | undefined): Promise<{ service: ReviewService; repo_root: string }> {
    const asked = path ?? this.default_repo
    if (asked === null) throw new ReviewError('Say which repository this is for', 400)
    let repo_root: string
    try {
      repo_root = await findRepoRoot(asked)
    } catch (cause) {
      if (cause instanceof GitError) throw new ReviewError(`${path} is not a git repository`, 400)
      throw cause
    }
    const service = await this.serviceAt(repo_root)
    await this.remember(repo_root)
    return { service, repo_root }
  }

  /**
   * A service for every repository still there to serve.
   *
   * One that has gone — deleted, or on a disk that is not mounted — is left out
   * of this answer but kept in the file, since it may come back.
   */
  async all(): Promise<ReviewService[]> {
    const services = new Set<ReviewService>()
    for (const repo_root of await this.knownRepositories()) {
      try {
        services.add(await this.serviceAt(repo_root))
      } catch {
        continue
      }
    }
    return [...services]
  }

  /** The service holding a review, whichever repository it is in. */
  async locate(review_id: string): Promise<ReviewService> {
    const cached = this.owners.get(review_id)
    if (cached !== undefined) return cached

    for (const service of await this.all()) {
      if (await service.holds(review_id)) {
        this.owners.set(review_id, service)
        return service
      }
    }
    throw new ReviewError(`No review with id ${review_id}`, 404)
  }
}
