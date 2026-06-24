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

  // Flatten the pages, de-duplicating by id. Offset pagination + optimistic
  // inserts means the same image can appear in pages[0] (optimistic copy) and
  // again in a later page when the server returns it — keep the first, drop
  // the rest, so it never renders twice.
  const seen = new Set<number>();
  const images = (data?.pages.flatMap((page) => page.data) ?? []).filter(
    (item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }
  );

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
