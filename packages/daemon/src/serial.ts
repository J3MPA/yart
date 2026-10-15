import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'

/**
 * Runs the tasks of one key one after the other. Tasks of different keys run
 * at the same time.
 *
 * A write in the daemon reads a full file, changes it in memory and writes the
 * full file. Two such writes at the same time would each start from the same
 * file, and the last write would remove the change of the first.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<void>>()

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const result = previous.then(task)
    // The next task waits for this one, also when this one fails.
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return result
  }
}

/**
 * Writes a file through a temporary file with a unique name, then renames it.
 * A reader never sees half of the file, and two writers never share the
 * temporary file.
 */
export const writeFileAtomic = async (path: string, content: string, mode?: number) => {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, mode === undefined ? 'utf8' : { mode })
    await rename(temporary, path)
  } catch (cause) {
    await rm(temporary, { force: true })
    throw cause
  }
}
