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
  refetchOnFocus: true,
  refetchOnReconnect: true,
  endpoints: (builder) => ({
    getImages: builder.query<ImageResponse, number>({
      query: (page) => `api/images?page=${page}&pageSize=20`,
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
    })
  })
})

export const { useGetImagesQuery, useGetImageMetaQuery, useToggleLikeMutation } = imagesApi


