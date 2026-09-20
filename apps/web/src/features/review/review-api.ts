/* eslint-disable @typescript-eslint/naming-convention -- every property name in
   this file is Redux Toolkit Query's own: endpoint keys become hook names
   (`getReview` -> `useGetReviewQuery`), and the rest are its config fields. */
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { DiffSide, FileDiff, Review, ReviewVerdict, ThreadStatus } from '@yart/core'

export interface AddThreadArgs {
  review_id: string
  path: string
  line: number
  side: DiffSide
  body: string
}

export interface AddCommentArgs {
  review_id: string
  thread_id: string
  body: string
}

export interface SubmitReviewArgs {
  review_id: string
  verdict: ReviewVerdict
  body?: string
}

export interface SetThreadStatusArgs {
  review_id: string
  thread_id: string
  status: ThreadStatus
}

export const reviewApi = createApi({
  reducerPath: 'reviewApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  // Threads change on nearly every interaction, so the review is refetched
  // rather than patched locally: the server owns anchor state and re-deriving
  // it in the browser would be a second implementation of it.
  //
  // The diff is tagged separately because it does not change when someone
  // comments — only when head advances. Sharing one tag made every comment
  // re-run `git diff` over every file in the review.
  tagTypes: ['Review', 'ReviewList', 'Diff'],
  // Nothing in this app advances the review; an agent does, over MCP. Refetching
  // when the window regains focus is how the page notices that happened.
  refetchOnFocus: true,
  refetchOnReconnect: true,
  endpoints: (builder) => ({
    listReviews: builder.query<Review[], void>({
      query: () => '/reviews',
      providesTags: ['ReviewList'],
    }),
    getReview: builder.query<Review, string>({
      query: (review_id) => `/reviews/${review_id}`,
      providesTags: ['Review'],
    }),
    getReviewDiff: builder.query<FileDiff[], string>({
      query: (review_id) => `/reviews/${review_id}/diff`,
      providesTags: ['Diff'],
    }),
    addThread: builder.mutation<Review, AddThreadArgs>({
      query: ({ review_id, ...body }) => ({
        url: `/reviews/${review_id}/threads`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Review'],
    }),
    addComment: builder.mutation<Review, AddCommentArgs>({
      query: ({ review_id, thread_id, body }) => ({
        url: `/reviews/${review_id}/threads/${thread_id}/comments`,
        method: 'POST',
        body: { body },
      }),
      invalidatesTags: ['Review'],
    }),
    setThreadStatus: builder.mutation<Review, SetThreadStatusArgs>({
      query: ({ review_id, thread_id, status }) => ({
        url: `/reviews/${review_id}/threads/${thread_id}`,
        method: 'PATCH',
        body: { status },
      }),
      invalidatesTags: ['Review'],
    }),
    submitReview: builder.mutation<Review, SubmitReviewArgs>({
      query: ({ review_id, verdict, body }) => ({
        url: `/reviews/${review_id}/submit`,
        method: 'POST',
        body: { verdict, body },
      }),
      invalidatesTags: ['Review', 'ReviewList'],
    }),
  }),
})

export const {
  useListReviewsQuery,
  useGetReviewQuery,
  useGetReviewDiffQuery,
  useAddThreadMutation,
  useAddCommentMutation,
  useSetThreadStatusMutation,
  useSubmitReviewMutation,
} = reviewApi
