/* eslint-disable @typescript-eslint/naming-convention -- every property name in
   this file is Redux Toolkit Query's own: endpoint keys become hook names
   (`getReview` -> `useGetReviewQuery`), and the rest are its config fields. */
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type {
  DiffSide,
  FileContents,
  FileDiff,
  Review,
  ReviewVerdict,
  Settings,
  ThreadStatus,
} from '@yart/core'

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
  threads?: { path: string; side: DiffSide; line: number; body: string; blob_sha: string }[]
  replies?: { thread_id: string; body: string }[]
  /** The head on screen when submitting; the daemon refuses if it has moved. */
  expected_head_sha?: string
}

export interface AddSubmissionCommentArgs {
  review_id: string
  submission_id: string
  body: string
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
  tagTypes: ['Review', 'ReviewList', 'Diff', 'Settings'],
  // Nothing in this app advances the review; an agent does, over MCP. Refetching
  // when the window regains focus is how the page notices that happened.
  refetchOnFocus: true,
  refetchOnReconnect: true,
  endpoints: (builder) => ({
    getSettings: builder.query<Settings, void>({
      query: () => '/settings',
      providesTags: ['Settings'],
    }),
    updateSettings: builder.mutation<Settings, Partial<Settings>>({
      query: (changes) => ({ url: '/settings', method: 'PATCH', body: changes }),
      invalidatesTags: ['Settings'],
    }),
    listReviews: builder.query<Review[], boolean | void>({
      query: (archived) => (archived === true ? '/reviews?archived=true' : '/reviews'),
      providesTags: ['ReviewList'],
    }),
    setReviewArchived: builder.mutation<Review, { review_id: string; archived: boolean }>({
      query: ({ review_id, archived }) => ({
        url: `/reviews/${review_id}`,
        method: 'PATCH',
        body: { archived },
      }),
      invalidatesTags: ['ReviewList', 'Review'],
    }),
    deleteReview: builder.mutation<void, string>({
      query: (review_id) => ({ url: `/reviews/${review_id}`, method: 'DELETE' }),
      invalidatesTags: ['ReviewList'],
    }),
    getReview: builder.query<Review, string>({
      query: (review_id) => `/reviews/${review_id}`,
      providesTags: ['Review'],
    }),
    getReviewDiff: builder.query<FileDiff[], string>({
      query: (review_id) => `/reviews/${review_id}/diff`,
      providesTags: ['Diff'],
    }),
    // Fetched only when someone expands a collapsed run, and per file rather
    // than with the diff: whole files for a 28-file review is a lot of text to
    // send for the handful of lines anyone actually opens.
    getReviewFile: builder.query<FileContents, { review_id: string; path: string }>({
      query: ({ review_id, path }) => `/reviews/${review_id}/file?path=${encodeURIComponent(path)}`,
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
    addSubmissionComment: builder.mutation<Review, AddSubmissionCommentArgs>({
      query: ({ review_id, submission_id, body }) => ({
        url: `/reviews/${review_id}/submissions/${submission_id}/comments`,
        method: 'POST',
        body: { body },
      }),
      invalidatesTags: ['Review', 'ReviewList'],
    }),
    submitReview: builder.mutation<Review, SubmitReviewArgs>({
      query: ({ review_id, ...body }) => ({
        url: `/reviews/${review_id}/submit`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Review', 'ReviewList'],
    }),
  }),
})

export const {
  useGetSettingsQuery,
  useUpdateSettingsMutation,
  useListReviewsQuery,
  useSetReviewArchivedMutation,
  useDeleteReviewMutation,
  useGetReviewQuery,
  useGetReviewDiffQuery,
  useGetReviewFileQuery,
  useAddThreadMutation,
  useAddCommentMutation,
  useAddSubmissionCommentMutation,
  useSetThreadStatusMutation,
  useSubmitReviewMutation,
} = reviewApi
