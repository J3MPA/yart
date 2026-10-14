export class ReviewError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ReviewError'
    this.status = status
  }
}
