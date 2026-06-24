import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

export interface ImageMeta {
  like: number;
  desc: string;
  liked?: boolean;
}

export interface StrapiImageFile {
  id: number,
  url: string,
  width: number,
  height: number,
  alternativeText: string | null,
}

export interface GalleryItem {
  id: number,
  documentId: string,
  image: StrapiImageFile
}

export interface ImageResponse {
  data: GalleryItem[],
  meta: {
    pagination: {
      page: number,
      pageCount: number
    }
  }
}

export const imagesApi = createApi({
  reducerPath: "imagesApi",
  baseQuery: fetchBaseQuery({
    baseUrl: "/"
  }),
  // No refetchOnFocus/refetchOnReconnect: likes, descriptions and removals
  // live only in the cache (no server persistence), so a refetch would clobber
  // them. The client cache is the source of truth here.
  endpoints: (builder) => ({
    // One cache entry holding ALL pages (data.pages[]), instead of one entry
    // per page. No manual accumulation, and add/remove is a single patch.
    getImages: builder.infiniteQuery<ImageResponse, void, number>({
      query: ({ pageParam }) => `api/images?page=${pageParam}&pageSize=20`,
      infiniteQueryOptions: {
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
          const { page, pageCount } = lastPage.meta.pagination
          return page < pageCount ? page + 1 : undefined
        },
      },
      keepUnusedDataFor: 300
    }),
    getImageMeta: builder.query<ImageMeta, number>({
      query: (id) => `api/images/${id}/meta`,
      keepUnusedDataFor: 60
    }),
    toggleLike: builder.mutation<void, number>({
      queryFn: () => ({ data: undefined }),
      onQueryStarted: (id, { dispatch }) => {
        dispatch(
          imagesApi.util.updateQueryData('getImageMeta', id, (draft) => {
            if (draft.liked) {
              draft.liked = false
              draft.like -= 1
            } else {
              draft.liked = true
              draft.like += 1
            }
          })
        )
        // queryFn always success, so no need to rollback logic
      }
    }),
    updateImageDesc: builder.mutation<void, { id: number, desc: string }>({
      queryFn: () => ({ data: undefined }),
      onQueryStarted: ({ id, desc }, { dispatch }) => {
        dispatch(
          imagesApi.util.updateQueryData('getImageMeta', id, (draft) => {
            draft.desc = desc
          })
        )
      }
    }),
    // List mutation: DELETE the gallery entry + media file in Strapi, while
    // optimistically dropping it from the single infinite-query entry. If the
    // request fails, the patch rolls back and the image reappears.
    removeImage: builder.mutation<void, { id: number, documentId: string, fileId: number }>({
      query: ({ documentId, fileId }) => ({
        url: `api/images/${documentId}?fileId=${fileId}`,
        method: 'DELETE',
      }),
      onQueryStarted: async ({ id }, { dispatch, queryFulfilled }) => {
        const patch = dispatch(
          imagesApi.util.updateQueryData('getImages', undefined, (draft) => {
            for (const page of draft.pages) {
              page.data = page.data.filter((item) => item.id !== id)
            }
          })
        )
        try {
          await queryFulfilled
        } catch {
          patch.undo()
        }
      }
    })
  })
})

export const {
  useGetImagesInfiniteQuery,
  useGetImageMetaQuery,
  useToggleLikeMutation,
  useUpdateImageDescMutation,
  useRemoveImageMutation,
} = imagesApi


