import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

export interface StrapiImageFile {
  id: number,
  url: string,
  width: number,
  height: number,
  alternativeText: string | null,
}

interface GalleryItem {
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
    })
  })
})

export const { useGetImagesQuery } = imagesApi
