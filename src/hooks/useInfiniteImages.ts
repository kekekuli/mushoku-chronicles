import { useEffect, useState } from "react";
import { GalleryItem, useGetImagesQuery } from "../store/imagesApi";

export function useInfiniteImages() {
  const [currentPage, setCurrentPage] = useState(1);
  const [accumulatedImages, setAccumulatedImages] = useState<GalleryItem[]>([]);
  const { data, isFetching, isError } = useGetImagesQuery(currentPage);

  useEffect(() => {
    if (data) {
      setAccumulatedImages((prev) => {
        const prevImageIds = new Set(prev.map((image) => image.id));

        const newImages = data.data.filter(
          (image) => !prevImageIds.has(image.id)
        );

        if (newImages.length === 0) {
          return prev;
        }

        return [...prev, ...newImages];
      });
    }
  }, [data]);

  const hasMore = data && currentPage < data.meta.pagination.pageCount;

  function loadMore() {
    if (!isFetching && hasMore) {
      setCurrentPage((prev) => prev + 1);
    }
  }

  return {
    images: accumulatedImages,
    isFetching,
    isError,
    hasMore,
    loadMore,
  };
}
