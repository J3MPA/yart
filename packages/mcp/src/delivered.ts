import { authorIsDone, latestSubmission, type Thread } from '@yart/core'
import type { Review } from '@yart/daemon'

/** The head and the comments of the agent after the last verdict. A new answer changes it. */
const answerState = (review: Review): string => {
  const verdict = latestSubmission(review)
  const after = [
    ...review.threads.flatMap((thread) => thread.comments),
    ...(verdict?.comments ?? []),
  ]
    .filter((comment) => comment.author === 'agent')
    .map((comment) => comment.id)
    .sort()
  return [verdict?.id ?? '', review.head_sha, ...after].join(' ')
}

/**
 * What one MCP server already gave to its agent, or got from it.
 *
 * One MCP server serves one agent. Thus a result can leave out what that agent
 * already has: an image, a comment that it read, or an answer of the author
 * that it got before. Each of these would cost tokens again and give nothing
 * new. A tool that reads the full review on request still shows all text.
 */
export class Delivered {
  /** The ids of the images that the agent saw or uploaded. */
  readonly images = new Set<string>()
  private readonly comments = new Set<string>()
  /** For each review, the state of the last answer of the author that the reviewer got. */
  private readonly answers = new Map<string, string>()

  /** @param author_quiet_ms How long the author must be quiet before replies wake the reviewer. */
  constructor(private readonly author_quiet_ms?: number) {}

  addImages(ids: readonly string[] | undefined): void {
    for (const id of ids ?? []) this.images.add(id)
  }

  addThreads(threads: readonly Thread[]): void {
    for (const thread of threads) {
      for (const comment of thread.comments) this.comments.add(comment.id)
    }
  }

  /** Tells if a thread has a comment that the agent did not get yet. */
  hasNewComment(thread: Thread): boolean {
    return thread.comments.some((comment) => !this.comments.has(comment.id))
  }

  /**
   * Tells if the author answered the last verdict of the reviewer, with an
   * answer that the reviewer did not get yet. Without this, each wait after
   * the first answer would return at once, with the same answer.
   */
  isNewAnswer(review: Review): boolean {
    return (
      authorIsDone(review, this.author_quiet_ms) &&
      this.answers.get(review.id) !== answerState(review)
    )
  }

  addAnswer(review: Review): void {
    this.answers.set(review.id, answerState(review))
  }
}
