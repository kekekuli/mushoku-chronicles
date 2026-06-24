import { useGetImagesInfiniteQuery } from "../store/imagesApi";

export function useInfiniteImages() {
  const {
    data,
    isFetching,
    isError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  } = useGetImagesInfiniteQuery();

  // Single source of truth: read straight from the cache and flatten the
  // pages. No local accumulator to keep in sync.
  const images = data?.pages.flatMap((page) => page.data) ?? [];

  function loadMore() {
    if (!isFetchingNextPage && hasNextPage) {
      void fetchNextPage();
    }
  }

  return {
    images,
    isFetching,
    isError,
    hasMore: hasNextPage ?? false,
    loadMore,
    refresh: refetch,
  };
}
