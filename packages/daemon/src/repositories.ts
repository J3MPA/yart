import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findGitCommonDir, findRepoRoot, GitError } from './git.ts'
import { ReviewError, ReviewService } from './review.ts'
import { checkReviewId } from './review-id.ts'
import { KeyedQueue, writeFileAtomic } from './serial.ts'

/**
 * Where a daemon keeps the information that is not about one repository.
 *
 * `YART_HOME` wins. Thus a second installation can keep its own information.
 * An example is a development checkout next to an installed yart.
 */
export const defaultStateDir = (): string => process.env.YART_HOME ?? join(homedir(), '.yart')

interface RegistryFile {
  repositories: string[]
}

export interface RepositoriesOptions {
  /**
   * The repository for a request that does not name one. Null makes each
   * request name its repository. A daemon that the desktop app starts must use
   * null, because it belongs to no repository.
   */
  default_repo: string | null
  /**
   * Where the daemon records the repositories that it served, for the next
   * start. Null keeps them only for this process. Tests use null. Thus the tests
   * never write into the home directory of the person who runs them.
   */
  state_dir: string | null
}

/**
 * All repositories that this daemon served, with one review service for each.
 *
 * Before, a daemon served only the repository that it started in. Each client
 * used the daemon that answered on the port. Thus a review in one repository,
 * while the daemon of a different repository ran, reviewed the wrong working
 * tree with no warning. Now each request names its repository, and goes to it.
 *
 * The key of each service is the shared git directory, not the path. Thus the
 * worktrees of one repository share one service and one list of reviews. They
 * already share one store.
 */
export class Repositories {
  private readonly default_repo: string | null
  private readonly registry_path: string | null
  private readonly services = new Map<string, ReviewService>()
  /** The service of each review, found on the first lookup. Reviews never move. */
  private readonly owners = new Map<string, ReviewService>()
  private known: Set<string> | null = null
  /** Two new repositories at the same time must both get into the file. */
  private readonly writes = new KeyedQueue()

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
      // The file is missing or cannot be read. Start with an empty list. Do not stop.
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
   * Adds a repository to the file, together with the list on the disk.
   *
   * It merges the two lists and does not write over the file. A different
   * daemon, such as a development daemon on a different port, can share the
   * directory. It writes to a temporary file first. Thus a crash during the
   * write cannot leave half of the list.
   */
  private remember(repo_root: string): Promise<void> {
    return this.writes.run('registry', () => this.add(repo_root))
  }

  private async add(repo_root: string): Promise<void> {
    const known = await this.knownRepositories()
    if (known.has(repo_root)) return
    known.add(repo_root)
    if (this.registry_path === null) return

    const on_disk = await this.readRegistry()
    const merged: RegistryFile = { repositories: [...new Set([...on_disk, ...known])].sort() }
    await mkdir(join(this.registry_path, '..'), { recursive: true })
    await writeFileAtomic(this.registry_path, `${JSON.stringify(merged, null, 2)}\n`)
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
   * The service for the repository that contains a path, and the root of that
   * repository. The root is the root of the worktree in the request. A review of
   * uncommitted work must make a snapshot of that worktree.
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
   * A service for each repository that still exists.
   *
   * A repository that is gone is not in this answer. It can be deleted, or on a
   * disk that is not mounted. It stays in the file, because it can come back.
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

  /** The service that holds a review, in any repository. */
  async locate(review_id: string): Promise<ReviewService> {
    checkReviewId(review_id)
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
