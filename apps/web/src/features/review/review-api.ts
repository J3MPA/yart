/* eslint-disable @typescript-eslint/naming-convention -- every property name in
   this file is Redux Toolkit Query's own: endpoint keys become hook names
   (`getReview` -> `useGetReviewQuery`), and the rest are its config fields. */
import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react'
import type {
  Attachment,
  DiffSide,
  FileContents,
  FileDiff,
  Review,
  ReviewVerdict,
  Settings,
  ThreadStatus,
} from '@yart/core'
import { signedOut } from '@/features/session/session-slice'

export interface AddThreadArgs {
  review_id: string
  path: string
  line: number
  side: DiffSide
  body: string
  /** The ids of uploaded images. */
  attachments?: string[]
}

export interface AddCommentArgs {
  review_id: string
  thread_id: string
  body: string
  attachments?: string[]
}

export interface SubmitReviewArgs {
  review_id: string
  verdict: ReviewVerdict
  body?: string
  attachments?: string[]
  threads?: {
    path: string
    side: DiffSide
    line: number
    body: string
    blob_sha: string
    attachments?: string[]
  }[]
  replies?: { thread_id: string; body: string; attachments?: string[] }[]
  /** The head on the screen at the submit. The daemon refuses if the head moved. */
  expected_head_sha?: string
}

export interface AddSubmissionCommentArgs {
  review_id: string
  submission_id: string
  body: string
  attachments?: string[]
}

/** Where the daemon serves an image of a review. */
export const attachmentUrl = (review_id: string, attachment_id: string): string =>
  `/api/reviews/${review_id}/attachments/${attachment_id}`

export interface SetThreadStatusArgs {
  review_id: string
  thread_id: string
  status: ThreadStatus
}

const fetchApi = fetchBaseQuery({ baseUrl: '/api' })

/** Each request, and a note in the store when the daemon refuses the sign-in of this window. */
const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extra,
) => {
  const result = await fetchApi(args, api, extra)
  if (result.error?.status === 401) api.dispatch(signedOut())
  return result
}

export const reviewApi = createApi({
  reducerPath: 'reviewApi',
  baseQuery,
  // Threads change on almost each action. Thus the page gets the review again,
  // and does not change it locally. The server owns the anchor state. To
  // calculate it again in the browser would be a second implementation.
  //
  // The diff has its own tag, because it does not change when someone comments.
  // It changes only when the head moves. With one shared tag, each comment ran
  // `git diff` again over all files in the review.
  tagTypes: ['Review', 'ReviewList', 'Diff', 'Settings'],
  // Nothing in this app moves the review. An agent does that, over MCP. The page
  // gets new data when the window gets focus. That is how it sees the change.
  refetchOnFocus: true,
  refetchOnReconnect: true,
  endpoints: (builder) => ({
    getVersion: builder.query<{ version: string }, void>({
      query: () => '/version',
    }),
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
    // Requested for each file, not with the diff. The page asks for a file when
    // someone opens a collapsed run, or when the file comes near the screen and
    // gets syntax highlights. Full files for all of a large review would be a
    // lot of text to send at the start.
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
      query: ({ review_id, thread_id, ...body }) => ({
        url: `/reviews/${review_id}/threads/${thread_id}/comments`,
        method: 'POST',
        body,
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
      query: ({ review_id, submission_id, ...body }) => ({
        url: `/reviews/${review_id}/submissions/${submission_id}/comments`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Review', 'ReviewList'],
    }),
    uploadAttachment: builder.mutation<Attachment, { review_id: string; data: string }>({
      query: ({ review_id, data }) => ({
        url: `/reviews/${review_id}/attachments`,
        method: 'POST',
        body: { data },
      }),
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
  useGetVersionQuery,
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
  useUploadAttachmentMutation,
} = reviewApi
